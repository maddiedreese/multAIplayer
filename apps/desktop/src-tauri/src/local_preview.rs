use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

use crate::output::bound_text_chars;
use crate::process::{terminate_child_confirmed, trim_command_output};
use crate::validation::{
    ensure_local_preview_reachable, ensure_preview_id, local_port_reachable,
    local_preview_reachable, validate_local_preview_url, MAX_COMMAND_OUTPUT_CHARS,
};

const LOCAL_PREVIEW_PORTS: [u16; 9] = [3000, 3001, 5173, 5174, 8000, 8080, 4200, 5000, 8888];
const TRYCLOUDFLARE_MARKER: &str = ".trycloudflare.com";

#[derive(Default)]
pub(crate) struct LocalPreviewState {
    registry: Mutex<LocalPreviewRegistry>,
}

#[derive(Default)]
struct LocalPreviewRegistry {
    next_generation: u64,
    tunnels: HashMap<String, LocalPreviewTunnel>,
}

struct LocalPreviewTunnel {
    id: String,
    local_url: String,
    public_url: Option<String>,
    generation: u64,
    child: Arc<Mutex<Child>>,
}

impl Drop for LocalPreviewState {
    fn drop(&mut self) {
        let Ok(registry) = self.registry.get_mut() else {
            eprintln!("Local preview state lock was poisoned during shutdown");
            return;
        };
        for tunnel in registry.tunnels.values_mut() {
            match tunnel.child.lock() {
                Ok(mut child) => {
                    if let Err(error) = terminate_child_confirmed(&mut child) {
                        eprintln!(
                            "Failed to stop local preview {} during shutdown: {error}",
                            tunnel.id
                        );
                    }
                }
                Err(_) => eprintln!("Local preview process lock was poisoned during shutdown"),
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalPreviewDetectedServer {
    url: String,
    host: String,
    port: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudflaredProbe {
    available: bool,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalPreviewStartRequest {
    id: String,
    local_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalPreviewStartResult {
    id: String,
    local_url: String,
    public_url: String,
    startup_log: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalPreviewStopResult {
    id: String,
    local_url: String,
    public_url: Option<String>,
    stopped: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalPreviewStatusResult {
    id: String,
    local_url: String,
    public_url: String,
    running: bool,
    local_reachable: bool,
    exit_status: Option<i32>,
}

#[typed_tauri_command::command]
pub(crate) fn detect_local_preview_servers(
) -> crate::command_error::CommandResult<Vec<LocalPreviewDetectedServer>> {
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
pub(crate) fn probe_cloudflared() -> CloudflaredProbe {
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

#[typed_tauri_command::command]
pub(crate) fn local_preview_start(
    state: State<'_, LocalPreviewState>,
    request: LocalPreviewStartRequest,
) -> crate::command_error::CommandResult<LocalPreviewStartResult> {
    ensure_preview_id(&request.id)?;
    let local_url = validate_local_preview_url(&request.local_url)?;
    ensure_local_preview_reachable(&local_url)?;

    let (child, stdout, stderr, generation) = {
        let mut registry = lock_registry(&state)?;
        if let Some(existing) = registry.tunnels.get_mut(&request.id) {
            let mut child = existing
                .child
                .lock()
                .map_err(|_| "Local preview process lock is poisoned".to_string())?;
            terminate_child_confirmed(&mut child).map_err(|error| {
                format!(
                    "Could not replace local preview {} because its existing process did not stop: {error}",
                    request.id
                )
            })?;
        }
        registry.tunnels.remove(&request.id);

        let mut spawned = Command::new("cloudflared")
            .arg("tunnel")
            .arg("--url")
            .arg(&local_url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start Cloudflare Quick Tunnel: {error}"))?;
        let stdout = spawned.stdout.take();
        let stderr = spawned.stderr.take();
        let (Some(stdout), Some(stderr)) = (stdout, stderr) else {
            let capture_error = "Failed to capture cloudflared output";
            return match terminate_child_confirmed(&mut spawned) {
                Ok(()) => Err(capture_error.into()),
                Err(error) => Err(format!(
                    "{capture_error}; the process also could not be stopped: {error}"
                )
                .into()),
            };
        };
        registry.next_generation = registry.next_generation.wrapping_add(1);
        let generation = registry.next_generation;
        let child = Arc::new(Mutex::new(spawned));
        registry.tunnels.insert(
            request.id.clone(),
            LocalPreviewTunnel {
                id: request.id.clone(),
                local_url: local_url.clone(),
                public_url: None,
                generation,
                child: Arc::clone(&child),
            },
        );
        (child, stdout, stderr, generation)
    };

    let (sender, receiver) = mpsc::channel::<String>();
    capture_preview_stream(stdout, sender.clone());
    capture_preview_stream(stderr, sender);

    let start = Instant::now();
    let mut startup_log = String::new();
    let mut public_url: Option<String> = None;
    while start.elapsed() < Duration::from_secs(20) {
        if !is_current_generation(&state, &request.id, generation)? {
            return Err("Local preview start was cancelled.".into());
        }
        let status = child
            .lock()
            .map_err(|_| "Local preview process lock is poisoned".to_string())?
            .try_wait()
            .map_err(|error| format!("Failed to read cloudflared status: {error}"));
        let status = match status {
            Ok(status) => status,
            Err(error) => return fail_start(&state, &request.id, generation, error),
        };
        if let Some(status) = status {
            remove_generation(&state, &request.id, generation)?;
            return Err(format!(
                "cloudflared exited before the tunnel was ready with status {status}. {}",
                trim_command_output(&startup_log)
            )
            .into());
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
        return fail_start(
            &state,
            &request.id,
            generation,
            format!(
                "cloudflared started but did not produce a trycloudflare.com URL. {}",
                trim_command_output(&startup_log)
            ),
        );
    };

    {
        let mut registry = lock_registry(&state)?;
        let Some(tunnel) = registry
            .tunnels
            .get_mut(&request.id)
            .filter(|tunnel| tunnel.generation == generation)
        else {
            return Err("Local preview start was cancelled.".into());
        };
        tunnel.public_url = Some(public_url.clone());
    }

    Ok(LocalPreviewStartResult {
        id: request.id,
        local_url,
        public_url,
        startup_log: trim_command_output(&startup_log),
    })
}

#[typed_tauri_command::command]
pub(crate) fn local_preview_stop(
    state: State<'_, LocalPreviewState>,
    id: String,
) -> crate::command_error::CommandResult<LocalPreviewStopResult> {
    ensure_preview_id(&id)?;
    let mut registry = lock_registry(&state)?;
    let Some(tunnel) = registry.tunnels.get_mut(&id) else {
        return Err("Local preview tunnel is not running on this device.".into());
    };
    let result = LocalPreviewStopResult {
        id: tunnel.id.clone(),
        local_url: tunnel.local_url.clone(),
        public_url: tunnel.public_url.clone(),
        stopped: true,
    };
    let mut child = tunnel
        .child
        .lock()
        .map_err(|_| "Local preview process lock is poisoned".to_string())?;
    terminate_child_confirmed(&mut child).map_err(|error| {
        format!("Local preview process could not be confirmed stopped: {error}")
    })?;
    drop(child);
    registry.tunnels.remove(&id);
    Ok(result)
}

#[typed_tauri_command::command]
pub(crate) fn local_preview_stop_all(
    state: State<'_, LocalPreviewState>,
) -> crate::command_error::CommandResult<usize> {
    stop_all_local_previews(&state).map_err(Into::into)
}

pub(crate) fn stop_all_local_previews(state: &LocalPreviewState) -> Result<usize, String> {
    let mut registry = lock_registry(state)?;
    let ids = registry.tunnels.keys().cloned().collect::<Vec<_>>();
    let mut stopped = 0;
    let mut failures = Vec::new();
    for id in ids {
        let Some(tunnel) = registry.tunnels.get_mut(&id) else {
            continue;
        };
        let termination = {
            let mut child = tunnel
                .child
                .lock()
                .map_err(|_| "Local preview process lock is poisoned".to_string())?;
            terminate_child_confirmed(&mut child)
        };
        match termination {
            Ok(()) => {
                registry.tunnels.remove(&id);
                stopped += 1;
            }
            Err(error) => failures.push(format!("{id}: {error}")),
        }
    }
    if failures.is_empty() {
        Ok(stopped)
    } else {
        Err(format!(
            "Some local preview processes could not be confirmed stopped: {}",
            failures.join("; ")
        ))
    }
}

pub(crate) fn stop_all_local_previews_with_retry(
    state: &LocalPreviewState,
    attempts: usize,
    retry_delay: Duration,
) -> Result<usize, String> {
    let initial_count = count_running_previews(state)?;
    let mut last_error = None;
    for attempt in 0..attempts.max(1) {
        match stop_all_local_previews(state) {
            Ok(_) => return Ok(initial_count.saturating_sub(count_running_previews(state)?)),
            Err(error) => last_error = Some(error),
        }
        if attempt + 1 < attempts.max(1) {
            thread::sleep(retry_delay);
        }
    }
    Err(last_error.unwrap_or_else(|| "Local preview shutdown failed".to_string()))
}

fn count_running_previews(state: &LocalPreviewState) -> Result<usize, String> {
    Ok(lock_registry(state)?.tunnels.len())
}

#[typed_tauri_command::command]
pub(crate) fn local_preview_status(
    state: State<'_, LocalPreviewState>,
    id: String,
) -> crate::command_error::CommandResult<LocalPreviewStatusResult> {
    ensure_preview_id(&id)?;
    let mut registry = lock_registry(&state)?;
    let Some(tunnel) = registry.tunnels.get_mut(&id) else {
        return Err("Local preview tunnel is not running on this device.".into());
    };
    let status = tunnel
        .child
        .lock()
        .map_err(|_| "Local preview process lock is poisoned".to_string())?
        .try_wait()
        .map_err(|error| format!("Failed to read cloudflared status: {error}"))?;
    Ok(LocalPreviewStatusResult {
        id: tunnel.id.clone(),
        local_url: tunnel.local_url.clone(),
        public_url: tunnel
            .public_url
            .clone()
            .ok_or_else(|| "Local preview tunnel is still starting".to_string())?,
        running: status.is_none(),
        local_reachable: local_preview_reachable(&tunnel.local_url),
        exit_status: status.and_then(|status| status.code()),
    })
}

fn lock_registry(
    state: &LocalPreviewState,
) -> Result<MutexGuard<'_, LocalPreviewRegistry>, String> {
    state
        .registry
        .lock()
        .map_err(|_| "Local preview state lock is poisoned".to_string())
}

fn is_current_generation(
    state: &LocalPreviewState,
    id: &str,
    generation: u64,
) -> Result<bool, String> {
    let registry = lock_registry(state)?;
    Ok(registry
        .tunnels
        .get(id)
        .is_some_and(|tunnel| tunnel.generation == generation))
}

fn remove_generation(state: &LocalPreviewState, id: &str, generation: u64) -> Result<(), String> {
    let mut registry = lock_registry(state)?;
    if registry
        .tunnels
        .get(id)
        .is_some_and(|tunnel| tunnel.generation == generation)
    {
        registry.tunnels.remove(id);
    }
    Ok(())
}

fn fail_start(
    state: &LocalPreviewState,
    id: &str,
    generation: u64,
    error: String,
) -> crate::command_error::CommandResult<LocalPreviewStartResult> {
    let mut registry = lock_registry(state)?;
    let Some(tunnel) = registry
        .tunnels
        .get_mut(id)
        .filter(|tunnel| tunnel.generation == generation)
    else {
        return Err("Local preview start was cancelled.".into());
    };
    let termination = {
        let mut child = tunnel
            .child
            .lock()
            .map_err(|_| "Local preview process lock is poisoned".to_string())?;
        terminate_child_confirmed(&mut child)
    };
    match termination {
        Ok(()) => {
            registry.tunnels.remove(id);
            Err(error.into())
        }
        Err(termination_error) => Err(format!(
            "{error} The cloudflared process also could not be confirmed stopped: {termination_error}"
        )
        .into()),
    }
}

fn capture_preview_stream<T>(stream: T, sender: mpsc::Sender<String>)
where
    T: Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
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
    *output = bound_text_chars(
        output,
        max_chars,
        "\n[earlier cloudflared output truncated]\n",
    );
}

#[cfg(test)]
mod tests {
    use super::append_bounded;

    #[test]
    fn append_bounded_handles_multibyte_cloudflared_output() {
        let mut output = "🌐".repeat(100);

        append_bounded(&mut output, &"🚀".repeat(100), 80);

        assert!(output.chars().count() <= 80);
        assert!(output.contains('🚀'));
    }
}
