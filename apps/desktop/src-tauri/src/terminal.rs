use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufReader, Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::State;

use crate::ensure_existing_dir;
use crate::validation::{
    ensure_room_id, ensure_terminal_command, ensure_terminal_id, ensure_terminal_input,
    ensure_terminal_name,
};

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
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalLine {
    pub(crate) stream: String,
    pub(crate) text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalStartRequest {
    room_id: String,
    name: String,
    cwd: String,
    command: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalWriteRequest {
    id: String,
    input: String,
}

#[tauri::command]
pub(crate) fn terminal_start(
    state: State<'_, TerminalState>,
    request: TerminalStartRequest,
) -> Result<TerminalSnapshot, String> {
    ensure_room_id(&request.room_id)?;
    ensure_existing_dir(&request.cwd)?;
    ensure_terminal_name(&request.name)?;
    ensure_terminal_command(&request.command)?;

    let id = terminal_id(&request.room_id, &request.name);
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;

    if let Some(existing) = sessions.get_mut(&id) {
        if existing_is_running(existing) {
            return Err(format!("Terminal {} is already running", request.name));
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
    let mut command = CommandBuilder::new(shell);
    command.cwd(&request.cwd);
    command.arg("-lc");
    command.arg(&request.command);
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
    let output = Arc::new(Mutex::new(vec![TerminalLine {
        stream: "system".to_string(),
        text: format!("$ {}", request.command),
    }]));

    capture_terminal_stream(reader, "stdout", Arc::clone(&output));

    let session = TerminalSession {
        room_id: request.room_id,
        name: request.name,
        cwd: request.cwd,
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
    snapshot_terminal(&id, session)
}

#[tauri::command]
pub(crate) fn terminal_list(
    state: State<'_, TerminalState>,
    room_id: String,
) -> Result<Vec<TerminalSnapshot>, String> {
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

#[tauri::command]
pub(crate) fn terminal_read(
    state: State<'_, TerminalState>,
    id: String,
) -> Result<TerminalSnapshot, String> {
    ensure_terminal_id(&id)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal not found: {id}"))?;
    snapshot_terminal(&id, session)
}

#[tauri::command]
pub(crate) fn terminal_write(
    state: State<'_, TerminalState>,
    request: TerminalWriteRequest,
) -> Result<TerminalSnapshot, String> {
    ensure_terminal_id(&request.id)?;
    ensure_terminal_input(&request.input)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions
        .get_mut(&request.id)
        .ok_or_else(|| format!("Terminal not found: {}", request.id))?;
    if !existing_is_running(session) {
        return Err(format!("Terminal {} is not running", session.name));
    }
    write!(session.writer, "{}", request.input)
        .map_err(|error| format!("Failed to write terminal input: {error}"))?;
    session
        .writer
        .flush()
        .map_err(|error| format!("Failed to flush terminal input: {error}"))?;
    push_terminal_line(
        &session.output,
        TerminalLine {
            stream: "stdin".to_string(),
            text: request.input.trim_end_matches('\n').to_string(),
        },
    );
    snapshot_terminal(&request.id, session)
}

#[tauri::command]
pub(crate) fn terminal_stop(
    state: State<'_, TerminalState>,
    id: String,
) -> Result<TerminalSnapshot, String> {
    ensure_terminal_id(&id)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal not found: {id}"))?;
    terminate_terminal_child(session.child.as_mut());
    snapshot_terminal(&id, session)
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
        loop {
            let byte_count = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(byte_count) => byte_count,
                Err(_) => break,
            };
            let text = String::from_utf8_lossy(&buffer[..byte_count])
                .replace("\r\n", "\n")
                .replace('\r', "\n");
            push_terminal_line(
                &output,
                TerminalLine {
                    stream: name.to_string(),
                    text,
                },
            );
        }
    });
}

pub(crate) fn push_terminal_line(output: &Arc<Mutex<Vec<TerminalLine>>>, line: TerminalLine) {
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
