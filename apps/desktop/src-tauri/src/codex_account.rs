use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::process::terminate_child;

const RPC_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_SAFE_TEXT: usize = 2_000;
const MAX_ITEMS: usize = 200;
const MANIFEST_0133: &str = include_str!("../../../../contracts/codex-app-server/0.133.0.json");
const MANIFEST_0143: &str = include_str!("../../../../contracts/codex-app-server/0.143.0.json");
const MANIFEST_0144: &str = include_str!("../../../../contracts/codex-app-server/0.144.0.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompatibilityManifest {
    codex_version: String,
    client_request_methods: Vec<String>,
    server_notification_methods: Vec<String>,
    app_tool_approval_modes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexHostCapabilities {
    codex_version: String,
    manifest_version: String,
    supports_account: bool,
    supports_browser_login: bool,
    supports_device_login: bool,
    supports_hosted_login_success: bool,
    supports_apps: bool,
    supports_mcp: bool,
    supports_writes_approval: bool,
    compatibility_warning: Option<String>,
    pub(crate) supports_last_turn_fork: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexHostAccount {
    account_type: String,
    email: Option<String>,
    plan_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexHostApp {
    id: String,
    name: String,
    description: Option<String>,
    enabled: bool,
    accessible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexHostMcpServer {
    name: String,
    auth_status: String,
    tool_count: usize,
    resource_count: usize,
    resource_template_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexHostSnapshot {
    capabilities: CodexHostCapabilities,
    requires_openai_auth: bool,
    account: Option<CodexHostAccount>,
    apps: Vec<CodexHostApp>,
    apps_error: Option<String>,
    mcp_servers: Vec<CodexHostMcpServer>,
    mcp_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CodexLoginStartRequest {
    flow: String,
    use_hosted_login_success_page: Option<bool>,
    app_brand: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexLoginStartResult {
    flow: String,
    login_id: String,
    url: String,
    user_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CodexLoginCancelRequest {
    login_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CodexMcpLoginRequest {
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexMcpLoginResult {
    name: String,
    authorization_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CodexAppApprovalRequest {
    mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexHostNotification {
    method: String,
    params: Value,
}

struct HostProcess {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<i64, mpsc::Sender<Value>>>>,
    capabilities: CodexHostCapabilities,
}

impl Drop for HostProcess {
    fn drop(&mut self) {
        terminate_child(&mut self.child);
    }
}

#[derive(Default)]
pub(crate) struct CodexHostState {
    process: Mutex<Option<HostProcess>>,
    next_id: AtomicI64,
}

impl CodexHostState {
    fn ensure_started(&self, app: &AppHandle) -> Result<(), String> {
        let mut slot = self
            .process
            .lock()
            .map_err(|_| "Codex host-control state is unavailable".to_string())?;
        if slot
            .as_mut()
            .is_some_and(|process| process.child.try_wait().ok().flatten().is_none())
        {
            return Ok(());
        }
        drop(slot.take());
        *slot = Some(start_host_process(app.clone())?);
        Ok(())
    }

    pub(crate) fn capabilities(&self, app: &AppHandle) -> Result<CodexHostCapabilities, String> {
        self.ensure_started(app)?;
        self.process
            .lock()
            .map_err(|_| "Codex host-control state is unavailable".to_string())?
            .as_ref()
            .map(|process| process.capabilities.clone())
            .ok_or_else(|| "Codex host-control session is unavailable".to_string())
    }

    pub(crate) fn request(
        &self,
        app: &AppHandle,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        self.ensure_started(app)?;
        let (id, originating_pending, rx, method_name) = {
            let slot = self
                .process
                .lock()
                .map_err(|_| "Codex host-control state is unavailable".to_string())?;
            let process = slot
                .as_ref()
                .ok_or_else(|| "Codex host-control session is unavailable".to_string())?;
            if !process.capabilities.supports_method(method) {
                return Err(format!(
                    "{method} is not available in the contract-tested Codex manifest"
                ));
            }
            let id = self
                .next_id
                .fetch_add(1, Ordering::Relaxed)
                .saturating_add(2);
            let (tx, rx) = mpsc::channel();
            process
                .pending
                .lock()
                .map_err(|_| "Codex host-control response state is unavailable".to_string())?
                .insert(id, tx);
            if let Err(error) = send_json(
                &process.stdin,
                json!({ "method": method, "id": id, "params": params }),
            ) {
                if let Ok(mut pending) = process.pending.lock() {
                    pending.remove(&id);
                }
                return Err(error);
            }
            (id, process.pending.clone(), rx, method.to_string())
        };
        let response = match rx.recv_timeout(RPC_TIMEOUT) {
            Ok(response) => response,
            Err(_) => {
                if let Ok(mut pending) = originating_pending.lock() {
                    pending.remove(&id);
                }
                return Err(format!("Timed out waiting for {method_name}"));
            }
        };
        if let Some(error) = response.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .map(safe_error_text)
                .unwrap_or_else(|| "Codex app-server rejected the request".to_string());
            return Err(format!("{method_name} failed: {message}"));
        }
        response
            .get("result")
            .cloned()
            .ok_or_else(|| format!("{method_name} returned no result"))
    }
}

impl CodexHostCapabilities {
    fn supports_method(&self, method: &str) -> bool {
        let Ok(manifest) = selected_manifest(&self.codex_version) else {
            return false;
        };
        method == "initialize"
            || manifest
                .client_request_methods
                .iter()
                .any(|entry| entry == method)
    }
}

fn start_host_process(app: AppHandle) -> Result<HostProcess, String> {
    let version_output = Command::new("codex")
        .arg("--version")
        .output()
        .map_err(|error| format!("Failed to inspect Codex version: {error}"))?;
    let raw_version = String::from_utf8_lossy(&version_output.stdout);
    let version = parse_codex_version(&raw_version).ok_or_else(|| {
        "Codex version is not compatible with the app-server manifest".to_string()
    })?;
    let capabilities = capabilities_for_version(&version)?;
    let mut child = Command::new("codex")
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to start Codex host-control app-server: {error}"))?;
    let stdin = match child.stdin.take() {
        Some(stdin) => Arc::new(Mutex::new(stdin)),
        None => {
            terminate_child(&mut child);
            return Err("Codex stdin is unavailable".to_string());
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_child(&mut child);
            return Err("Codex stdout is unavailable".to_string());
        }
    };
    let pending = Arc::new(Mutex::new(HashMap::<i64, mpsc::Sender<Value>>::new()));
    let reader_pending = pending.clone();
    let reader_stdin = stdin.clone();
    thread::spawn(move || read_host_messages(stdout, reader_stdin, reader_pending, app));
    let process = HostProcess {
        child,
        stdin,
        pending,
        capabilities,
    };
    let (tx, rx) = mpsc::channel();
    process
        .pending
        .lock()
        .map_err(|_| "Codex response state is unavailable".to_string())?
        .insert(1, tx);
    send_json(
        &process.stdin,
        json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": { "name": "multaiplayer", "title": "multAIplayer", "version": env!("CARGO_PKG_VERSION") },
                "capabilities": { "experimentalApi": true }
            }
        }),
    )?;
    let response = rx
        .recv_timeout(RPC_TIMEOUT)
        .map_err(|_| "Timed out initializing Codex host-control session".to_string())?;
    if response.get("error").is_some() {
        return Err("Codex host-control initialization failed".to_string());
    }
    send_json(
        &process.stdin,
        json!({ "method": "initialized", "params": {} }),
    )?;
    Ok(process)
}

fn read_host_messages(
    stdout: impl std::io::Read,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<i64, mpsc::Sender<Value>>>>,
    app: AppHandle,
) {
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("method").is_some() {
            if let Some(id) = value.get("id").filter(|id| id.is_i64() || id.is_string()) {
                // Host-control never accepts externally managed token refreshes or dynamic tools.
                let _ = send_json(
                    &stdin,
                    json!({
                        "id": id,
                        "error": { "code": -32601, "message": "Unsupported in host-control session" }
                    }),
                );
                continue;
            }
        }
        if let Some(id) = value.get("id").and_then(Value::as_i64) {
            if let Ok(mut entries) = pending.lock() {
                if let Some(tx) = entries.remove(&id) {
                    let _ = tx.send(value);
                }
            }
            continue;
        }
        let Some(method) = value.get("method").and_then(Value::as_str) else {
            continue;
        };
        if let Some(notification) = sanitize_notification(method, value.get("params")) {
            let _ = app.emit("codex://host-notification", notification);
        }
    }
    if let Ok(mut entries) = pending.lock() {
        entries.clear();
    }
}

fn send_json(stdin: &Arc<Mutex<ChildStdin>>, value: Value) -> Result<(), String> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| "Codex stdin is unavailable".to_string())?;
    writeln!(stdin, "{value}")
        .map_err(|error| format!("Failed to write Codex request: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("Failed to flush Codex request: {error}"))
}

fn sanitize_notification(method: &str, params: Option<&Value>) -> Option<CodexHostNotification> {
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

fn safe_error_text(value: &str) -> String {
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

#[path = "codex_account/compatibility.rs"]
mod compatibility;
use compatibility::*;
#[typed_tauri_command::command]
pub(crate) fn codex_host_snapshot(
    state: tauri::State<'_, CodexHostState>,
    app: AppHandle,
) -> crate::command_error::CommandResult<CodexHostSnapshot> {
    let capabilities = state.capabilities(&app)?;
    let account_result = state.request(&app, "account/read", json!({ "refreshToken": false }))?;
    let requires_openai_auth = account_result
        .get("requiresOpenaiAuth")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let account = account_result
        .get("account")
        .filter(|value| !value.is_null())
        .map(parse_account)
        .transpose()?;
    let (apps, apps_error) = if capabilities.supports_apps {
        match state.request(
            &app,
            "app/list",
            json!({ "limit": MAX_ITEMS, "forceRefetch": false }),
        ) {
            Ok(value) => (parse_apps(&value)?, None),
            Err(error) => (Vec::new(), Some(safe_error_text(&error))),
        }
    } else {
        (Vec::new(), None)
    };
    let (mcp_servers, mcp_error) = if capabilities.supports_mcp {
        match state.request(
            &app,
            "mcpServerStatus/list",
            json!({ "limit": MAX_ITEMS, "detail": "toolsAndAuthOnly" }),
        ) {
            Ok(value) => (parse_mcp_servers(&value)?, None),
            Err(error) => (Vec::new(), Some(safe_error_text(&error))),
        }
    } else {
        (Vec::new(), None)
    };
    Ok(CodexHostSnapshot {
        capabilities,
        requires_openai_auth,
        account,
        apps,
        apps_error,
        mcp_servers,
        mcp_error,
    })
}

fn parse_account(value: &Value) -> Result<CodexHostAccount, String> {
    let account_type = bounded_string(value.get("type"), "account type", 64)?;
    Ok(CodexHostAccount {
        account_type,
        email: value
            .get("email")
            .and_then(Value::as_str)
            .filter(|value| value.chars().count() <= 320)
            .map(str::to_string),
        plan_type: value
            .get("planType")
            .and_then(Value::as_str)
            .filter(|value| value.chars().count() <= 64)
            .map(str::to_string),
    })
}

fn parse_apps(value: &Value) -> Result<Vec<CodexHostApp>, String> {
    let items = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "app/list returned no data".to_string())?;
    Ok(items
        .iter()
        .take(MAX_ITEMS)
        .filter_map(|item| {
            Some(CodexHostApp {
                id: bounded_string(item.get("id"), "app id", 256).ok()?,
                name: bounded_string(item.get("name"), "app name", 256).ok()?,
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .filter(|value| value.chars().count() <= MAX_SAFE_TEXT)
                    .map(str::to_string),
                enabled: item
                    .get("isEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                accessible: item
                    .get("isAccessible")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect())
}

fn parse_mcp_servers(value: &Value) -> Result<Vec<CodexHostMcpServer>, String> {
    let items = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "mcpServerStatus/list returned no data".to_string())?;
    Ok(items
        .iter()
        .take(MAX_ITEMS)
        .filter_map(|item| {
            Some(CodexHostMcpServer {
                name: bounded_string(item.get("name"), "MCP server name", 256).ok()?,
                auth_status: bounded_string(item.get("authStatus"), "MCP auth status", 64).ok()?,
                tool_count: item
                    .get("tools")
                    .and_then(Value::as_object)
                    .map_or(0, Map::len),
                resource_count: item
                    .get("resources")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len),
                resource_template_count: item
                    .get("resourceTemplates")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len),
            })
        })
        .collect())
}

#[typed_tauri_command::command]
pub(crate) fn codex_account_login_start(
    request: CodexLoginStartRequest,
    state: tauri::State<'_, CodexHostState>,
    app: AppHandle,
) -> crate::command_error::CommandResult<CodexLoginStartResult> {
    let capabilities = state.capabilities(&app)?;
    let params = match request.flow.as_str() {
        "browser" if capabilities.supports_browser_login => {
            let mut params = json!({ "type": "chatgpt" });
            if request.use_hosted_login_success_page.unwrap_or(false) {
                if !capabilities.supports_hosted_login_success {
                    return Err("Hosted login success pages require Codex 0.144.0 or newer".into());
                }
                params["useHostedLoginSuccessPage"] = Value::Bool(true);
                params["appBrand"] = Value::String(
                    match request.app_brand.as_deref() {
                        Some("codex") => "codex",
                        _ => "chatgpt",
                    }
                    .to_string(),
                );
            }
            params
        }
        "device" if capabilities.supports_device_login => json!({ "type": "chatgptDeviceCode" }),
        "browser" | "device" => {
            return Err("The selected login flow is not supported by this Codex version".into())
        }
        _ => return Err("Codex login flow must be browser or device".into()),
    };
    let result = state.request(&app, "account/login/start", params)?;
    let login_id = bounded_string(result.get("loginId"), "login id", 256)?;
    let (url, user_code) = if request.flow == "browser" {
        (safe_url(result.get("authUrl"), "auth URL")?, None)
    } else {
        (
            safe_url(result.get("verificationUrl"), "verification URL")?,
            Some(bounded_string(result.get("userCode"), "user code", 64)?),
        )
    };
    Ok(CodexLoginStartResult {
        flow: request.flow,
        login_id,
        url,
        user_code,
    })
}

#[typed_tauri_command::command]
pub(crate) fn codex_account_login_cancel(
    request: CodexLoginCancelRequest,
    state: tauri::State<'_, CodexHostState>,
    app: AppHandle,
) -> crate::command_error::CommandResult<()> {
    if request.login_id.is_empty() || request.login_id.len() > 256 {
        return Err("Codex login id is invalid".into());
    }
    state.request(
        &app,
        "account/login/cancel",
        json!({ "loginId": request.login_id }),
    )?;
    Ok(())
}

#[typed_tauri_command::command]
pub(crate) fn codex_account_logout(
    state: tauri::State<'_, CodexHostState>,
    app: AppHandle,
) -> crate::command_error::CommandResult<()> {
    state.request(&app, "account/logout", json!({}))?;
    Ok(())
}

#[typed_tauri_command::command]
pub(crate) fn codex_mcp_login_start(
    request: CodexMcpLoginRequest,
    state: tauri::State<'_, CodexHostState>,
    app: AppHandle,
) -> crate::command_error::CommandResult<CodexMcpLoginResult> {
    if request.name.is_empty() || request.name.chars().count() > 256 {
        return Err("MCP server name is invalid".into());
    }
    let result = state.request(
        &app,
        "mcpServer/oauth/login",
        json!({ "name": request.name, "timeoutSecs": 300 }),
    )?;
    Ok(CodexMcpLoginResult {
        name: request.name,
        authorization_url: safe_url(result.get("authorizationUrl"), "MCP authorization URL")?,
    })
}

#[typed_tauri_command::command]
pub(crate) fn codex_app_approval_mode_set(
    request: CodexAppApprovalRequest,
    state: tauri::State<'_, CodexHostState>,
    app: AppHandle,
) -> crate::command_error::CommandResult<()> {
    if !is_supported_app_approval_mode(&request.mode) {
        return Err("App approval mode is invalid".into());
    }
    let capabilities = state.capabilities(&app)?;
    if request.mode == "writes" && !capabilities.supports_writes_approval {
        return Err("The writes approval mode requires Codex 0.144.0 or newer".into());
    }
    state.request(
        &app,
        "config/value/write",
        json!({
            "keyPath": "apps._default.default_tools_approval_mode",
            "value": request.mode,
            "mergeStrategy": "upsert"
        }),
    )?;
    Ok(())
}

fn is_supported_app_approval_mode(mode: &str) -> bool {
    matches!(mode, "auto" | "prompt" | "writes")
}

#[cfg(test)]
#[path = "codex_account/tests.rs"]
mod tests;
