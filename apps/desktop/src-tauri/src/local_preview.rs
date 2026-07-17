use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

use crate::process::{terminate_child, terminate_child_confirmed, trim_command_output};
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
    generation: u64,
    tunnels: HashMap<String, LocalPreviewTunnel>,
    starting_ids: HashSet<String>,
}

impl LocalPreviewRegistry {
    fn cancel_all(&mut self) -> Result<usize, String> {
        self.generation = self.generation.wrapping_add(1);
        let mut stopped_ids = Vec::new();
        let mut failed_ids = Vec::new();
        for (id, tunnel) in &mut self.tunnels {
            match terminate_child_confirmed(&mut tunnel.child) {
                Ok(()) => stopped_ids.push(id.clone()),
                Err(_) => failed_ids.push(id.clone()),
            }
        }
        for id in &stopped_ids {
            self.tunnels.remove(id);
        }
        if failed_ids.is_empty() {
            Ok(stopped_ids.len())
        } else {
            Err(format!(
                "Could not confirm termination for {} local preview tunnel process(es).",
                failed_ids.len()
            ))
        }
    }
}

fn terminate_registered_tunnel_with<F>(
    registry: &mut LocalPreviewRegistry,
    id: &str,
    mut terminate: F,
) -> Result<bool, String>
where
    F: FnMut(&mut Child) -> std::io::Result<()>,
{
    let Some(tunnel) = registry.tunnels.get_mut(id) else {
        return Ok(false);
    };
    terminate(&mut tunnel.child).map_err(|_| {
        "Local preview tunnel process termination could not be confirmed.".to_string()
    })?;
    registry.tunnels.remove(id);
    Ok(true)
}

fn terminate_or_retain_tunnel_with<F>(
    registry: &mut LocalPreviewRegistry,
    mut tunnel: LocalPreviewTunnel,
    mut terminate: F,
) -> bool
where
    F: FnMut(&mut Child) -> std::io::Result<()>,
{
    if terminate(&mut tunnel.child).is_ok() {
        return true;
    }
    registry.tunnels.insert(tunnel.id.clone(), tunnel);
    false
}

fn release_start_reservation(state: &LocalPreviewState, id: &str) {
    let mut registry = match state.registry.lock() {
        Ok(registry) => registry,
        Err(poisoned) => poisoned.into_inner(),
    };
    registry.starting_ids.remove(id);
}

fn fail_spawned_preview_start(
    state: &LocalPreviewState,
    id: &str,
    local_url: &str,
    public_url: Option<&str>,
    child: Child,
    reason: String,
) -> crate::command_error::CommandResult<LocalPreviewStartResult> {
    let mut registry = match state.registry.lock() {
        Ok(registry) => registry,
        Err(poisoned) => poisoned.into_inner(),
    };
    registry.starting_ids.remove(id);
    let tunnel = LocalPreviewTunnel {
        id: id.to_string(),
        local_url: local_url.to_string(),
        public_url: public_url.unwrap_or_default().to_string(),
        child,
    };
    if !terminate_or_retain_tunnel_with(&mut registry, tunnel, terminate_child_confirmed) {
        return Err(format!(
            "{reason} Process termination could not be confirmed; the process was retained for another stop attempt."
        )
        .into());
    }
    Err(reason.into())
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
    public_url: String,
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
    let start_generation = {
        let mut registry = match state.registry.lock() {
            Ok(registry) => registry,
            Err(poisoned) => poisoned.into_inner(),
        };
        if registry.starting_ids.contains(&request.id) {
            return Err("A local preview tunnel with this id is already starting.".into());
        }
        terminate_registered_tunnel_with(&mut registry, &request.id, terminate_child_confirmed)?;
        registry.starting_ids.insert(request.id.clone());
        registry.generation
    };
    let local_url = match validate_local_preview_url(&request.local_url) {
        Ok(local_url) => local_url,
        Err(error) => {
            release_start_reservation(&state, &request.id);
            return Err(error.into());
        }
    };
    if let Err(error) = ensure_local_preview_reachable(&local_url) {
        release_start_reservation(&state, &request.id);
        return Err(error.into());
    }

    let mut child = match Command::new("cloudflared")
        .arg("tunnel")
        .arg("--url")
        .arg(&local_url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            release_start_reservation(&state, &request.id);
            return Err(format!("Failed to start Cloudflare Quick Tunnel: {error}").into());
        }
    };

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
            return fail_spawned_preview_start(&state, &request.id, &local_url, None, child, error);
        }
    };

    let (sender, receiver) = mpsc::channel::<String>();
    capture_preview_stream(stdout, sender.clone());
    capture_preview_stream(stderr, sender);

    let start = Instant::now();
    let mut startup_log = String::new();
    let mut public_url: Option<String> = None;
    while start.elapsed() < Duration::from_secs(20) {
        match child.try_wait() {
            Ok(Some(status)) => {
                return fail_spawned_preview_start(
                    &state,
                    &request.id,
                    &local_url,
                    None,
                    child,
                    format!(
                        "cloudflared exited before the tunnel was ready with status {status}. {}",
                        trim_command_output(&startup_log)
                    ),
                );
            }
            Ok(None) => {}
            Err(error) => {
                return fail_spawned_preview_start(
                    &state,
                    &request.id,
                    &local_url,
                    None,
                    child,
                    format!("Failed to read cloudflared status: {error}"),
                );
            }
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
        return fail_spawned_preview_start(
            &state,
            &request.id,
            &local_url,
            None,
            child,
            format!(
                "cloudflared started but did not produce a trycloudflare.com URL. {}",
                trim_command_output(&startup_log)
            ),
        );
    };

    {
        let mut registry = match state.registry.lock() {
            Ok(registry) => registry,
            Err(poisoned) => poisoned.into_inner(),
        };
        registry.starting_ids.remove(&request.id);
        let tunnel = LocalPreviewTunnel {
            id: request.id.clone(),
            local_url: local_url.clone(),
            public_url: public_url.clone(),
            child,
        };
        if registry.generation != start_generation {
            if !terminate_or_retain_tunnel_with(&mut registry, tunnel, terminate_child_confirmed) {
                return Err("Local preview startup was cancelled, but process termination could not be confirmed; the process was retained for another stop attempt.".into());
            }
            return Err("Local preview startup was cancelled during account cleanup.".into());
        }
        registry.tunnels.insert(request.id.clone(), tunnel);
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
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| "Local preview state lock is poisoned".to_string())?;
    let Some(tunnel) = registry.tunnels.get_mut(&id) else {
        return Ok(LocalPreviewStopResult {
            id,
            local_url: String::new(),
            public_url: String::new(),
            stopped: false,
        });
    };
    terminate_child_confirmed(&mut tunnel.child).map_err(|_| {
        "Local preview tunnel process termination could not be confirmed.".to_string()
    })?;
    let tunnel = registry
        .tunnels
        .remove(&id)
        .ok_or_else(|| "Local preview tunnel disappeared during termination.".to_string())?;
    Ok(LocalPreviewStopResult {
        id: tunnel.id.clone(),
        local_url: tunnel.local_url.clone(),
        public_url: tunnel.public_url.clone(),
        stopped: true,
    })
}

#[typed_tauri_command::command]
pub(crate) fn local_preview_stop_all(
    state: State<'_, LocalPreviewState>,
) -> crate::command_error::CommandResult<usize> {
    let mut registry = match state.registry.lock() {
        Ok(registry) => registry,
        Err(poisoned) => poisoned.into_inner(),
    };
    registry.cancel_all().map_err(Into::into)
}

#[typed_tauri_command::command]
pub(crate) fn local_preview_status(
    state: State<'_, LocalPreviewState>,
    id: String,
) -> crate::command_error::CommandResult<LocalPreviewStatusResult> {
    ensure_preview_id(&id)?;
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| "Local preview state lock is poisoned".to_string())?;
    let Some(tunnel) = registry.tunnels.get_mut(&id) else {
        return Err("Local preview tunnel is not running on this device.".into());
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
    if output.len() > max_chars {
        let excess = output.len() - max_chars;
        output.drain(..excess);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        terminate_or_retain_tunnel_with, terminate_registered_tunnel_with, LocalPreviewRegistry,
        LocalPreviewTunnel,
    };
    use std::fs;
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn stop_all_invalidates_every_in_flight_start_generation() {
        let mut registry = LocalPreviewRegistry::default();
        let start_generation = registry.generation;

        assert_eq!(registry.cancel_all().expect("cancel empty registry"), 0);

        assert_ne!(registry.generation, start_generation);
    }

    #[test]
    fn stop_all_terminates_every_registered_tunnel_process() {
        let marker = std::env::temp_dir().join(format!(
            "multaiplayer-preview-stop-all-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let child = Command::new("sh")
            .arg("-c")
            .arg("sleep 0.4; touch \"$1\"")
            .arg("preview-stop-test")
            .arg(&marker)
            .spawn()
            .expect("spawn preview test child");
        let mut registry = LocalPreviewRegistry::default();
        registry.tunnels.insert(
            "preview-test".to_string(),
            LocalPreviewTunnel {
                id: "preview-test".to_string(),
                local_url: "http://localhost:5173/".to_string(),
                public_url: "https://example.trycloudflare.com".to_string(),
                child,
            },
        );

        assert_eq!(registry.cancel_all().expect("cancel registered tunnel"), 1);
        thread::sleep(Duration::from_millis(650));

        assert!(
            !marker.exists(),
            "terminated preview child must not reach its delayed side effect"
        );
        let _ = fs::remove_file(marker);
    }

    #[test]
    fn same_id_tunnel_is_not_removed_when_termination_is_unconfirmed() {
        let child = Command::new("sh")
            .arg("-c")
            .arg("sleep 5")
            .spawn()
            .expect("spawn retained preview test child");
        let mut registry = LocalPreviewRegistry::default();
        registry.tunnels.insert(
            "preview-same-id".to_string(),
            LocalPreviewTunnel {
                id: "preview-same-id".to_string(),
                local_url: "http://localhost:5173/".to_string(),
                public_url: "https://example.trycloudflare.com".to_string(),
                child,
            },
        );

        let result = terminate_registered_tunnel_with(&mut registry, "preview-same-id", |_| {
            Err(std::io::Error::other("simulated termination failure"))
        });

        assert!(result.is_err());
        assert!(registry.tunnels.contains_key("preview-same-id"));
        assert_eq!(registry.cancel_all().expect("cleanup retained child"), 1);
    }

    #[test]
    fn failed_start_child_is_retained_when_termination_is_unconfirmed() {
        let child = Command::new("sh")
            .arg("-c")
            .arg("sleep 5")
            .spawn()
            .expect("spawn failed-start preview test child");
        let mut registry = LocalPreviewRegistry::default();
        let tunnel = LocalPreviewTunnel {
            id: "preview-failed-start".to_string(),
            local_url: "http://localhost:5173/".to_string(),
            public_url: String::new(),
            child,
        };

        let terminated = terminate_or_retain_tunnel_with(&mut registry, tunnel, |_| {
            Err(std::io::Error::other("simulated termination failure"))
        });

        assert!(!terminated);
        assert!(registry.tunnels.contains_key("preview-failed-start"));
        assert_eq!(registry.cancel_all().expect("cleanup retained child"), 1);
    }
}
