use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{hash_map::DefaultHasher, HashMap};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{webview::DownloadEvent, AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

const KEYCHAIN_SERVICE: &str = "com.multaiplayer.desktop.room-secrets";
const DEVICE_IDENTITY_ACCOUNT: &str = "device-identity:v1";
const MAX_TERMINAL_COMMAND_CHARS: usize = 4_000;
const MAX_TERMINAL_INPUT_CHARS: usize = 4_000;
const MAX_CODEX_INPUT_CHARS: usize = 240_000;
const MAX_CODEX_THREAD_ID_CHARS: usize = 200;
const MAX_DEVICE_IDENTITY_CHARS: usize = 16_384;
const MAX_GIT_DIFF_CHARS: usize = 200_000;
const MAX_COMMAND_OUTPUT_CHARS: usize = 120_000;
const MAX_GIT_BRANCH_CHARS: usize = 200;
const MAX_COMMIT_MESSAGE_CHARS: usize = 500;
const MAX_PROJECT_PATH_CHARS: usize = 2_048;
const MAX_ROOM_ID_CHARS: usize = 160;
const MIN_CODEX_TIMEOUT_SECONDS: u64 = 10;
const MAX_CODEX_TIMEOUT_SECONDS: u64 = 900;
const ROOM_BROWSER_GUARD_SCRIPT: &str = r#"
(() => {
  const blocked = () => Promise.reject(new DOMException("multAIplayer blocks room browser clipboard access by default.", "NotAllowedError"));
  try {
    if (navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: false,
        enumerable: true,
        value: Object.freeze({
          read: blocked,
          readText: blocked,
          write: blocked,
          writeText: blocked
        })
      });
    }
  } catch (_) {}

  const isFileInput = (target) => {
    if (!target || !target.closest) return false;
    const input = target.closest("input[type=file]");
    return Boolean(input);
  };
  const block = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener("click", (event) => {
    if (isFileInput(event.target)) block(event);
  }, true);
  window.addEventListener("change", (event) => {
    if (isFileInput(event.target)) {
      try { event.target.value = ""; } catch (_) {}
      block(event);
    }
  }, true);
  window.addEventListener("drop", block, true);
  window.addEventListener("dragover", block, true);
})();
"#;

#[derive(Default)]
struct TerminalState {
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
struct ProjectFileEntry {
    path: String,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFileContent {
    path: String,
    size: u64,
    truncated: bool,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFileSearchRequest {
    cwd: String,
    query: String,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFileReadRequest {
    cwd: String,
    path: String,
    max_bytes: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffRequest {
    cwd: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffResult {
    path: String,
    diff: String,
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
struct BrowserOpenRequest {
    room_id: String,
    project_path: Option<String>,
    url: String,
    title: Option<String>,
    persistent: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserOpenResult {
    label: String,
    url: String,
    reused: bool,
    profile_path: String,
    persistent: bool,
    downloads_blocked: bool,
    clipboard_blocked: bool,
    file_uploads_blocked: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitWorkflowRequest {
    cwd: String,
    branch: String,
    message: String,
    push: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomSecretRequest {
    room_id: String,
    secret: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserProfileRequest {
    room_id: String,
    project_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserProfileResult {
    room_id: String,
    profile_path: String,
    reset: bool,
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
fn project_files(request: ProjectFileSearchRequest) -> Result<Vec<ProjectFileEntry>, String> {
    ensure_existing_dir(&request.cwd)?;
    let root = canonical_project_root(&request.cwd)?;
    let query = request.query.trim().to_lowercase();
    let limit = request.limit.unwrap_or(80).clamp(1, 200);
    let mut results = Vec::new();
    collect_project_files(&root, &root, &query, limit, &mut results)?;
    results.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(results)
}

#[tauri::command]
fn project_file_read(request: ProjectFileReadRequest) -> Result<ProjectFileContent, String> {
    ensure_existing_dir(&request.cwd)?;
    let root = canonical_project_root(&request.cwd)?;
    let requested = safe_project_path(&root, &request.path)?;
    let metadata = fs::metadata(&requested)
        .map_err(|error| format!("Failed to read file metadata: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", request.path));
    }
    let max_bytes = request.max_bytes.unwrap_or(80_000).clamp(1_024, 250_000);
    let bytes = fs::read(&requested).map_err(|error| format!("Failed to read file: {error}"))?;
    let truncated = bytes.len() > max_bytes;
    let slice = if truncated {
        &bytes[..max_bytes]
    } else {
        &bytes
    };
    let content = String::from_utf8_lossy(slice).to_string();
    Ok(ProjectFileContent {
        path: request.path,
        size: metadata.len(),
        truncated,
        content,
    })
}

#[tauri::command]
fn git_diff_file(request: GitDiffRequest) -> Result<GitDiffResult, String> {
    ensure_existing_dir(&request.cwd)?;
    let root = canonical_project_root(&request.cwd)?;
    let requested = safe_project_path(&root, &request.path)?;

    let status_output = Command::new("git")
        .args([
            "-C",
            &request.cwd,
            "status",
            "--porcelain=v1",
            "--",
            &request.path,
        ])
        .output()
        .map_err(|error| format!("Failed to run git status: {error}"))?;
    if !status_output.status.success() {
        return Err(String::from_utf8_lossy(&status_output.stderr)
            .trim()
            .to_string());
    }

    let status = String::from_utf8_lossy(&status_output.stdout);
    let untracked = status.lines().any(|line| line.starts_with("??"));
    if untracked {
        let diff = untracked_file_diff(&requested, &request.path)?;
        return Ok(GitDiffResult {
            path: request.path,
            diff,
        });
    }

    let output = Command::new("git")
        .args(["-C", &request.cwd, "diff", "--", &request.path])
        .output()
        .map_err(|error| format!("Failed to run git diff: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(GitDiffResult {
        path: request.path,
        diff: bound_git_diff(&String::from_utf8_lossy(&output.stdout)),
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
    writeln!(session.writer, "{}", request.input)
        .map_err(|error| format!("Failed to write terminal input: {error}"))?;
    session
        .writer
        .flush()
        .map_err(|error| format!("Failed to flush terminal input: {error}"))?;
    push_terminal_line(
        &session.output,
        TerminalLine {
            stream: "stdin".to_string(),
            text: request.input,
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
fn open_browser_view(
    app: AppHandle,
    request: BrowserOpenRequest,
) -> Result<BrowserOpenResult, String> {
    let url = validate_browser_url(&request.url)?;
    let persistent = request.persistent.unwrap_or(true);

    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    let profile_dir = browser_profile_dir(&app, &request.room_id, request.project_path.as_deref())?;
    if !persistent {
        if let Some(window) = app.get_webview_window(&label) {
            window
                .close()
                .map_err(|error| format!("Failed to close room browser before refresh: {error}"))?;
        }
        if profile_dir.exists() {
            fs::remove_dir_all(&profile_dir)
                .map_err(|error| format!("Failed to refresh room browser profile: {error}"))?;
        }
    }
    fs::create_dir_all(&profile_dir)
        .map_err(|error| format!("Failed to create room browser profile: {error}"))?;
    let title = request
        .title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            format!(
                "multAIplayer Browser - {}",
                url.host_str().unwrap_or("approved page")
            )
        });

    if persistent {
        if let Some(window) = app.get_webview_window(&label) {
            window
                .navigate(url.clone())
                .map_err(|error| format!("Failed to navigate browser view: {error}"))?;
            window
                .set_title(&title)
                .map_err(|error| format!("Failed to retitle browser view: {error}"))?;
            window
                .set_focus()
                .map_err(|error| format!("Failed to focus browser view: {error}"))?;
            return Ok(BrowserOpenResult {
                label,
                url: url.to_string(),
                reused: true,
                profile_path: profile_dir.to_string_lossy().to_string(),
                persistent,
                downloads_blocked: true,
                clipboard_blocked: true,
                file_uploads_blocked: true,
            });
        }
    }

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url.clone()))
        .title(&title)
        .inner_size(1120.0, 820.0)
        .min_inner_size(720.0, 520.0)
        .data_directory(profile_dir.clone())
        .initialization_script_for_all_frames(ROOM_BROWSER_GUARD_SCRIPT)
        .on_download(|_webview, event| match event {
            DownloadEvent::Requested { url, .. } => {
                eprintln!("Blocked multAIplayer room browser download: {url}");
                false
            }
            DownloadEvent::Finished { .. } => true,
            _ => true,
        })
        .build()
        .map_err(|error| format!("Failed to open browser view: {error}"))?;

    Ok(BrowserOpenResult {
        label,
        url: url.to_string(),
        reused: false,
        profile_path: profile_dir.to_string_lossy().to_string(),
        persistent,
        downloads_blocked: true,
        clipboard_blocked: true,
        file_uploads_blocked: true,
    })
}

#[tauri::command]
fn reset_browser_profile(
    app: AppHandle,
    request: BrowserProfileRequest,
) -> Result<BrowserProfileResult, String> {
    let label = browser_window_label(&request.room_id, request.project_path.as_deref())?;
    if let Some(window) = app.get_webview_window(&label) {
        window
            .close()
            .map_err(|error| format!("Failed to close room browser before reset: {error}"))?;
    }

    let profile_dir = browser_profile_dir(&app, &request.room_id, request.project_path.as_deref())?;
    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir)
            .map_err(|error| format!("Failed to reset room browser profile: {error}"))?;
    }

    Ok(BrowserProfileResult {
        room_id: request.room_id,
        profile_path: profile_dir.to_string_lossy().to_string(),
        reset: true,
    })
}

#[tauri::command]
fn room_secret_get(room_id: String) -> Result<Option<String>, String> {
    let account = keychain_account(&room_id)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|error| format!("Failed to open room secret keychain entry: {error}"))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read room secret from keychain: {error}")),
    }
}

#[tauri::command]
fn room_secret_set(request: RoomSecretRequest) -> Result<(), String> {
    let account = keychain_account(&request.room_id)?;
    let secret = request
        .secret
        .ok_or_else(|| "room secret is required".to_string())?;
    if secret.trim().is_empty() || secret.len() > 4096 {
        return Err("room secret is invalid".to_string());
    }
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|error| format!("Failed to open room secret keychain entry: {error}"))?;
    entry
        .set_password(&secret)
        .map_err(|error| format!("Failed to save room secret to keychain: {error}"))
}

#[tauri::command]
fn room_secret_delete(room_id: String) -> Result<(), String> {
    let account = keychain_account(&room_id)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|error| format!("Failed to open room secret keychain entry: {error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete room secret from keychain: {error}"
        )),
    }
}

#[tauri::command]
fn device_identity_get() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, DEVICE_IDENTITY_ACCOUNT)
        .map_err(|error| format!("Failed to open device identity keychain entry: {error}"))?;
    match entry.get_password() {
        Ok(identity) => Ok(Some(identity)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "Failed to read device identity from keychain: {error}"
        )),
    }
}

#[tauri::command]
fn device_identity_set(identity: String) -> Result<(), String> {
    ensure_device_identity_payload(&identity)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, DEVICE_IDENTITY_ACCOUNT)
        .map_err(|error| format!("Failed to open device identity keychain entry: {error}"))?;
    entry
        .set_password(&identity)
        .map_err(|error| format!("Failed to save device identity to keychain: {error}"))
}

#[tauri::command]
fn device_identity_delete() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, DEVICE_IDENTITY_ACCOUNT)
        .map_err(|error| format!("Failed to open device identity keychain entry: {error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete device identity from keychain: {error}"
        )),
    }
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

fn ensure_project_path(cwd: &str) -> Result<(), String> {
    if cwd.trim().is_empty() {
        return Err("Project path is required".to_string());
    }
    if cwd != cwd.trim() {
        return Err("Project path cannot have leading or trailing whitespace".to_string());
    }
    if cwd.chars().count() > MAX_PROJECT_PATH_CHARS {
        return Err(format!(
            "Project path must be {MAX_PROJECT_PATH_CHARS} characters or fewer"
        ));
    }
    if cwd.chars().any(char::is_control) {
        return Err("Project path cannot contain control characters".to_string());
    }
    if !Path::new(cwd).is_absolute() {
        return Err("Project path must be absolute".to_string());
    }
    Ok(())
}

fn safe_project_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("File path must stay inside the project".to_string());
    }
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("Failed to resolve project path: {error}"))?;
    let joined = root.join(relative);
    let canonical = fs::canonicalize(&joined)
        .map_err(|error| format!("Failed to resolve file path: {error}"))?;
    if canonical.starts_with(&canonical_root) {
        Ok(canonical)
    } else {
        Err("File path must stay inside the project".to_string())
    }
}

fn untracked_file_diff(path: &Path, display_path: &str) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("Failed to read untracked file: {error}"))?;
    let max_bytes = MAX_GIT_DIFF_CHARS.saturating_add(1);
    let mut buffer = Vec::with_capacity(max_bytes.min(64 * 1024));
    Read::by_ref(&mut file)
        .take(max_bytes as u64)
        .read_to_end(&mut buffer)
        .map_err(|error| format!("Failed to read untracked file: {error}"))?;
    let truncated = buffer.len() > MAX_GIT_DIFF_CHARS;
    if truncated {
        buffer.truncate(MAX_GIT_DIFF_CHARS);
    }
    let content = String::from_utf8_lossy(&buffer);
    let diff = std::iter::once(format!("+++ b/{display_path}"))
        .chain(content.lines().map(|line| format!("+{line}")))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(bound_git_diff(&diff))
}

fn bound_git_diff(diff: &str) -> String {
    let marker = "\n\n[multAIplayer truncated this diff to fit the desktop diff viewer limit.]\n";
    bound_text_chars(diff, MAX_GIT_DIFF_CHARS, marker)
}

fn bound_command_output(output: &[u8]) -> String {
    let text = String::from_utf8_lossy(output);
    let marker = "\n\n[multAIplayer truncated command output to fit the desktop output limit.]\n";
    bound_text_chars(&text, MAX_COMMAND_OUTPUT_CHARS, marker)
}

fn bound_text_chars(text: &str, max_chars: usize, marker: &str) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let marker_chars = marker.chars().count();
    if max_chars <= marker_chars {
        return marker.chars().take(max_chars).collect();
    }
    let keep_chars = max_chars - marker_chars;
    let head_chars = keep_chars / 2;
    let tail_chars = keep_chars - head_chars;
    let head = text.chars().take(head_chars).collect::<String>();
    let tail = text
        .chars()
        .rev()
        .take(tail_chars)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("{head}{marker}{tail}")
}

fn collect_project_files(
    root: &Path,
    dir: &Path,
    query: &str,
    limit: usize,
    results: &mut Vec<ProjectFileEntry>,
) -> Result<(), String> {
    if results.len() >= limit {
        return Ok(());
    }
    let entries =
        fs::read_dir(dir).map_err(|error| format!("Failed to read project directory: {error}"))?;
    for entry in entries {
        if results.len() >= limit {
            break;
        }
        let entry = entry.map_err(|error| format!("Failed to read project entry: {error}"))?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if should_skip_project_entry(&file_name) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to read project entry type: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Failed to read project entry metadata: {error}"))?;
        if metadata.is_dir() {
            collect_project_files(root, &path, query, limit, results)?;
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("Failed to resolve relative path: {error}"))?
            .to_string_lossy()
            .replace('\\', "/");
        if query.is_empty() || relative.to_lowercase().contains(query) {
            results.push(ProjectFileEntry {
                path: relative,
                size: metadata.len(),
            });
        }
    }
    Ok(())
}

fn should_skip_project_entry(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | ".next"
            | ".turbo"
            | ".cache"
            | ".DS_Store"
            | "Cargo.lock"
            | "package-lock.json"
    )
}

fn ensure_safe_branch_name(branch: &str) -> Result<(), String> {
    let normalized = branch.trim();
    if normalized.is_empty() {
        return Err("Branch name is required".to_string());
    }
    if normalized != branch
        || normalized.chars().count() > MAX_GIT_BRANCH_CHARS
        || normalized.starts_with('-')
        || normalized == "@"
        || normalized.contains("..")
        || normalized.chars().any(char::is_whitespace)
        || normalized.contains('~')
        || normalized.contains('^')
        || normalized.contains(':')
        || normalized.contains('?')
        || normalized.contains('*')
        || normalized.contains('[')
        || normalized.contains('\\')
        || normalized.contains("//")
        || normalized.ends_with('/')
        || normalized.ends_with('.')
        || normalized.contains("@{")
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part.starts_with('.') || part.ends_with(".lock"))
    {
        return Err(format!("Unsafe branch name: {branch}"));
    }
    Ok(())
}

fn normalize_commit_message(message: &str) -> Result<String, String> {
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err("Commit message is required".to_string());
    }
    if normalized.chars().count() > MAX_COMMIT_MESSAGE_CHARS {
        return Err(format!(
            "Commit message must be {MAX_COMMIT_MESSAGE_CHARS} characters or fewer"
        ));
    }
    Ok(normalized)
}

fn ensure_terminal_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Terminal name is required".to_string());
    }
    if name.len() > 48
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(
            "Terminal name can contain letters, numbers, dash, underscore, and period".to_string(),
        );
    }
    Ok(())
}

fn ensure_terminal_command(command: &str) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("Terminal command is required".to_string());
    }
    if command.chars().count() > MAX_TERMINAL_COMMAND_CHARS {
        return Err(format!(
            "Terminal command is too long; limit is {MAX_TERMINAL_COMMAND_CHARS} characters"
        ));
    }
    Ok(())
}

fn ensure_terminal_input(input: &str) -> Result<(), String> {
    if input.trim().is_empty() {
        return Err("Terminal input is required".to_string());
    }
    if input.chars().count() > MAX_TERMINAL_INPUT_CHARS {
        return Err(format!(
            "Terminal input is too long; limit is {MAX_TERMINAL_INPUT_CHARS} characters"
        ));
    }
    Ok(())
}

fn ensure_codex_input(input: &str) -> Result<(), String> {
    if input.trim().is_empty() {
        return Err("Codex input is required".to_string());
    }
    if input.chars().count() > MAX_CODEX_INPUT_CHARS {
        return Err(format!(
            "Codex input is too long; limit is {MAX_CODEX_INPUT_CHARS} characters"
        ));
    }
    Ok(())
}

fn normalize_codex_thread_id(thread_id: Option<&str>) -> Result<Option<String>, String> {
    let Some(thread_id) = thread_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if thread_id.chars().count() > MAX_CODEX_THREAD_ID_CHARS
        || !thread_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
    {
        return Err("Codex thread id contains unsupported characters".to_string());
    }
    Ok(Some(thread_id.to_string()))
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

fn codex_timeout(timeout_seconds: Option<u64>) -> Result<Duration, String> {
    let seconds = timeout_seconds.unwrap_or(180);
    if !(MIN_CODEX_TIMEOUT_SECONDS..=MAX_CODEX_TIMEOUT_SECONDS).contains(&seconds) {
        return Err(format!(
            "Codex timeout must be between {MIN_CODEX_TIMEOUT_SECONDS} and {MAX_CODEX_TIMEOUT_SECONDS} seconds"
        ));
    }
    Ok(Duration::from_secs(seconds))
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

fn git_status_label(code: &str) -> String {
    if code.contains('?') {
        "untracked".to_string()
    } else if code.contains('A') {
        "added".to_string()
    } else if code.contains('D') {
        "deleted".to_string()
    } else if code.contains('R') {
        "renamed".to_string()
    } else {
        "modified".to_string()
    }
}

fn sanitize_window_label(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn browser_profile_dir(
    app: &AppHandle,
    room_id: &str,
    project_path: Option<&str>,
) -> Result<PathBuf, String> {
    let scope = browser_profile_scope(room_id, project_path)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    Ok(base.join("browser-profiles").join(scope))
}

fn browser_window_label(room_id: &str, project_path: Option<&str>) -> Result<String, String> {
    Ok(format!(
        "room-browser-{}",
        browser_profile_scope(room_id, project_path)?
    ))
}

fn browser_profile_scope(room_id: &str, project_path: Option<&str>) -> Result<String, String> {
    ensure_room_id(room_id)?;
    let normalized_project = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("no-project");
    let mut hasher = DefaultHasher::new();
    normalized_project.hash(&mut hasher);
    let project_hash = hasher.finish();
    Ok(format!(
        "{}--project-{project_hash:016x}",
        sanitize_window_label(room_id)
    ))
}

fn validate_browser_url(value: &str) -> Result<tauri::Url, String> {
    let url: tauri::Url = value
        .parse()
        .map_err(|error| format!("Invalid browser URL: {error}"))?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Browser URL scheme is not allowed: {scheme}")),
    }
    if url.host_str().is_none() {
        return Err("Browser URL must include a host".to_string());
    }
    Ok(url)
}

fn keychain_account(room_id: &str) -> Result<String, String> {
    ensure_room_id(room_id)?;
    Ok(format!("room:{room_id}"))
}

fn ensure_room_id(room_id: &str) -> Result<(), String> {
    if room_id.is_empty() || room_id.len() > MAX_ROOM_ID_CHARS {
        return Err("room id is invalid".to_string());
    }
    if !room_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("room id contains unsupported characters".to_string());
    }
    Ok(())
}

fn ensure_terminal_id(id: &str) -> Result<(), String> {
    let Some((room_id, terminal_name)) = id.split_once(':') else {
        return Err("terminal id is invalid".to_string());
    };
    if terminal_name.contains(':') {
        return Err("terminal id is invalid".to_string());
    }
    ensure_room_id(room_id)?;
    ensure_terminal_name(terminal_name)
}

fn ensure_device_identity_payload(identity: &str) -> Result<(), String> {
    let trimmed = identity.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_DEVICE_IDENTITY_CHARS {
        return Err("device identity is invalid".to_string());
    }
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return Err("device identity must be a JSON object".to_string());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            app_version,
            git_status,
            git_remote_origin,
            git_diff_file,
            project_files,
            project_file_read,
            run_shell_command,
            terminal_start,
            terminal_list,
            terminal_read,
            terminal_write,
            terminal_stop,
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
