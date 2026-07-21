use crate::host_sandbox::interactive_terminal_program;
use crate::output::redact_known_secrets;
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufReader, Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::State;

use crate::validation::{
    ensure_room_id, ensure_terminal_command, ensure_terminal_id, ensure_terminal_input,
    ensure_terminal_name,
};
use crate::workspace::canonical_project_root;

#[derive(Default)]
pub(crate) struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

struct TerminalSession {
    room_id: String,
    name: String,
    cwd: String,
    command: String,
    child: Box<dyn PtyChild + Send + Sync>,
    writer: Box<dyn Write + Send>,
    _master: Box<dyn MasterPty + Send>,
    output: Arc<Mutex<Vec<TerminalLine>>>,
    started_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TerminalLine {
    pub(crate) stream: String,
    pub(crate) text: String,
}

#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TerminalSnapshot {
    id: String,
    room_id: String,
    name: String,
    cwd: String,
    command: String,
    running: bool,
    exit_status: Option<i32>,
    started_at: String,
    lines: Vec<TerminalLine>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TerminalStartRequest {
    room_id: String,
    name: String,
    cwd: String,
    command: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TerminalWriteRequest {
    id: String,
    room_id: String,
    input: String,
}

#[typed_tauri_command::command]
pub(crate) fn terminal_start(
    state: State<'_, TerminalState>,
    request: TerminalStartRequest,
) -> crate::command_error::CommandResult<TerminalSnapshot> {
    ensure_room_id(&request.room_id)?;
    ensure_terminal_name(&request.name)?;
    ensure_terminal_command(&request.command)?;
    let canonical_cwd = canonical_project_root(&request.cwd)?;
    let canonical_cwd = canonical_cwd
        .to_str()
        .ok_or_else(|| "Project path must be valid UTF-8".to_string())?
        .to_string();

    let id = terminal_id(&request.room_id, &request.name);
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;

    if let Some(existing) = sessions.get_mut(&id) {
        if existing_is_running(existing) {
            return Err(format!("Terminal {} is already running", request.name).into());
        }
        terminate_terminal_child(existing.child.as_mut());
        sessions.remove(&id);
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Failed to open terminal pty: {error}"))?;
    let (program, arguments) =
        interactive_terminal_program(&shell, &canonical_cwd, &request.command)?;
    let mut command = CommandBuilder::new(program);
    command.cwd(&canonical_cwd);
    for argument in arguments {
        command.arg(argument);
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Failed to start terminal: {error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Failed to read terminal pty: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Failed to write terminal pty: {error}"))?;
    let output = Arc::new(Mutex::new(vec![
        TerminalLine {
            stream: "system".to_string(),
            text: format!("Working in {canonical_cwd}"),
        },
        TerminalLine {
            stream: "system".to_string(),
            text: format!("$ {}", request.command),
        },
    ]));

    capture_terminal_stream(reader, "stdout", Arc::clone(&output));

    let session = TerminalSession {
        room_id: request.room_id,
        name: request.name,
        cwd: canonical_cwd,
        command: request.command,
        child,
        writer,
        _master: pair.master,
        output,
        started_at: unix_timestamp_millis().to_string(),
    };
    sessions.insert(id.clone(), session);
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| "Terminal failed to start".to_string())?;
    Ok(snapshot_terminal(&id, session)?)
}

#[typed_tauri_command::command]
pub(crate) fn terminal_list(
    state: State<'_, TerminalState>,
    room_id: String,
) -> crate::command_error::CommandResult<Vec<TerminalSnapshot>> {
    ensure_room_id(&room_id)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let mut snapshots = Vec::new();
    for (id, session) in sessions.iter_mut() {
        if session.room_id == room_id {
            snapshots.push(snapshot_terminal(id, session)?);
        }
    }
    snapshots.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(snapshots)
}

#[typed_tauri_command::command]
pub(crate) fn terminal_read(
    state: State<'_, TerminalState>,
    id: String,
) -> crate::command_error::CommandResult<TerminalSnapshot> {
    ensure_terminal_id(&id)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal not found: {id}"))?;
    Ok(snapshot_terminal(&id, session)?)
}

#[typed_tauri_command::command]
pub(crate) fn terminal_write(
    state: State<'_, TerminalState>,
    request: TerminalWriteRequest,
) -> crate::command_error::CommandResult<TerminalSnapshot> {
    ensure_terminal_id(&request.id)?;
    ensure_room_id(&request.room_id)?;
    ensure_terminal_input(&request.input)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions
        .get_mut(&request.id)
        .ok_or_else(|| format!("Terminal not found: {}", request.id))?;
    if session.room_id != request.room_id {
        return Err("Terminal does not belong to the confirmed room".into());
    }
    if !existing_is_running(session) {
        return Err(format!("Terminal {} is not running", session.name).into());
    }
    write!(session.writer, "{}", request.input)
        .map_err(|error| format!("Failed to write terminal input: {error}"))?;
    session
        .writer
        .flush()
        .map_err(|error| format!("Failed to flush terminal input: {error}"))?;
    Ok(snapshot_terminal(&request.id, session)?)
}

#[typed_tauri_command::command]
pub(crate) fn terminal_stop(
    state: State<'_, TerminalState>,
    id: String,
) -> crate::command_error::CommandResult<TerminalSnapshot> {
    ensure_terminal_id(&id)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal not found: {id}"))?;
    terminate_terminal_child(session.child.as_mut());
    Ok(snapshot_terminal(&id, session)?)
}

fn terminal_id(room_id: &str, name: &str) -> String {
    format!("{room_id}:{name}")
}

fn existing_is_running(session: &mut TerminalSession) -> bool {
    matches!(session.child.try_wait(), Ok(None))
}

fn snapshot_terminal(id: &str, session: &mut TerminalSession) -> Result<TerminalSnapshot, String> {
    let exit_status = match session.child.try_wait() {
        Ok(Some(status)) => Some(status.exit_code() as i32),
        Ok(None) => None,
        Err(error) => return Err(format!("Failed to read terminal status: {error}")),
    };
    let lines = session
        .output
        .lock()
        .map_err(|_| "Terminal output is unavailable".to_string())?
        .clone();
    Ok(TerminalSnapshot {
        id: id.to_string(),
        room_id: session.room_id.clone(),
        name: session.name.clone(),
        cwd: session.cwd.clone(),
        command: session.command.clone(),
        running: exit_status.is_none(),
        exit_status,
        started_at: session.started_at.clone(),
        lines,
    })
}

fn terminate_terminal_child(child: &mut dyn PtyChild) {
    let _ = child.kill();
}

fn capture_terminal_stream<T>(stream: T, name: &'static str, output: Arc<Mutex<Vec<TerminalLine>>>)
where
    T: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut buffer = [0_u8; 4096];
        let mut redactor = TerminalStreamRedactor::default();
        loop {
            let byte_count = match reader.read(&mut buffer) {
                Ok(0) => {
                    for text in redactor.push("", true) {
                        push_terminal_line(
                            &output,
                            TerminalLine {
                                stream: name.to_string(),
                                text,
                            },
                        );
                    }
                    break;
                }
                Ok(byte_count) => byte_count,
                Err(_) => break,
            };
            for text in redactor.push(&String::from_utf8_lossy(&buffer[..byte_count]), false) {
                push_terminal_line(
                    &output,
                    TerminalLine {
                        stream: name.to_string(),
                        text,
                    },
                );
            }
        }
    });
}

const MAX_TERMINAL_REDACTION_PENDING_BYTES: usize = 8 * 1024;
const STREAM_REDACTION_MARKER: &str = "[REDACTED BY MULTAIPLAYER]\n";

#[derive(Default)]
pub(crate) struct TerminalStreamRedactor {
    pending: String,
    in_private_key: bool,
    suppress_until_newline: bool,
}

impl TerminalStreamRedactor {
    pub(crate) fn push(&mut self, chunk: &str, eof: bool) -> Vec<String> {
        let mut safe = Vec::new();
        let mut remainder = chunk;
        if self.suppress_until_newline {
            if let Some(newline) = remainder.find('\n') {
                remainder = &remainder[newline + 1..];
                self.suppress_until_newline = false;
            } else {
                if eof {
                    self.suppress_until_newline = false;
                }
                return safe;
            }
        }
        self.pending.push_str(remainder);
        while let Some(newline) = self.pending.find('\n') {
            let complete = self.pending.drain(..=newline).collect::<String>();
            self.redact_complete_line(&complete, &mut safe);
        }
        if self.pending.len() > MAX_TERMINAL_REDACTION_PENDING_BYTES {
            self.pending.clear();
            self.suppress_until_newline = true;
            safe.push(STREAM_REDACTION_MARKER.to_string());
        }
        if eof {
            if !self.pending.is_empty() {
                let complete = std::mem::take(&mut self.pending);
                self.redact_complete_line(&complete, &mut safe);
            }
            self.suppress_until_newline = false;
            self.in_private_key = false;
        }
        safe
    }

    fn redact_complete_line(&mut self, line: &str, safe: &mut Vec<String>) {
        if self.in_private_key {
            if line.contains("-----END ") && line.contains("PRIVATE KEY-----") {
                self.in_private_key = false;
            }
            return;
        }
        if line.contains("-----BEGIN ") && line.contains("PRIVATE KEY-----") {
            self.in_private_key = !line.contains("-----END ");
            safe.push(STREAM_REDACTION_MARKER.to_string());
            return;
        }
        safe.push(redact_known_secrets(line));
    }

    #[cfg(test)]
    pub(crate) fn pending_bytes(&self) -> usize {
        self.pending.len()
    }
}

pub(crate) fn push_terminal_line(output: &Arc<Mutex<Vec<TerminalLine>>>, line: TerminalLine) {
    // Interactive input may contain passwords or tokens that the PTY intentionally
    // does not echo. Only process output belongs in snapshots and local history.
    if line.stream == "stdin" {
        return;
    }
    if let Ok(mut lines) = output.lock() {
        lines.push(line);
        if lines.len() > 1_000 {
            let overflow = lines.len() - 1_000;
            lines.drain(0..overflow);
        }
    }
}

fn unix_timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
