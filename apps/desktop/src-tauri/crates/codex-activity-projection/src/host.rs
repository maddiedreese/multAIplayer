//! UI-independent Codex app-server hosting primitives.
//!
//! It deliberately owns no UI-framework or rendering behavior. Applications
//! provide their own event sinks and approval prompts.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const MANIFEST_0133: &str =
    include_str!("../../../../../../contracts/codex-app-server/0.133.0.json");
const MANIFEST_0143: &str =
    include_str!("../../../../../../contracts/codex-app-server/0.143.0.json");
const MANIFEST_0144: &str =
    include_str!("../../../../../../contracts/codex-app-server/0.144.0.json");
const MAX_SAFE_TEXT: usize = 2_000;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityManifest {
    pub codex_version: String,
    pub client_request_methods: Vec<String>,
    pub server_request_methods: Vec<String>,
    pub server_notification_methods: Vec<String>,
    pub app_tool_approval_modes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexHostCapabilities {
    pub codex_version: String,
    pub manifest_version: String,
    pub supports_account: bool,
    pub supports_browser_login: bool,
    pub supports_device_login: bool,
    pub supports_hosted_login_success: bool,
    pub supports_apps: bool,
    pub supports_mcp: bool,
    pub supports_writes_approval: bool,
    pub compatibility_warning: Option<String>,
    pub supports_last_turn_fork: bool,
}

impl CodexHostCapabilities {
    pub fn supports_method(&self, method: &str) -> bool {
        let Ok(manifest) = selected_manifest(&self.codex_version) else {
            return false;
        };
        method == "initialize"
            || manifest
                .client_request_methods
                .iter()
                .any(|entry| entry == method)
    }

    pub fn supports_server_request(&self, method: &str) -> bool {
        selected_manifest(&self.codex_version).is_ok_and(|manifest| {
            manifest
                .server_request_methods
                .iter()
                .any(|entry| entry == method)
        })
    }
}

pub fn selected_manifest(version: &str) -> Result<CompatibilityManifest, String> {
    let current = parse_semver(version).ok_or_else(|| "Codex version is invalid".to_string())?;
    let source = if current >= (0, 144, 0) {
        MANIFEST_0144
    } else if current >= (0, 143, 0) {
        MANIFEST_0143
    } else if current >= (0, 133, 0) {
        MANIFEST_0133
    } else {
        return Err(
            "Codex is older than the minimum supported app-server version (0.133.0)".to_string(),
        );
    };
    serde_json::from_str(source)
        .map_err(|error| format!("Bundled Codex manifest is invalid: {error}"))
}

pub fn capabilities_for_version(version: &str) -> Result<CodexHostCapabilities, String> {
    let manifest = selected_manifest(version)?;
    let has = |method: &str| {
        manifest
            .client_request_methods
            .iter()
            .any(|entry| entry == method)
    };
    let notification = |method: &str| {
        manifest
            .server_notification_methods
            .iter()
            .any(|entry| entry == method)
    };
    let current = parse_semver(version).ok_or_else(|| "Codex version is invalid".to_string())?;
    let security_features_contract_tested = current <= (0, 144, 0);
    Ok(CodexHostCapabilities {
        codex_version: version.to_string(),
        manifest_version: manifest.codex_version,
        supports_account: has("account/read"),
        supports_browser_login: has("account/login/start")
            && notification("account/login/completed"),
        supports_device_login: has("account/login/start")
            && notification("account/login/completed"),
        supports_hosted_login_success: current == (0, 144, 0),
        supports_apps: has("app/list"),
        supports_mcp: has("mcpServerStatus/list") && has("mcpServer/oauth/login"),
        supports_writes_approval: security_features_contract_tested
            && manifest
                .app_tool_approval_modes
                .iter()
                .any(|mode| mode == "writes"),
        compatibility_warning: (!security_features_contract_tested).then(|| {
            "This Codex version is newer than the latest contract-tested version (0.144.0); security-affecting login and app approval additions are disabled.".to_string()
        }),
        supports_last_turn_fork: current >= (0, 143, 0),
    })
}

pub fn parse_codex_version(value: &str) -> Option<String> {
    value
        .split_whitespace()
        .find_map(|part| parse_semver(part).map(|_| part.to_string()))
}

pub fn parse_semver(value: &str) -> Option<(u64, u64, u64)> {
    let clean = value.split(['-', '+']).next()?;
    let mut parts = clean.split('.');
    let parsed = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    if parts.next().is_some() {
        None
    } else {
        Some(parsed)
    }
}

pub fn bounded_string(value: Option<&Value>, field: &str, max: usize) -> Result<String, String> {
    let value = value
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Codex response is missing {field}"))?;
    if value.is_empty() || value.chars().count() > max {
        Err(format!("Codex response {field} is invalid"))
    } else {
        Ok(value.to_string())
    }
}

pub fn safe_url(value: Option<&Value>, field: &str) -> Result<String, String> {
    let value = bounded_string(value, field, 8_192)?;
    let has_controls = value
        .chars()
        .any(|character| character.is_control() || character.is_whitespace());
    let allowed_scheme = value
        .strip_prefix("https://")
        .is_some_and(|rest| !rest.is_empty())
        || value
            .strip_prefix("http://127.0.0.1:")
            .is_some_and(|rest| !rest.is_empty())
        || value
            .strip_prefix("http://localhost:")
            .is_some_and(|rest| !rest.is_empty());
    if allowed_scheme && !has_controls {
        Ok(value)
    } else {
        Err(format!(
            "Codex response {field} did not use an allowed URL scheme"
        ))
    }
}

pub fn safe_error_text(value: &str) -> String {
    let bounded = value.chars().take(MAX_SAFE_TEXT).collect::<String>();
    bounded
        .split_whitespace()
        .map(|part| {
            let lower = part.to_ascii_lowercase();
            if lower.contains("token")
                || lower.contains("secret")
                || lower.contains("authorization")
                || lower.contains("password")
                || lower.contains("api_key")
                || lower.contains("cookie")
                || lower.starts_with("http://")
                || lower.starts_with("https://")
                || part.starts_with("eyJ")
            {
                "[redacted]"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexHostNotification {
    pub method: String,
    pub params: Value,
}

pub fn sanitize_host_notification(
    method: &str,
    params: Option<&Value>,
) -> Option<CodexHostNotification> {
    let input = params.and_then(Value::as_object)?;
    let mut output = Map::new();
    match method {
        "account/login/completed" => {
            copy_safe_string(input, &mut output, "loginId", 256);
            copy_bool(input, &mut output, "success");
            copy_safe_error(input, &mut output);
        }
        "account/updated" => {
            copy_safe_string(input, &mut output, "authMode", 64);
            copy_safe_string(input, &mut output, "planType", 64);
        }
        "mcpServer/oauthLogin/completed" => {
            copy_safe_string(input, &mut output, "name", 256);
            copy_bool(input, &mut output, "success");
            copy_safe_error(input, &mut output);
        }
        "mcpServer/startupStatus/updated" => {
            copy_safe_string(input, &mut output, "name", 256);
            copy_safe_string(input, &mut output, "status", 64);
            copy_safe_error(input, &mut output);
        }
        "app/list/updated" => {}
        _ => return None,
    }
    Some(CodexHostNotification {
        method: method.to_string(),
        params: Value::Object(output),
    })
}

fn copy_safe_string(
    input: &Map<String, Value>,
    output: &mut Map<String, Value>,
    key: &str,
    max: usize,
) {
    if let Some(value) = input
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| value.chars().count() <= max)
    {
        output.insert(key.to_string(), Value::String(value.to_string()));
    }
}

fn copy_bool(input: &Map<String, Value>, output: &mut Map<String, Value>, key: &str) {
    if let Some(value) = input.get(key).and_then(Value::as_bool) {
        output.insert(key.to_string(), Value::Bool(value));
    }
}

fn copy_safe_error(input: &Map<String, Value>, output: &mut Map<String, Value>) {
    if let Some(value) = input.get("error").and_then(Value::as_str) {
        output.insert("error".to_string(), Value::String(safe_error_text(value)));
    }
}

pub type SharedStdin = Arc<Mutex<ChildStdin>>;
static NEXT_RPC_SESSION_ID: AtomicU64 = AtomicU64::new(1);

pub fn allocate_rpc_session_id() -> u64 {
    NEXT_RPC_SESSION_ID.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, Clone, PartialEq)]
pub enum RpcId {
    Number(serde_json::Number),
    String(String),
}

impl RpcId {
    pub fn from_value(value: &Value) -> Option<Self> {
        match value {
            Value::Number(value) if value.as_i64().is_some() => Some(Self::Number(value.clone())),
            Value::String(value) => Some(Self::String(value.clone())),
            _ => None,
        }
    }

    pub fn to_value(&self) -> Value {
        match self {
            Self::Number(value) => Value::Number(value.clone()),
            Self::String(value) => Value::String(value.clone()),
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum RpcMessage {
    Response {
        id: RpcId,
        value: Value,
    },
    Notification {
        method: String,
        value: Value,
    },
    ServerRequest {
        id: RpcId,
        method: String,
        params: Value,
    },
}

#[derive(Debug)]
pub struct RpcInbox {
    line_rx: mpsc::Receiver<String>,
    pub deferred: VecDeque<RpcMessage>,
}

impl RpcInbox {
    pub fn new(line_rx: mpsc::Receiver<String>) -> Self {
        Self {
            line_rx,
            deferred: VecDeque::new(),
        }
    }

    pub fn receive(&self, wait: Duration) -> Result<RpcMessage, String> {
        let line = self
            .line_rx
            .recv_timeout(wait)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => "timeout".to_string(),
                mpsc::RecvTimeoutError::Disconnected => {
                    "App-server response channel disconnected".to_string()
                }
            })?;
        classify_rpc_line(&line)
    }
}

pub fn classify_rpc_line(line: &str) -> Result<RpcMessage, String> {
    let value: Value = serde_json::from_str(line)
        .map_err(|error| format!("Invalid app-server JSON line: {error}"))?;
    let method = value.get("method").and_then(Value::as_str);
    let id = value.get("id").and_then(RpcId::from_value);
    let has_result = value.get("result").is_some();
    let has_error = value.get("error").is_some();
    match (method, id) {
        (Some(method), Some(id)) => Ok(RpcMessage::ServerRequest {
            id,
            method: method.to_string(),
            params: value.get("params").cloned().unwrap_or(Value::Null),
        }),
        (Some(method), None) => Ok(RpcMessage::Notification {
            method: method.to_string(),
            value,
        }),
        (None, Some(id)) if has_result != has_error => Ok(RpcMessage::Response { id, value }),
        (None, Some(_)) => Err("Invalid app-server response envelope".to_string()),
        (None, None) => Err("Invalid app-server message: expected method or id".to_string()),
    }
}

pub fn send_json_shared(stdin: &SharedStdin, value: Value) -> Result<(), String> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| "Codex app-server stdin is unavailable".to_string())?;
    writeln!(stdin, "{value}")
        .map_err(|error| format!("Failed to write app-server JSON: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("Failed to flush app-server stdin: {error}"))
}

pub struct ActiveTimeout {
    limit: Duration,
    consumed: Duration,
    last_checked: Instant,
    was_waiting_for_human: bool,
}

impl ActiveTimeout {
    pub fn new(limit: Duration) -> Self {
        Self {
            limit,
            consumed: Duration::ZERO,
            last_checked: Instant::now(),
            was_waiting_for_human: false,
        }
    }

    pub fn expired(&mut self, waiting_for_human: bool) -> bool {
        self.observe(Instant::now(), waiting_for_human)
    }

    fn observe(&mut self, now: Instant, waiting_for_human: bool) -> bool {
        if !self.was_waiting_for_human && !waiting_for_human {
            self.consumed = self
                .consumed
                .saturating_add(now.saturating_duration_since(self.last_checked));
        }
        self.last_checked = now;
        self.was_waiting_for_human = waiting_for_human;
        self.consumed > self.limit
    }
}

pub fn wait_for_response(
    inbox: &mut RpcInbox,
    id: RpcId,
    budget: &mut ActiveTimeout,
    mut handle_request: impl FnMut(RpcId, String, Value) -> Result<(), String>,
    mut is_waiting_for_human: impl FnMut() -> bool,
    mut is_cancelled: impl FnMut() -> bool,
) -> Result<Value, String> {
    let parsed = wait_for_response_message(
        inbox,
        id.clone(),
        budget,
        &mut handle_request,
        &mut is_waiting_for_human,
        &mut is_cancelled,
    )?;
    if parsed.get("error").is_some() {
        return Err(format!("App-server request {:?} failed", id));
    }
    Ok(parsed)
}

pub fn wait_for_response_message(
    inbox: &mut RpcInbox,
    id: RpcId,
    budget: &mut ActiveTimeout,
    handle_request: &mut impl FnMut(RpcId, String, Value) -> Result<(), String>,
    is_waiting_for_human: &mut impl FnMut() -> bool,
    is_cancelled: &mut impl FnMut() -> bool,
) -> Result<Value, String> {
    loop {
        if is_cancelled() {
            return Err(
                "Codex turn was cancelled because the room host context changed".to_string(),
            );
        }
        if let Some(index) = inbox.deferred.iter().position(
            |message| matches!(message, RpcMessage::Response { id: response_id, .. } if response_id == &id),
        ) {
            if let Some(RpcMessage::Response { value, .. }) = inbox.deferred.remove(index) {
                return Ok(value);
            }
        }
        if budget.expired(is_waiting_for_human()) {
            return Err(format!(
                "Timed out waiting for app-server response id {:?}",
                id
            ));
        }
        match inbox.receive(Duration::from_millis(500)) {
            Ok(RpcMessage::Response {
                id: response_id,
                value,
            }) if response_id == id => return Ok(value),
            Ok(RpcMessage::ServerRequest { id, method, params }) => {
                handle_request(id, method, params)?;
            }
            Ok(message) => inbox.deferred.push_back(message),
            Err(error) if error == "timeout" => {}
            Err(error) => return Err(error),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppServerProcessConfig {
    pub executable: String,
    pub cwd: Option<PathBuf>,
    pub arguments: Vec<String>,
    pub capture_stderr: bool,
}

impl AppServerProcessConfig {
    pub fn codex(arguments: Vec<String>, cwd: Option<&Path>, capture_stderr: bool) -> Self {
        Self {
            executable: "codex".to_string(),
            cwd: cwd.map(Path::to_path_buf),
            arguments,
            capture_stderr,
        }
    }
}

pub struct AppServerProcess {
    child: Child,
    stdin: SharedStdin,
    stdout_rx: Option<mpsc::Receiver<String>>,
    stderr_rx: mpsc::Receiver<String>,
}

impl AppServerProcess {
    pub fn spawn(config: &AppServerProcessConfig) -> Result<Self, String> {
        let mut command = Command::new(&config.executable);
        command
            .args(&config.arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(if config.capture_stderr {
                Stdio::piped()
            } else {
                Stdio::null()
            });
        if let Some(cwd) = &config.cwd {
            command.current_dir(cwd);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start codex app-server: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .map(|stdin| Arc::new(Mutex::new(stdin)))
            .ok_or_else(|| "Could not open codex app-server stdin".to_string())
            .inspect_err(|_| terminate_child(&mut child))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Could not open codex app-server stdout".to_string())
            .inspect_err(|_| terminate_child(&mut child))?;
        let (line_tx, line_rx) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line_tx.send(line).is_err() {
                    break;
                }
            }
        });
        let (stderr_tx, stderr_rx) = mpsc::channel();
        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if stderr_tx.send(line).is_err() {
                        break;
                    }
                }
            });
        }
        Ok(Self {
            child,
            stdin,
            stdout_rx: Some(line_rx),
            stderr_rx,
        })
    }

    pub fn stdin(&self) -> SharedStdin {
        self.stdin.clone()
    }

    pub fn take_stdout_lines(&mut self) -> Result<mpsc::Receiver<String>, String> {
        self.stdout_rx
            .take()
            .ok_or_else(|| "Codex app-server stdout is already attached".to_string())
    }

    pub fn drain_stderr(&self) -> Vec<String> {
        self.stderr_rx.try_iter().collect()
    }

    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub fn terminate(&mut self) {
        terminate_child(&mut self.child);
    }
}

impl Drop for AppServerProcess {
    fn drop(&mut self) {
        terminate_child(&mut self.child);
    }
}

fn terminate_child(child: &mut Child) {
    if let Err(error) = terminate_child_confirmed(child) {
        eprintln!("Failed to terminate Codex app-server process: {error}");
    }
}

fn terminate_child_confirmed(child: &mut Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| format!("Failed to read child process status: {error}"))?
        .is_some()
    {
        return Ok(());
    }
    if let Err(kill_error) = child.kill() {
        if child
            .try_wait()
            .map_err(|error| {
                format!("Failed to read child process status after kill failed: {error}")
            })?
            .is_some()
        {
            return Ok(());
        }
        return Err(format!("Failed to terminate child process: {kill_error}"));
    }
    child
        .wait()
        .map_err(|error| format!("Failed to confirm child process termination: {error}"))?;
    Ok(())
}

pub fn thread_request(id: i64, previous_thread_id: Option<&str>, cwd: &str, model: &str) -> Value {
    match previous_thread_id {
        Some(thread_id) => thread_resume_request(id, thread_id, cwd, model),
        None => thread_start_request(id, cwd, model),
    }
}

pub fn thread_start_request(id: i64, cwd: &str, model: &str) -> Value {
    json!({
        "method": "thread/start",
        "id": id,
        "params": { "model": model, "cwd": cwd }
    })
}

pub fn thread_resume_request(id: i64, thread_id: &str, cwd: &str, model: &str) -> Value {
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

pub fn thread_id_from_response(response: &Value, operation: &str) -> Result<String, String> {
    response
        .get("result")
        .and_then(|result| result.get("thread"))
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.chars().count() <= 512)
        .map(str::to_string)
        .ok_or_else(|| format!("{operation} did not return a valid thread id"))
}

pub fn extract_text_delta(value: &Value) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn compatibility_is_fail_closed_above_the_tested_security_range() {
        let current = capabilities_for_version("0.144.0").unwrap();
        let future = capabilities_for_version("0.145.0").unwrap();
        assert!(current.supports_writes_approval);
        assert!(current.supports_server_request("item/commandExecution/requestApproval"));
        assert!(!current.supports_server_request("unknown/privileged"));
        assert!(!future.supports_writes_approval);
        assert!(future.compatibility_warning.is_some());
        assert!(selected_manifest("0.132.9").is_err());
    }

    #[test]
    fn unknown_notifications_and_sensitive_fields_are_discarded() {
        assert!(sanitize_host_notification(
            "account/chatgptAuthTokens/refresh",
            Some(&json!({"accessToken": "secret"}))
        )
        .is_none());
        let safe = sanitize_host_notification(
            "account/login/completed",
            Some(&json!({"loginId":"id", "success":false, "error":"token=secret", "accessToken":"never"})),
        )
        .unwrap();
        assert!(safe.params.get("accessToken").is_none());
        assert_eq!(safe.params.get("error"), Some(&json!("[redacted]")));
    }

    #[test]
    fn rpc_classification_fails_closed_without_reflecting_payloads() {
        let error = classify_rpc_line(r#"{"secret":"do-not-log"}"#).unwrap_err();
        assert!(!error.contains("do-not-log"));
        assert!(classify_rpc_line(r#"{"id":1,"result":{},"error":{}}"#).is_err());
    }

    #[test]
    fn thread_continuity_requests_and_responses_are_bounded() {
        assert_eq!(
            thread_request(1, None, "/tmp/project", "model")["method"],
            "thread/start"
        );
        assert_eq!(
            thread_request(2, Some("thr-1"), "/tmp/project", "model")["method"],
            "thread/resume"
        );
        assert_eq!(
            thread_id_from_response(&json!({"result":{"thread":{"id":"thr-1"}}}), "thread/start")
                .unwrap(),
            "thr-1"
        );
        let error = thread_id_from_response(
            &json!({"error":{"message":"secret token=abc"}}),
            "thread/start",
        )
        .unwrap_err();
        assert!(!error.contains("secret"));
    }

    #[test]
    fn active_timeout_excludes_human_wait_time() {
        let start = Instant::now();
        let mut timeout = ActiveTimeout::new(Duration::from_secs(2));
        timeout.last_checked = start;
        assert!(!timeout.observe(start + Duration::from_secs(1), false));
        assert!(!timeout.observe(start + Duration::from_secs(60), true));
        assert!(!timeout.observe(start + Duration::from_secs(61), false));
        assert!(timeout.observe(start + Duration::from_secs(63), false));
    }

    #[test]
    fn rpc_correlation_defers_unrelated_messages_and_honors_cancellation() {
        let (tx, rx) = mpsc::channel();
        tx.send(json!({"id": 8, "result": {"ignored": true}}).to_string())
            .unwrap();
        tx.send(json!({"id": 7, "result": {"ok": true}}).to_string())
            .unwrap();
        let mut inbox = RpcInbox::new(rx);
        let mut budget = ActiveTimeout::new(Duration::from_secs(1));
        let response = wait_for_response(
            &mut inbox,
            RpcId::Number(7.into()),
            &mut budget,
            |_, _, _| Err("unexpected request".to_string()),
            || false,
            || false,
        )
        .unwrap();
        assert_eq!(response["result"]["ok"], true);
        assert_eq!(inbox.deferred.len(), 1);

        let (_tx, rx) = mpsc::channel();
        let mut inbox = RpcInbox::new(rx);
        let mut budget = ActiveTimeout::new(Duration::from_secs(1));
        let cancelled = AtomicBool::new(true);
        let error = wait_for_response(
            &mut inbox,
            RpcId::Number(1.into()),
            &mut budget,
            |_, _, _| Ok(()),
            || false,
            || cancelled.load(Ordering::Acquire),
        )
        .unwrap_err();
        assert!(error.contains("cancelled"));
    }

    #[test]
    fn process_boundary_owns_app_server_io_and_shutdown() {
        let config = AppServerProcessConfig {
            executable: "sh".to_string(),
            cwd: None,
            arguments: vec![
                "-c".to_string(),
                "read line; printf '%s\\n' \"$line\"; sleep 30".to_string(),
            ],
            capture_stderr: true,
        };
        let mut process = AppServerProcess::spawn(&config).unwrap();
        let output = process.take_stdout_lines().unwrap();
        send_json_shared(&process.stdin(), json!({"id": 1, "result": {}})).unwrap();
        let line = output.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(matches!(
            classify_rpc_line(&line).unwrap(),
            RpcMessage::Response { .. }
        ));
        assert!(process.is_alive());
        process.terminate();
        assert!(!process.is_alive());
    }
}
