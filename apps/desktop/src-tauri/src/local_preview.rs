use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

use crate::process::{terminate_child, trim_command_output};
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
}

impl LocalPreviewRegistry {
    fn cancel_all(&mut self) -> usize {
        self.generation = self.generation.wrapping_add(1);
        let stopped = self.tunnels.len();
        self.tunnels.clear();
        stopped
    }
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
        let mut registry = state
            .registry
            .lock()
            .map_err(|_| "Local preview state lock is poisoned".to_string())?;
        if let Some(mut existing) = registry.tunnels.remove(&request.id) {
            terminate_child(&mut existing.child);
        }
        registry.generation
    };
    let local_url = validate_local_preview_url(&request.local_url)?;
    ensure_local_preview_reachable(&local_url)?;

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
            return Err(error.into());
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
        terminate_child(&mut child);
        return Err(format!(
            "cloudflared started but did not produce a trycloudflare.com URL. {}",
            trim_command_output(&startup_log)
        )
        .into());
    };

    {
        let mut registry = state
            .registry
            .lock()
            .map_err(|_| "Local preview state lock is poisoned".to_string())?;
        if registry.generation != start_generation {
            terminate_child(&mut child);
            return Err("Local preview startup was cancelled during account cleanup.".into());
        }
        registry.tunnels.insert(
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
    let Some(mut tunnel) = registry.tunnels.remove(&id) else {
        return Err("Local preview tunnel is not running on this device.".into());
    };
    terminate_child(&mut tunnel.child);
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
    Ok(registry.cancel_all())
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
    use super::{LocalPreviewRegistry, LocalPreviewTunnel};
    use std::fs;
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn stop_all_invalidates_every_in_flight_start_generation() {
        let mut registry = LocalPreviewRegistry::default();
        let start_generation = registry.generation;

        assert_eq!(registry.cancel_all(), 0);

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

        assert_eq!(registry.cancel_all(), 1);
        thread::sleep(Duration::from_millis(650));

        assert!(
            !marker.exists(),
            "terminated preview child must not reach its delayed side effect"
        );
        let _ = fs::remove_file(marker);
    }
}
