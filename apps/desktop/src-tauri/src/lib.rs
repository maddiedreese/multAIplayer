use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

mod browser;
mod git;
mod keychain;
mod local_preview;
mod output;
mod project;
mod terminal;
mod validation;
use browser::*;
use git::*;
use keychain::*;
use local_preview::*;
use output::*;
use project::*;
use terminal::*;
use validation::*;

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandResult {
    pub(crate) command: String,
    pub(crate) cwd: String,
    pub(crate) status: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
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
    use std::sync::{Arc, Mutex};
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
