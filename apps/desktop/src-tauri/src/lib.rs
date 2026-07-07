use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

mod browser;
mod keychain;
mod output;
mod project;
mod validation;
use browser::*;
use keychain::*;
use output::*;
use project::*;
use validation::*;

const LOCAL_PREVIEW_PORTS: [u16; 9] = [3000, 3001, 5173, 5174, 8000, 8080, 4200, 5000, 8888];
const TRYCLOUDFLARE_MARKER: &str = ".trycloudflare.com";

#[derive(Default)]
struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[derive(Default)]
struct LocalPreviewState {
    tunnels: Mutex<HashMap<String, LocalPreviewTunnel>>,
}

struct LocalPreviewTunnel {
    id: String,
    local_url: String,
    public_url: String,
    child: Child,
}

impl Drop for LocalPreviewTunnel {
    fn drop(&mut self) {
        terminate_child(&mut self.child);
    }
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

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusFile {
    path: String,
    status: String,
    added: u32,
    removed: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusSummary {
    branch: String,
    files: Vec<GitStatusFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitRemoteInfo {
    origin_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitPatchResult {
    patch: String,
    truncated: bool,
    dirty_files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitCloneResult {
    path: String,
    command: String,
    status: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitApplyPatchResult {
    command: String,
    cwd: String,
    status: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCloneRequest {
    remote_url: String,
    parent_dir: String,
    branch: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitApplyPatchRequest {
    cwd: String,
    patch: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult {
    command: String,
    cwd: String,
    status: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPreviewDetectedServer {
    url: String,
    host: String,
    port: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflaredProbe {
    available: bool,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalPreviewStartRequest {
    id: String,
    local_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPreviewStartResult {
    id: String,
    local_url: String,
    public_url: String,
    startup_log: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPreviewStopResult {
    id: String,
    local_url: String,
    public_url: String,
    stopped: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPreviewStatusResult {
    id: String,
    local_url: String,
    public_url: String,
    running: bool,
    local_reachable: bool,
    exit_status: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalLine {
    stream: String,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSnapshot {
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
struct TerminalStartRequest {
    room_id: String,
    name: String,
    cwd: String,
    command: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalWriteRequest {
    id: String,
    input: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexProbe {
    available: bool,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexTurnResult {
    thread_id: Option<String>,
    status: String,
    transcript: String,
    events: Vec<String>,
    stderr: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellCommandRequest {
    cwd: String,
    command: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexTurnRequest {
    cwd: String,
    input: String,
    model: Option<String>,
    previous_thread_id: Option<String>,
    timeout_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitWorkflowRequest {
    cwd: String,
    branch: String,
    message: String,
    push: bool,
}

#[tauri::command]
fn git_status(cwd: String) -> Result<GitStatusSummary, String> {
    ensure_existing_dir(&cwd)?;

    let branch_output = Command::new("git")
        .args(["-C", &cwd, "branch", "--show-current"])
        .output()
        .map_err(|error| format!("Failed to run git branch: {error}"))?;

    let status_output = Command::new("git")
        .args(["-C", &cwd, "status", "--porcelain=v1"])
        .output()
        .map_err(|error| format!("Failed to run git status: {error}"))?;

    if !status_output.status.success() {
        return Err(String::from_utf8_lossy(&status_output.stderr)
            .trim()
            .to_string());
    }

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    let mut files = Vec::new();
    for line in String::from_utf8_lossy(&status_output.stdout).lines() {
        if line.len() < 4 {
            continue;
        }
        let code = &line[0..2];
        let path = line[3..].to_string();
        files.push(GitStatusFile {
            path,
            status: git_status_label(code),
            added: if code.contains('A') || code.contains('?') {
                1
            } else {
                0
            },
            removed: if code.contains('D') { 1 } else { 0 },
        });
    }

    Ok(GitStatusSummary {
        branch: if branch.is_empty() {
            "detached".to_string()
        } else {
            branch
        },
        files,
    })
}

#[tauri::command]
fn git_remote_origin(cwd: String) -> Result<GitRemoteInfo, String> {
    ensure_existing_dir(&cwd)?;

    let output = Command::new("git")
        .args(["-C", &cwd, "remote", "get-url", "origin"])
        .output()
        .map_err(|error| format!("Failed to run git remote: {error}"))?;

    if !output.status.success() {
        return Ok(GitRemoteInfo { origin_url: None });
    }

    let origin_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(GitRemoteInfo {
        origin_url: if origin_url.is_empty() {
            None
        } else {
            Some(origin_url)
        },
    })
}

#[tauri::command]
fn git_create_patch(cwd: String) -> Result<GitPatchResult, String> {
    ensure_existing_dir(&cwd)?;
    let status = git_status(cwd.clone())?;
    if status.files.is_empty() {
        return Ok(GitPatchResult {
            patch: String::new(),
            truncated: false,
            dirty_files: Vec::new(),
        });
    }

    let output = Command::new("git")
        .args(["-C", &cwd, "diff", "--binary", "HEAD"])
        .output()
        .map_err(|error| format!("Failed to create git patch: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let mut patch = String::from_utf8_lossy(&output.stdout).to_string();
    for file in status
        .files
        .iter()
        .filter(|file| file.status == "untracked")
    {
        let root = canonical_project_root(&cwd)?;
        let requested = safe_project_path(&root, &file.path)?;
        let output = Command::new("git")
            .args([
                "-C",
                &cwd,
                "diff",
                "--binary",
                "--no-index",
                "--",
                "/dev/null",
            ])
            .arg(&requested)
            .output()
            .map_err(|error| format!("Failed to create untracked file patch: {error}"))?;
        if !output.stdout.is_empty() {
            if !patch.is_empty() && !patch.ends_with('\n') {
                patch.push('\n');
            }
            patch.push_str(&normalize_no_index_patch(
                &String::from_utf8_lossy(&output.stdout),
                &file.path,
            ));
        }
    }

    let truncated = patch.chars().count() > MAX_GIT_PATCH_CHARS;
    Ok(GitPatchResult {
        patch: bound_text_chars(
            &patch,
            MAX_GIT_PATCH_CHARS,
            "\n\n[multAIplayer truncated this handoff patch. Ask the previous host to push or share a patch if needed.]\n",
        ),
        truncated,
        dirty_files: status.files.into_iter().map(|file| file.path).collect(),
    })
}

#[tauri::command]
fn git_clone_repository(request: GitCloneRequest) -> Result<GitCloneResult, String> {
    ensure_git_remote_url(&request.remote_url)?;
    ensure_existing_dir(&request.parent_dir)?;
    if let Some(branch) = request.branch.as_deref() {
        if branch != "detached" {
            ensure_safe_branch_name(branch)?;
        }
    }

    let repo_name = repo_name_from_remote_url(&request.remote_url)?;
    let target = next_available_clone_path(Path::new(&request.parent_dir), &repo_name)?;
    let target_arg = target.to_string_lossy().to_string();
    let mut command = Command::new("git");
    command.arg("clone");
    if let Some(branch) = request.branch.as_deref() {
        if branch != "detached" {
            command.args(["--branch", branch]);
        }
    }
    command.args([&request.remote_url, &target_arg]);
    let output = command
        .output()
        .map_err(|error| format!("Failed to run git clone: {error}"))?;
    Ok(GitCloneResult {
        path: target_arg,
        command: format!("git clone {} {}", request.remote_url, target.display()),
        status: output.status.code(),
        stdout: bound_command_output(&output.stdout),
        stderr: bound_command_output(&output.stderr),
    })
}

#[tauri::command]
fn git_apply_patch(request: GitApplyPatchRequest) -> Result<GitApplyPatchResult, String> {
    ensure_existing_dir(&request.cwd)?;
    ensure_git_patch(&request.patch)?;
    let mut child = Command::new("git")
        .args(["-C", &request.cwd, "apply", "--whitespace=nowarn", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to run git apply: {error}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(request.patch.as_bytes())
            .map_err(|error| format!("Failed to write handoff patch to git apply: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to read git apply output: {error}"))?;
    Ok(GitApplyPatchResult {
        command: "git apply --whitespace=nowarn -".to_string(),
        cwd: request.cwd,
        status: output.status.code(),
        stdout: bound_command_output(&output.stdout),
        stderr: bound_command_output(&output.stderr),
    })
}

#[tauri::command]
fn run_shell_command(request: ShellCommandRequest) -> Result<CommandResult, String> {
    ensure_existing_dir(&request.cwd)?;
    ensure_terminal_command(&request.command)?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(shell)
        .current_dir(&request.cwd)
        .args(["-lc", &request.command])
        .output()
        .map_err(|error| format!("Failed to run command: {error}"))?;

    Ok(CommandResult {
        command: request.command,
        cwd: request.cwd,
        status: output.status.code(),
        stdout: bound_command_output(&output.stdout),
        stderr: bound_command_output(&output.stderr),
    })
}

#[tauri::command]
fn detect_local_preview_servers() -> Result<Vec<LocalPreviewDetectedServer>, String> {
    let mut servers = Vec::new();
    for port in LOCAL_PREVIEW_PORTS {
        for host in ["localhost", "127.0.0.1"] {
            if local_port_reachable(host, port, Duration::from_millis(180)) {
                servers.push(LocalPreviewDetectedServer {
                    url: format!("http://{host}:{port}/"),
                    host: host.to_string(),
                    port,
                });
            }
        }
    }
    Ok(servers)
}

#[tauri::command]
fn probe_cloudflared() -> CloudflaredProbe {
    match Command::new("cloudflared").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            CloudflaredProbe {
                available: true,
                version: Some(version),
                error: None,
            }
        }
        Ok(output) => CloudflaredProbe {
            available: false,
            version: None,
            error: Some(trim_command_output(&String::from_utf8_lossy(
                &output.stderr,
            ))),
        },
        Err(error) => CloudflaredProbe {
            available: false,
            version: None,
            error: Some(format!(
                "cloudflared is not installed or is not on PATH: {error}"
            )),
        },
    }
}

#[tauri::command]
fn local_preview_start(
    state: State<'_, LocalPreviewState>,
    request: LocalPreviewStartRequest,
) -> Result<LocalPreviewStartResult, String> {
    ensure_preview_id(&request.id)?;
    let local_url = validate_local_preview_url(&request.local_url)?;
    ensure_local_preview_reachable(&local_url)?;

    {
        let mut tunnels = state
            .tunnels
            .lock()
            .map_err(|_| "Local preview state lock is poisoned".to_string())?;
        if let Some(mut existing) = tunnels.remove(&request.id) {
            terminate_child(&mut existing.child);
        }
    }

    let mut child = Command::new("cloudflared")
        .arg("tunnel")
        .arg("--url")
        .arg(&local_url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start Cloudflare Quick Tunnel: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture cloudflared stdout".to_string());
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture cloudflared stderr".to_string());
    let (stdout, stderr) = match (stdout, stderr) {
        (Ok(stdout), Ok(stderr)) => (stdout, stderr),
        (Err(error), _) | (_, Err(error)) => {
            terminate_child(&mut child);
            return Err(error);
        }
    };

    let (sender, receiver) = mpsc::channel::<String>();
    capture_preview_stream(stdout, sender.clone());
    capture_preview_stream(stderr, sender);

    let start = Instant::now();
    let mut startup_log = String::new();
    let mut public_url: Option<String> = None;
    while start.elapsed() < Duration::from_secs(20) {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to read cloudflared status: {error}"))?
        {
            terminate_child(&mut child);
            return Err(format!(
                "cloudflared exited before the tunnel was ready with status {status}. {}",
                trim_command_output(&startup_log)
            ));
        }

        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(line) => {
                append_bounded(&mut startup_log, &line, MAX_COMMAND_OUTPUT_CHARS);
                if let Some(url) = extract_trycloudflare_url(&line) {
                    public_url = Some(url);
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    let Some(public_url) = public_url else {
        terminate_child(&mut child);
        return Err(format!(
            "cloudflared started but did not produce a trycloudflare.com URL. {}",
            trim_command_output(&startup_log)
        ));
    };

    {
        let mut tunnels = state
            .tunnels
            .lock()
            .map_err(|_| "Local preview state lock is poisoned".to_string())?;
        tunnels.insert(
            request.id.clone(),
            LocalPreviewTunnel {
                id: request.id.clone(),
                local_url: local_url.clone(),
                public_url: public_url.clone(),
                child,
            },
        );
    }

    Ok(LocalPreviewStartResult {
        id: request.id,
        local_url,
        public_url,
        startup_log: trim_command_output(&startup_log),
    })
}

#[tauri::command]
fn local_preview_stop(
    state: State<'_, LocalPreviewState>,
    id: String,
) -> Result<LocalPreviewStopResult, String> {
    ensure_preview_id(&id)?;
    let mut tunnels = state
        .tunnels
        .lock()
        .map_err(|_| "Local preview state lock is poisoned".to_string())?;
    let Some(mut tunnel) = tunnels.remove(&id) else {
        return Err("Local preview tunnel is not running on this device.".to_string());
    };
    terminate_child(&mut tunnel.child);
    Ok(LocalPreviewStopResult {
        id: tunnel.id.clone(),
        local_url: tunnel.local_url.clone(),
        public_url: tunnel.public_url.clone(),
        stopped: true,
    })
}

#[tauri::command]
fn local_preview_status(
    state: State<'_, LocalPreviewState>,
    id: String,
) -> Result<LocalPreviewStatusResult, String> {
    ensure_preview_id(&id)?;
    let mut tunnels = state
        .tunnels
        .lock()
        .map_err(|_| "Local preview state lock is poisoned".to_string())?;
    let Some(tunnel) = tunnels.get_mut(&id) else {
        return Err("Local preview tunnel is not running on this device.".to_string());
    };
    let status = tunnel
        .child
        .try_wait()
        .map_err(|error| format!("Failed to read cloudflared status: {error}"))?;
    Ok(LocalPreviewStatusResult {
        id: tunnel.id.clone(),
        local_url: tunnel.local_url.clone(),
        public_url: tunnel.public_url.clone(),
        running: status.is_none(),
        local_reachable: local_preview_reachable(&tunnel.local_url),
        exit_status: status.and_then(|status| status.code()),
    })
}

#[tauri::command]
fn terminal_start(
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
fn terminal_list(
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
fn terminal_read(state: State<'_, TerminalState>, id: String) -> Result<TerminalSnapshot, String> {
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
fn terminal_write(
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
fn terminal_stop(state: State<'_, TerminalState>, id: String) -> Result<TerminalSnapshot, String> {
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

#[tauri::command]
fn run_git_workflow(request: GitWorkflowRequest) -> Result<Vec<CommandResult>, String> {
    ensure_existing_dir(&request.cwd)?;
    ensure_safe_branch_name(&request.branch)?;
    let commit_message = normalize_commit_message(&request.message)?;

    let commands = if request.push {
        vec![
            vec!["switch", "-c", request.branch.as_str()],
            vec!["add", "-A"],
            vec!["commit", "-m", commit_message.as_str()],
            vec!["push", "-u", "origin", request.branch.as_str()],
        ]
    } else {
        vec![
            vec!["switch", "-c", request.branch.as_str()],
            vec!["add", "-A"],
            vec!["commit", "-m", commit_message.as_str()],
        ]
    };

    let mut results = Vec::new();
    for args in commands {
        let output = Command::new("git")
            .current_dir(&request.cwd)
            .args(args.clone())
            .output()
            .map_err(|error| format!("Failed to run git {}: {error}", args.join(" ")))?;
        let result = CommandResult {
            command: format!("git {}", args.join(" ")),
            cwd: request.cwd.clone(),
            status: output.status.code(),
            stdout: bound_command_output(&output.stdout),
            stderr: bound_command_output(&output.stderr),
        };
        let success = output.status.success();
        results.push(result);
        if !success {
            return Ok(results);
        }
    }

    Ok(results)
}

#[tauri::command]
fn probe_codex() -> CodexProbe {
    match Command::new("codex").arg("--version").output() {
        Ok(output) if output.status.success() => CodexProbe {
            available: true,
            version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            error: None,
        },
        Ok(output) => CodexProbe {
            available: false,
            version: None,
            error: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        },
        Err(error) => CodexProbe {
            available: false,
            version: None,
            error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
fn run_codex_turn(request: CodexTurnRequest) -> Result<CodexTurnResult, String> {
    ensure_existing_dir(&request.cwd)?;
    ensure_codex_input(&request.input)?;
    let previous_thread_id = normalize_codex_thread_id(request.previous_thread_id.as_deref())?;
    let timeout = codex_timeout(request.timeout_seconds)?;
    let started_at = Instant::now();
    let model = request.model.unwrap_or_else(|| "gpt-5.4".to_string());

    let mut child = Command::new("codex")
        .arg("app-server")
        .current_dir(&request.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start codex app-server: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open codex app-server stdin".to_string())
        .map_err(|error| {
            terminate_child(&mut child);
            error
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open codex app-server stdout".to_string())
        .map_err(|error| {
            terminate_child(&mut child);
            error
        })?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not open codex app-server stderr".to_string())
        .map_err(|error| {
            terminate_child(&mut child);
            error
        })?;

    let (line_tx, line_rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line_tx.send(line).is_err() {
                break;
            }
        }
    });

    let (stderr_tx, stderr_rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if stderr_tx.send(line).is_err() {
                break;
            }
        }
    });

    cleanup_on_error(
        &mut child,
        send_json(
            &mut stdin,
            json!({
                "method": "initialize",
                "id": 1,
                "params": {
                    "clientInfo": {
                        "name": "multaiplayer",
                        "title": "multAIplayer",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": {
                        "experimentalApi": true
                    }
                }
            }),
        ),
    )?;
    cleanup_on_error(
        &mut child,
        wait_for_response(&line_rx, 1, started_at, timeout),
    )?;

    cleanup_on_error(
        &mut child,
        send_json(&mut stdin, json!({ "method": "initialized", "params": {} })),
    )?;
    cleanup_on_error(
        &mut child,
        send_json(
            &mut stdin,
            codex_thread_request(2, previous_thread_id.as_deref(), &request.cwd, &model),
        ),
    )?;
    let thread_response = cleanup_on_error(
        &mut child,
        wait_for_response_message(&line_rx, 2, started_at, timeout),
    )?;
    let mut events = Vec::new();
    let mut thread_id = thread_response
        .get("result")
        .and_then(|result| result.get("thread"))
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            thread_response
                .get("error")
                .map(|error| format!("thread/resume failed: {error}"))
                .unwrap_or_else(|| {
                    format!("thread start/resume did not return a thread id: {thread_response}")
                })
        })
        .or_else(|error| {
            let Some(previous_thread_id) = previous_thread_id.as_deref() else {
                return Err(error);
            };
            events.push(format!(
                "{error}; starting a new thread instead of {previous_thread_id}."
            ));
            cleanup_on_error(
                &mut child,
                send_json(
                    &mut stdin,
                    codex_thread_start_request(4, &request.cwd, &model),
                ),
            )?;
            let fallback_response = cleanup_on_error(
                &mut child,
                wait_for_response(&line_rx, 4, started_at, timeout),
            )?;
            fallback_response
                .get("result")
                .and_then(|result| result.get("thread"))
                .and_then(|thread| thread.get("id"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| {
                    format!("thread/start fallback did not return a thread id: {fallback_response}")
                })
        })
        .map_err(|error| {
            terminate_child(&mut child);
            error
        })?;
    if previous_thread_id.as_deref() == Some(thread_id.as_str()) {
        events.push(format!("thread/resume: {thread_id}"));
    } else {
        events.push(format!("thread/start: {thread_id}"));
    }

    cleanup_on_error(
        &mut child,
        send_json(
            &mut stdin,
            json!({
                "method": "turn/start",
                "id": 3,
                "params": {
                    "threadId": thread_id,
                    "input": [{ "type": "text", "text": request.input }],
                    "cwd": request.cwd,
                    "model": model
                }
            }),
        ),
    )?;

    let mut transcript = String::new();

    let status = loop {
        if started_at.elapsed() > timeout {
            break "timeout".to_string();
        }

        match line_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(line) => {
                let parsed: Value = match serde_json::from_str(&line) {
                    Ok(parsed) => parsed,
                    Err(error) => {
                        events.push(format!("Invalid app-server JSON line: {error}"));
                        break "error".to_string();
                    }
                };
                if parsed.get("id").and_then(Value::as_i64) == Some(3) {
                    events.push("turn/start acknowledged".to_string());
                    if let Some(error) = parsed.get("error") {
                        events.push(error.to_string());
                        break "error".to_string();
                    }
                    continue;
                }

                let method = parsed.get("method").and_then(Value::as_str).unwrap_or("");
                if method.contains("agentMessage") || method.contains("message") {
                    if let Some(delta) = extract_text_delta(&parsed) {
                        transcript.push_str(&delta);
                    }
                }

                if !method.is_empty() {
                    events.push(method.to_string());
                }

                if method == "turn/completed" {
                    break parsed
                        .get("params")
                        .and_then(|params| params.get("status"))
                        .and_then(Value::as_str)
                        .unwrap_or("completed")
                        .to_string();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break "disconnected".to_string(),
        }
    };

    terminate_child(&mut child);
    let stderr = stderr_rx.try_iter().collect::<Vec<_>>().join("\n");

    Ok(CodexTurnResult {
        thread_id: Some(std::mem::take(&mut thread_id)),
        status,
        transcript,
        events,
        stderr,
    })
}

fn ensure_existing_dir(cwd: &str) -> Result<(), String> {
    ensure_project_path(cwd)?;
    let path = Path::new(cwd);
    if path.is_dir() {
        Ok(())
    } else {
        Err(format!("{cwd} is not an existing directory"))
    }
}

fn canonical_project_root(cwd: &str) -> Result<PathBuf, String> {
    ensure_project_path(cwd)?;
    fs::canonicalize(cwd).map_err(|error| format!("Failed to resolve project path: {error}"))
}

fn next_available_clone_path(parent_dir: &Path, repo_name: &str) -> Result<PathBuf, String> {
    let parent = fs::canonicalize(parent_dir)
        .map_err(|error| format!("Failed to resolve clone parent folder: {error}"))?;
    for index in 0..100 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("-{index}")
        };
        let candidate = parent.join(format!("{repo_name}{suffix}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not find an available clone folder name.".to_string())
}

fn codex_thread_request(
    id: i64,
    previous_thread_id: Option<&str>,
    cwd: &str,
    model: &str,
) -> Value {
    match previous_thread_id {
        Some(thread_id) => codex_thread_resume_request(id, thread_id, cwd, model),
        None => codex_thread_start_request(id, cwd, model),
    }
}

fn codex_thread_start_request(id: i64, cwd: &str, model: &str) -> Value {
    json!({
        "method": "thread/start",
        "id": id,
        "params": {
            "model": model,
            "cwd": cwd
        }
    })
}

fn codex_thread_resume_request(id: i64, thread_id: &str, cwd: &str, model: &str) -> Value {
    json!({
        "method": "thread/resume",
        "id": id,
        "params": {
            "threadId": thread_id,
            "model": model,
            "cwd": cwd,
            "excludeTurns": true
        }
    })
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
    T: std::io::Read + Send + 'static,
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

fn push_terminal_line(output: &Arc<Mutex<Vec<TerminalLine>>>, line: TerminalLine) {
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

fn send_json(stdin: &mut ChildStdin, value: Value) -> Result<(), String> {
    writeln!(stdin, "{value}")
        .map_err(|error| format!("Failed to write app-server JSON: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("Failed to flush app-server stdin: {error}"))
}

fn wait_for_response(
    line_rx: &mpsc::Receiver<String>,
    id: i64,
    started_at: Instant,
    timeout: Duration,
) -> Result<Value, String> {
    let parsed = wait_for_response_message(line_rx, id, started_at, timeout)?;
    if let Some(error) = parsed.get("error") {
        return Err(format!("App-server request {id} failed: {error}"));
    }
    Ok(parsed)
}

fn wait_for_response_message(
    line_rx: &mpsc::Receiver<String>,
    id: i64,
    started_at: Instant,
    timeout: Duration,
) -> Result<Value, String> {
    loop {
        if started_at.elapsed() > timeout {
            return Err(format!("Timed out waiting for app-server response id {id}"));
        }

        let line = line_rx
            .recv_timeout(Duration::from_millis(500))
            .map_err(|error| format!("App-server response channel closed: {error}"))?;
        let parsed: Value = serde_json::from_str(&line)
            .map_err(|error| format!("Invalid app-server JSON line: {error}; {line}"))?;
        if parsed.get("id").and_then(Value::as_i64) == Some(id) {
            return Ok(parsed);
        }
    }
}

fn extract_text_delta(value: &Value) -> Option<String> {
    let params = value.get("params")?;
    for key in ["delta", "text", "message", "content"] {
        if let Some(text) = params.get(key).and_then(Value::as_str) {
            return Some(text.to_string());
        }
    }
    if let Some(item) = params.get("item") {
        for key in ["text", "message", "content"] {
            if let Some(text) = item.get(key).and_then(Value::as_str) {
                return Some(text.to_string());
            }
        }
    }
    None
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn cleanup_on_error<T>(child: &mut Child, result: Result<T, String>) -> Result<T, String> {
    if result.is_err() {
        terminate_child(child);
    }
    result
}

fn capture_preview_stream<T>(stream: T, sender: mpsc::Sender<String>)
where
    T: Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().flatten() {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
}

fn extract_trycloudflare_url(line: &str) -> Option<String> {
    line.split_whitespace()
        .map(|part| {
            part.trim_matches(|character: char| {
                matches!(
                    character,
                    '"' | '\'' | '`' | '<' | '>' | '(' | ')' | '[' | ']' | ',' | '.'
                )
            })
        })
        .find(|part| part.starts_with("https://") && part.contains(TRYCLOUDFLARE_MARKER))
        .map(|part| part.to_string())
}

fn append_bounded(output: &mut String, line: &str, max_chars: usize) {
    if !output.is_empty() {
        output.push('\n');
    }
    output.push_str(line);
    if output.len() > max_chars {
        let excess = output.len() - max_chars;
        output.drain(..excess);
    }
}

fn trim_command_output(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= 4_000 {
        return trimmed.to_string();
    }
    format!("...{}", &trimmed[trimmed.len().saturating_sub(4_000)..])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .manage(LocalPreviewState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            app_version,
            git_status,
            git_remote_origin,
            git_create_patch,
            git_clone_repository,
            git_apply_patch,
            git_diff_file,
            project_files,
            project_file_read,
            run_shell_command,
            terminal_start,
            terminal_list,
            terminal_read,
            terminal_write,
            terminal_stop,
            detect_local_preview_servers,
            probe_cloudflared,
            local_preview_start,
            local_preview_status,
            local_preview_stop,
            open_browser_view,
            reset_browser_profile,
            room_secret_get,
            room_secret_set,
            room_secret_delete,
            device_identity_get,
            device_identity_set,
            device_identity_delete,
            run_git_workflow,
            probe_codex,
            run_codex_turn
        ])
        .run(tauri::generate_context!())
        .expect("error while running multAIplayer");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn safe_project_path_allows_project_relative_files() {
        let root = test_temp_dir("safe-path-allow");
        write(root.join("README.md"), "hello").expect("write test file");

        let resolved = safe_project_path(&root, "README.md").expect("resolve project file");

        assert_eq!(
            resolved,
            fs::canonicalize(root.join("README.md")).expect("canonical test file")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn project_path_validation_rejects_unsafe_working_directories() {
        let root = test_temp_dir("project-path-validation");
        assert!(ensure_existing_dir(root.to_str().expect("utf8 temp path")).is_ok());

        for path in [
            "",
            "relative/project",
            " /tmp/project",
            "/tmp/project ",
            "/tmp/project\nsecret",
        ] {
            assert!(
                ensure_existing_dir(path).is_err(),
                "{path:?} should be rejected"
            );
        }
        assert!(
            ensure_existing_dir(&format!("/tmp/{}", "x".repeat(MAX_PROJECT_PATH_CHARS))).is_err()
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn safe_project_path_rejects_parent_and_symlink_escape() {
        let root = test_temp_dir("safe-path-reject");
        let outside = test_temp_dir("safe-path-outside");
        write(root.join("inside.txt"), "inside").expect("write inside file");
        write(outside.join("secret.txt"), "secret").expect("write outside file");

        assert!(safe_project_path(&root, "../secret.txt").is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("linked-secret.txt"))
                .expect("create symlink");
            assert!(safe_project_path(&root, "linked-secret.txt").is_err());
        }

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn collect_project_files_skips_symlinked_entries() {
        let root = test_temp_dir("collect-files");
        let outside = test_temp_dir("collect-files-outside");
        write(root.join("visible.txt"), "visible").expect("write visible file");
        write(outside.join("secret.txt"), "secret").expect("write outside file");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("linked-secret.txt"))
                .expect("create file symlink");
            create_dir_all(outside.join("linked-dir")).expect("create outside dir");
            write(outside.join("linked-dir/secret.md"), "secret").expect("write linked dir secret");
            std::os::unix::fs::symlink(outside.join("linked-dir"), root.join("linked-dir"))
                .expect("create dir symlink");
        }

        let mut files = Vec::new();
        collect_project_files(&root, &root, "", 20, &mut files).expect("collect files");
        let paths = files.into_iter().map(|file| file.path).collect::<Vec<_>>();

        assert!(paths.contains(&"visible.txt".to_string()));
        assert!(!paths.contains(&"linked-secret.txt".to_string()));
        assert!(!paths.iter().any(|path| path.contains("secret.md")));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn git_diff_output_is_bounded_with_truncation_marker() {
        let huge_diff = format!("start\n{}\nend", "x".repeat(MAX_GIT_DIFF_CHARS + 50_000));
        let bounded = bound_git_diff(&huge_diff);

        assert!(bounded.chars().count() <= MAX_GIT_DIFF_CHARS);
        assert!(bounded.contains("multAIplayer truncated this diff"));
        assert!(bounded.starts_with("start"));
        assert!(bounded.ends_with("end"));
    }

    #[test]
    fn host_handoff_git_remote_validation_allows_github_only() {
        assert!(ensure_git_remote_url("https://github.com/maddiedreese/multAIplayer.git").is_ok());
        assert!(ensure_git_remote_url("git@github.com:maddiedreese/multAIplayer.git").is_ok());
        assert!(
            ensure_git_remote_url("ssh://git@github.com/maddiedreese/multAIplayer.git").is_ok()
        );
        assert!(
            ensure_git_remote_url("https://example.com/maddiedreese/multAIplayer.git").is_err()
        );
        assert!(
            ensure_git_remote_url(" https://github.com/maddiedreese/multAIplayer.git").is_err()
        );
    }

    #[test]
    fn host_handoff_repo_name_is_derived_from_remote() {
        assert_eq!(
            repo_name_from_remote_url("https://github.com/maddiedreese/multAIplayer.git")
                .expect("repo name"),
            "multAIplayer"
        );
        assert_eq!(
            repo_name_from_remote_url("git@github.com:maddiedreese/multAIplayer.git")
                .expect("repo name"),
            "multAIplayer"
        );
    }

    #[test]
    fn host_handoff_patch_validation_bounds_payload() {
        assert!(ensure_git_patch("diff --git a/README.md b/README.md\n").is_ok());
        assert!(ensure_git_patch("").is_err());
        assert!(ensure_git_patch(&"x".repeat(MAX_GIT_PATCH_CHARS + 1)).is_err());
        assert!(ensure_git_patch("diff\0bad").is_err());
    }

    #[test]
    fn host_handoff_patch_round_trips_tracked_changes() {
        let source =
            std::env::temp_dir().join(format!("multaiplayer-patch-source-{}", std::process::id()));
        let target =
            std::env::temp_dir().join(format!("multaiplayer-patch-target-{}", std::process::id()));
        let _ = fs::remove_dir_all(&source);
        let _ = fs::remove_dir_all(&target);
        fs::create_dir_all(&source).expect("create source repo");
        fs::create_dir_all(&target).expect("create target repo");

        for repo in [&source, &target] {
            Command::new("git")
                .args(["init"])
                .current_dir(repo)
                .output()
                .expect("git init");
            fs::write(repo.join("README.md"), "before\n").expect("seed file");
            Command::new("git")
                .args(["add", "README.md"])
                .current_dir(repo)
                .output()
                .expect("git add");
            Command::new("git")
                .args([
                    "-c",
                    "user.name=multAIplayer",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "-m",
                    "seed",
                ])
                .current_dir(repo)
                .output()
                .expect("git commit");
        }

        fs::write(source.join("README.md"), "after\n").expect("modify source file");
        let patch = git_create_patch(source.to_string_lossy().to_string()).expect("create patch");
        assert!(!patch.patch.is_empty());
        assert!(!patch.truncated);
        let applied = git_apply_patch(GitApplyPatchRequest {
            cwd: target.to_string_lossy().to_string(),
            patch: patch.patch,
        })
        .expect("apply patch");
        assert_eq!(applied.status, Some(0), "{applied:?}");
        assert_eq!(
            fs::read_to_string(target.join("README.md")).expect("read target file"),
            "after\n"
        );

        let _ = fs::remove_dir_all(source);
        let _ = fs::remove_dir_all(target);
    }

    #[test]
    fn command_output_is_bounded_with_truncation_marker() {
        let huge_output = format!(
            "first line\n{}\nlast line",
            "x".repeat(MAX_COMMAND_OUTPUT_CHARS + 50_000)
        );
        let bounded = bound_command_output(huge_output.as_bytes());

        assert!(bounded.chars().count() <= MAX_COMMAND_OUTPUT_CHARS);
        assert!(bounded.contains("multAIplayer truncated command output"));
        assert!(bounded.starts_with("first line"));
        assert!(bounded.ends_with("last line"));
    }

    #[test]
    fn untracked_file_diff_streams_and_bounds_large_files() {
        let root = test_temp_dir("untracked-diff-bounds");
        let path = root.join("generated.log");
        write(
            &path,
            format!(
                "first line\n{}\nlast line",
                "x".repeat(MAX_GIT_DIFF_CHARS + 50_000)
            ),
        )
        .expect("write generated file");

        let diff = untracked_file_diff(&path, "generated.log").expect("untracked diff");

        assert!(diff.chars().count() <= MAX_GIT_DIFF_CHARS);
        assert!(diff.starts_with("+++ b/generated.log"));
        assert!(diff.contains("+first line"));
        assert!(diff.contains("multAIplayer truncated this diff"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validate_browser_url_allows_http_and_https_with_hosts() {
        assert_eq!(
            validate_browser_url("https://github.com/maddiedreese/multAIplayer")
                .expect("valid https")
                .host_str(),
            Some("github.com")
        );
        assert_eq!(
            validate_browser_url("http://127.0.0.1:1420")
                .expect("valid local http")
                .host_str(),
            Some("127.0.0.1")
        );
    }

    #[test]
    fn validate_browser_url_rejects_non_web_schemes_and_missing_hosts() {
        assert!(validate_browser_url("file:///etc/passwd").is_err());
        assert!(validate_browser_url("javascript:alert(1)").is_err());
        assert!(validate_browser_url("http:/").is_err());
    }

    #[test]
    fn sanitize_window_label_replaces_unsupported_room_id_characters() {
        assert_eq!(
            sanitize_window_label("room:../../secret page"),
            "room-------secret-page"
        );
    }

    #[test]
    fn browser_profile_scope_is_separate_per_project() {
        let first = browser_profile_scope("room-alpha", Some("/Users/maddie/project-a"))
            .expect("first browser profile scope");
        let second = browser_profile_scope("room-alpha", Some("/Users/maddie/project-b"))
            .expect("second browser profile scope");
        let first_again = browser_profile_scope("room-alpha", Some("  /Users/maddie/project-a  "))
            .expect("stable browser profile scope");

        assert_ne!(first, second);
        assert_eq!(first, first_again);
        assert!(first.starts_with("room-alpha--project-"));
        assert!(
            browser_window_label("room-alpha", Some("/Users/maddie/project-a"))
                .expect("browser label")
                .starts_with("room-browser-room-alpha--project-")
        );
    }

    #[test]
    fn room_browser_guard_script_blocks_clipboard_and_file_inputs() {
        assert!(ROOM_BROWSER_GUARD_SCRIPT.contains("navigator.clipboard"));
        assert!(ROOM_BROWSER_GUARD_SCRIPT.contains("writeText"));
        assert!(ROOM_BROWSER_GUARD_SCRIPT.contains("input[type=file]"));
        assert!(ROOM_BROWSER_GUARD_SCRIPT.contains("dragover"));
        assert!(ROOM_BROWSER_GUARD_SCRIPT.contains("drop"));
    }

    #[test]
    fn keychain_account_rejects_room_ids_with_unsupported_characters() {
        assert!(keychain_account("room-alpha_123").is_ok());
        assert!(keychain_account("").is_err());
        assert!(keychain_account(" room-alpha").is_err());
        assert!(keychain_account("room alpha").is_err());
        assert!(keychain_account("room.alpha").is_err());
        assert!(keychain_account("room:../../secret").is_err());
        assert!(keychain_account(&"x".repeat(MAX_ROOM_ID_CHARS + 1)).is_err());
    }

    #[test]
    fn device_identity_payload_validation_bounds_native_storage() {
        assert!(ensure_device_identity_payload(r#"{"algorithm":"ECDH"}"#).is_ok());
        assert!(ensure_device_identity_payload("").is_err());
        assert!(ensure_device_identity_payload("not-json").is_err());
        assert!(
            ensure_device_identity_payload(&"{".repeat(MAX_DEVICE_IDENTITY_CHARS + 1)).is_err()
        );
    }

    #[test]
    fn terminal_validation_rejects_bad_names_and_oversized_text() {
        assert!(ensure_room_id("room-alpha_123").is_ok());
        assert!(ensure_room_id("room.alpha").is_err());
        assert!(ensure_room_id("room/alpha").is_err());
        assert!(ensure_room_id(&"x".repeat(MAX_ROOM_ID_CHARS + 1)).is_err());

        assert!(ensure_terminal_id("room-alpha_123:dev-server.1").is_ok());
        assert!(ensure_terminal_id("room-alpha_123").is_err());
        assert!(ensure_terminal_id("room-alpha_123:dev server").is_err());
        assert!(ensure_terminal_id("room-alpha_123:dev:server").is_err());

        assert!(ensure_terminal_name("dev-server.1").is_ok());
        assert!(ensure_terminal_name("").is_err());
        assert!(ensure_terminal_name("bad name").is_err());
        assert!(ensure_terminal_name("bad:name").is_err());

        assert!(ensure_terminal_command("npm test").is_ok());
        assert!(ensure_terminal_command("   ").is_err());
        assert!(ensure_terminal_command(&"x".repeat(MAX_TERMINAL_COMMAND_CHARS + 1)).is_err());

        assert!(ensure_terminal_input("rs").is_ok());
        assert!(ensure_terminal_input("\n").is_err());
        assert!(ensure_terminal_input(&"x".repeat(MAX_TERMINAL_INPUT_CHARS + 1)).is_err());
    }

    #[test]
    fn branch_validation_rejects_unsafe_git_refs() {
        assert!(ensure_safe_branch_name("codex/ship-it").is_ok());
        for branch in [
            "",
            " codex/ship-it",
            "-bad",
            "@",
            "bad branch",
            "bad\nbranch",
            "bad..branch",
            "bad~branch",
            "bad^branch",
            "bad:branch",
            "bad?branch",
            "bad*branch",
            "bad[branch",
            "bad\\branch",
            "bad//branch",
            ".bad/branch",
            "bad/.branch",
            "bad/branch.lock",
            "bad/",
            "bad.",
            "bad@{branch",
        ] {
            assert!(
                ensure_safe_branch_name(branch).is_err(),
                "{branch} should be rejected"
            );
        }
        assert!(
            ensure_safe_branch_name(&format!("codex/{}", "x".repeat(MAX_GIT_BRANCH_CHARS)))
                .is_err()
        );
    }

    #[test]
    fn commit_message_validation_trims_normalizes_and_bounds_text() {
        assert_eq!(
            normalize_commit_message("  Ship   the thing\nnow  ").expect("valid message"),
            "Ship the thing now"
        );
        assert!(normalize_commit_message(" \n\t ").is_err());
        assert!(normalize_commit_message(&"x".repeat(MAX_COMMIT_MESSAGE_CHARS + 1)).is_err());
    }

    #[test]
    fn one_shot_shell_command_uses_terminal_command_bounds() {
        let root = test_temp_dir("shell-command-bounds");

        assert!(run_shell_command(ShellCommandRequest {
            cwd: root.to_string_lossy().to_string(),
            command: "   ".to_string(),
        })
        .is_err());
        assert!(run_shell_command(ShellCommandRequest {
            cwd: root.to_string_lossy().to_string(),
            command: "x".repeat(MAX_TERMINAL_COMMAND_CHARS + 1),
        })
        .is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_turn_validation_bounds_input_and_timeout() {
        assert!(ensure_codex_input("Summarize the room").is_ok());
        assert!(ensure_codex_input("   ").is_err());
        assert!(ensure_codex_input(&"x".repeat(MAX_CODEX_INPUT_CHARS + 1)).is_err());

        assert_eq!(
            codex_timeout(None).expect("default timeout"),
            Duration::from_secs(180)
        );
        assert_eq!(
            codex_timeout(Some(MIN_CODEX_TIMEOUT_SECONDS)).expect("minimum timeout"),
            Duration::from_secs(MIN_CODEX_TIMEOUT_SECONDS)
        );
        assert_eq!(
            codex_timeout(Some(MAX_CODEX_TIMEOUT_SECONDS)).expect("maximum timeout"),
            Duration::from_secs(MAX_CODEX_TIMEOUT_SECONDS)
        );
        assert!(codex_timeout(Some(MIN_CODEX_TIMEOUT_SECONDS - 1)).is_err());
        assert!(codex_timeout(Some(MAX_CODEX_TIMEOUT_SECONDS + 1)).is_err());
    }

    #[test]
    fn codex_thread_id_validation_bounds_resume_ids() {
        assert_eq!(
            normalize_codex_thread_id(Some("  thr_123-abc:def.456  ")).expect("valid thread id"),
            Some("thr_123-abc:def.456".to_string())
        );
        assert_eq!(normalize_codex_thread_id(Some("   ")).expect("blank"), None);
        assert!(normalize_codex_thread_id(Some("bad thread")).is_err());
        assert!(normalize_codex_thread_id(Some("bad/thread")).is_err());
        assert!(
            normalize_codex_thread_id(Some(&"x".repeat(MAX_CODEX_THREAD_ID_CHARS + 1))).is_err()
        );
    }

    #[test]
    fn codex_thread_request_starts_or_resumes_room_thread() {
        let start = codex_thread_request(2, None, "/tmp/project", "gpt-5.4-mini");
        assert_eq!(start["method"], "thread/start");
        assert_eq!(start["id"], 2);
        assert_eq!(start["params"]["cwd"], "/tmp/project");
        assert_eq!(start["params"]["model"], "gpt-5.4-mini");

        let resume = codex_thread_request(3, Some("thr_room_123"), "/tmp/project", "gpt-5.4");
        assert_eq!(resume["method"], "thread/resume");
        assert_eq!(resume["id"], 3);
        assert_eq!(resume["params"]["threadId"], "thr_room_123");
        assert_eq!(resume["params"]["cwd"], "/tmp/project");
        assert_eq!(resume["params"]["model"], "gpt-5.4");
        assert_eq!(resume["params"]["excludeTurns"], true);
    }

    #[test]
    fn terminal_output_buffer_keeps_latest_lines() {
        let output = Arc::new(Mutex::new(Vec::new()));
        for index in 0..1_005 {
            push_terminal_line(
                &output,
                TerminalLine {
                    stream: "stdout".to_string(),
                    text: format!("line {index}"),
                },
            );
        }

        let lines = output.lock().expect("terminal output lock");
        assert_eq!(lines.len(), 1_000);
        assert_eq!(lines.first().map(|line| line.text.as_str()), Some("line 5"));
        assert_eq!(
            lines.last().map(|line| line.text.as_str()),
            Some("line 1004")
        );
    }

    fn test_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("multaiplayer-{name}-{nanos}"));
        create_dir_all(&path).expect("create temp dir");
        path
    }
}
