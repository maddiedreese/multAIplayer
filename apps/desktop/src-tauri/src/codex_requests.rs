use crate::codex_rpc::{
    send_json_shared, wait_for_response as wait_for_rpc_response,
    wait_for_response_message as wait_for_rpc_response_message, ActiveTimeout, RpcId, RpcInbox,
    SharedStdin,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

const MAX_RPC_METHOD_CHARS: usize = 256;
const MAX_RPC_PARAMS_BYTES: usize = 256 * 1024;
const MAX_PENDING_REQUESTS_PER_SESSION: usize = 64;
const MAX_HUMAN_WAIT: Duration = Duration::from_secs(15 * 60);
const MAX_DISPLAY_TEXT_CHARS: usize = 8_000;
const MAX_FORM_FIELDS: usize = 24;
const MAX_ENUM_OPTIONS: usize = 50;
static NEXT_SERVER_REQUEST_KEY: AtomicU64 = AtomicU64::new(1);

const INTERACTIVE_METHODS: &[&str] = &[
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
    "tool/requestUserInput",
    "mcpServer/elicitation/request",
    "applyPatchApproval",
    "execCommandApproval",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexServerRequestEvent {
    request_key: String,
    room_id: String,
    method: String,
    params: Value,
    expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexServerRequestResolvedEvent {
    request_key: String,
    room_id: String,
}

struct PendingServerRequest {
    event: CodexServerRequestEvent,
    original_params: Value,
    id: RpcId,
    session_id: u64,
    stdin: SharedStdin,
    app: tauri::AppHandle,
    expires_at: Instant,
}

#[derive(Clone, Default)]
pub(crate) struct CodexRpcState {
    pending: Arc<Mutex<HashMap<String, PendingServerRequest>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexServerRequestResponse {
    result: Option<Value>,
    error: Option<CodexServerRpcError>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CodexServerRpcError {
    code: i64,
    message: String,
    data: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondCodexServerRequest {
    request_key: String,
    response: CodexServerRequestResponse,
}

pub(crate) struct RpcRequestContext<'a> {
    pub(crate) app: &'a tauri::AppHandle,
    pub(crate) state: CodexRpcState,
    pub(crate) room_id: &'a str,
    pub(crate) session_id: u64,
    pub(crate) stdin: SharedStdin,
    pub(crate) cancelled: Option<Arc<std::sync::atomic::AtomicBool>>,
}

impl RpcRequestContext<'_> {
    fn is_cancelled(&self) -> bool {
        self.cancelled
            .as_ref()
            .is_some_and(|cancelled| cancelled.load(Ordering::Acquire))
    }
}

pub(crate) fn wait_for_response(
    inbox: &mut RpcInbox,
    id: RpcId,
    budget: &mut ActiveTimeout,
    context: &RpcRequestContext<'_>,
) -> Result<Value, String> {
    wait_for_rpc_response(
        inbox,
        id,
        budget,
        |id, method, params| context.state.register(context, id, method, params),
        || context.state.has_pending_session(context.session_id),
        || context.is_cancelled(),
    )
}

pub(crate) fn wait_for_response_message(
    inbox: &mut RpcInbox,
    id: RpcId,
    budget: &mut ActiveTimeout,
    context: &RpcRequestContext<'_>,
) -> Result<Value, String> {
    wait_for_rpc_response_message(
        inbox,
        id,
        budget,
        &mut |id, method, params| context.state.register(context, id, method, params),
        &mut || context.state.has_pending_session(context.session_id),
        &mut || context.is_cancelled(),
    )
}

pub(crate) struct PendingSessionGuard {
    state: CodexRpcState,
    session_id: u64,
    armed: bool,
}

impl PendingSessionGuard {
    pub(crate) fn new(state: CodexRpcState, session_id: u64) -> Self {
        Self {
            state,
            session_id,
            armed: true,
        }
    }

    pub(crate) fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PendingSessionGuard {
    fn drop(&mut self) {
        if self.armed {
            self.state.cancel_session(
                self.session_id,
                "Codex app-server session initialization ended",
            );
        }
    }
}

impl CodexRpcState {
    pub(crate) fn list(&self) -> Result<Vec<CodexServerRequestEvent>, String> {
        self.expire_due();
        let pending = self
            .pending
            .lock()
            .map_err(|_| "Codex server request state is unavailable".to_string())?;
        let mut requests = pending
            .values()
            .map(|request| request.event.clone())
            .collect::<Vec<_>>();
        requests.sort_by(|left, right| left.request_key.cmp(&right.request_key));
        Ok(requests)
    }

    pub(crate) fn respond(&self, request: RespondCodexServerRequest) -> Result<(), String> {
        self.expire_due();
        if request.request_key.len() > 128 || request.request_key.trim().is_empty() {
            return Err("Codex server request key is invalid".to_string());
        }
        let (method, request_params) = {
            let pending = self
                .pending
                .lock()
                .map_err(|_| "Codex server request state is unavailable".to_string())?;
            let pending = pending
                .get(&request.request_key)
                .ok_or_else(|| "Codex server request is no longer pending".to_string())?;
            (
                pending.event.method.clone(),
                pending.original_params.clone(),
            )
        };
        let response = match (request.response.result, request.response.error) {
            (Some(result), None) => (
                "result",
                validate_codex_server_result(&method, &request_params, result)?,
            ),
            (None, Some(error)) => {
                if error.message.trim().is_empty() || error.message.chars().count() > 2_000 {
                    return Err("Codex server error message is invalid".to_string());
                }
                (
                    "error",
                    serde_json::to_value(CodexServerRpcError {
                        code: error.code,
                        message: error.message,
                        data: None,
                    })
                    .map_err(|error| format!("Codex server error is invalid: {error}"))?,
                )
            }
            _ => {
                return Err(
                    "Codex server response must contain exactly one of result or error".to_string(),
                )
            }
        };
        if serde_json::to_vec(&response.1)
            .map_err(|error| format!("Codex server response is invalid: {error}"))?
            .len()
            > MAX_RPC_PARAMS_BYTES
        {
            return Err("Codex server response exceeds the size limit".to_string());
        }
        let pending = self
            .pending
            .lock()
            .map_err(|_| "Codex server request state is unavailable".to_string())?
            .remove(&request.request_key)
            .ok_or_else(|| "Codex server request is no longer pending".to_string())?;
        let mut message = json!({ "id": pending.id.to_value() });
        message[response.0] = response.1;
        send_json_shared(&pending.stdin, message)
    }

    pub(crate) fn register(
        &self,
        context: &RpcRequestContext<'_>,
        id: RpcId,
        method: String,
        params: Value,
    ) -> Result<(), String> {
        self.expire_due();
        if method.is_empty() || method.chars().count() > MAX_RPC_METHOD_CHARS {
            return send_rpc_error(
                &context.stdin,
                &id,
                -32601,
                "Unsupported app-server request",
            );
        }
        if serde_json::to_vec(&params)
            .map_err(|_| "Codex server request params are invalid".to_string())?
            .len()
            > MAX_RPC_PARAMS_BYTES
        {
            return send_rpc_error(
                &context.stdin,
                &id,
                -32600,
                "Server request payload exceeds client limit",
            );
        }

        // Unsupported methods are rejected natively. Their params never cross the webview boundary.
        if !INTERACTIVE_METHODS.contains(&method.as_str()) {
            return send_rpc_error(
                &context.stdin,
                &id,
                -32601,
                "Unsupported app-server request",
            );
        }
        let projected = match project_server_request(&method, &params) {
            Ok(projected) => projected,
            Err(_) => {
                return send_rpc_error(
                    &context.stdin,
                    &id,
                    -32602,
                    "Invalid or unsupported interactive request",
                )
            }
        };

        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Codex server request state is unavailable".to_string())?;
        if pending
            .values()
            .filter(|request| request.session_id == context.session_id)
            .count()
            >= MAX_PENDING_REQUESTS_PER_SESSION
        {
            drop(pending);
            return send_rpc_error(
                &context.stdin,
                &id,
                -32000,
                "Too many pending server requests",
            );
        }
        let request_key = format!(
            "rpc-{}-{}",
            context.session_id,
            NEXT_SERVER_REQUEST_KEY.fetch_add(1, Ordering::Relaxed)
        );
        let expires_at_ms = SystemTime::now()
            .checked_add(MAX_HUMAN_WAIT)
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
            .unwrap_or(u64::MAX);
        let event = CodexServerRequestEvent {
            request_key: request_key.clone(),
            room_id: context.room_id.to_string(),
            method,
            params: projected,
            expires_at_ms,
        };
        pending.insert(
            request_key,
            PendingServerRequest {
                event: event.clone(),
                original_params: params,
                id,
                session_id: context.session_id,
                stdin: context.stdin.clone(),
                app: context.app.clone(),
                expires_at: Instant::now() + MAX_HUMAN_WAIT,
            },
        );
        drop(pending);
        context
            .app
            .emit("codex://server-request", event)
            .map_err(|error| format!("Failed to emit Codex server request: {error}"))
    }

    pub(crate) fn has_pending_session(&self, session_id: u64) -> bool {
        self.expire_due();
        self.pending.lock().is_ok_and(|pending| {
            pending
                .values()
                .any(|request| request.session_id == session_id)
        })
    }

    pub(crate) fn cancel_session(&self, session_id: u64, message: &str) -> usize {
        self.cancel_where(|request| request.session_id == session_id, message)
    }

    pub(crate) fn remove_resolved(
        &self,
        session_id: u64,
        id: &RpcId,
    ) -> Option<CodexServerRequestResolvedEvent> {
        let Ok(mut pending) = self.pending.lock() else {
            return None;
        };
        let key = pending
            .iter()
            .find(|(_, request)| request.session_id == session_id && &request.id == id)
            .map(|(key, _)| key.clone())?;
        let request = pending.remove(&key)?;
        Some(CodexServerRequestResolvedEvent {
            request_key: key,
            room_id: request.event.room_id,
        })
    }

    pub(crate) fn cancel_room(&self, room_id: &str, message: &str) -> usize {
        self.cancel_where(|request| request.event.room_id == room_id, message)
    }

    fn expire_due(&self) -> usize {
        let now = Instant::now();
        self.cancel_where(
            |request| pending_request_expired(request.expires_at, now),
            "Codex request expired while waiting for the host",
        )
    }

    fn cancel_where(
        &self,
        predicate: impl Fn(&PendingServerRequest) -> bool,
        message: &str,
    ) -> usize {
        let Ok(mut pending) = self.pending.lock() else {
            return 0;
        };
        let keys = pending
            .iter()
            .filter(|(_, request)| predicate(request))
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        let removed = keys
            .iter()
            .filter_map(|key| pending.remove(key).map(|request| (key.clone(), request)))
            .collect::<Vec<_>>();
        drop(pending);
        for (key, request) in &removed {
            let _ = send_rpc_error(&request.stdin, &request.id, -32800, message);
            let _ = request.app.emit(
                "codex://server-request-resolved",
                CodexServerRequestResolvedEvent {
                    request_key: key.clone(),
                    room_id: request.event.room_id.clone(),
                },
            );
        }
        removed.len()
    }
}

fn pending_request_expired(expires_at: Instant, now: Instant) -> bool {
    expires_at <= now
}

fn send_rpc_error(stdin: &SharedStdin, id: &RpcId, code: i64, message: &str) -> Result<(), String> {
    send_json_shared(
        stdin,
        json!({ "id": id.to_value(), "error": { "code": code, "message": message } }),
    )
}

fn project_server_request(method: &str, params: &Value) -> Result<Value, String> {
    let params = params
        .as_object()
        .ok_or_else(|| "Request params must be an object".to_string())?;
    let mut output = Map::new();
    match method {
        "item/commandExecution/requestApproval" | "execCommandApproval" => {
            copy_text(params, &mut output, "reason", 2_000);
            copy_text(params, &mut output, "cwd", 4_096);
            copy_text_or_string_array(params, &mut output, "command", 200, MAX_DISPLAY_TEXT_CHARS);
        }
        "item/fileChange/requestApproval" | "applyPatchApproval" => {
            copy_text(params, &mut output, "reason", 2_000);
            copy_text(params, &mut output, "grantRoot", 4_096);
        }
        "item/permissions/requestApproval" => {
            copy_text(params, &mut output, "reason", 2_000);
            copy_text(params, &mut output, "cwd", 4_096);
            output.insert(
                "permissions".to_string(),
                project_permissions(params.get("permissions").unwrap_or(&Value::Null))?,
            );
        }
        "item/tool/requestUserInput" | "tool/requestUserInput" => {
            let questions = params
                .get("questions")
                .and_then(Value::as_array)
                .ok_or_else(|| "User input questions are missing".to_string())?;
            let projected = questions
                .iter()
                .take(3)
                .map(project_user_question)
                .collect::<Result<Vec<_>, _>>()?;
            if projected.is_empty() {
                return Err("User input questions are empty".to_string());
            }
            output.insert("questions".to_string(), Value::Array(projected));
        }
        "mcpServer/elicitation/request" => return project_mcp_elicitation(params),
        _ => return Err("Unsupported interactive request".to_string()),
    }
    for key in ["threadId", "turnId", "itemId"] {
        copy_text(params, &mut output, key, 512);
    }
    Ok(Value::Object(output))
}

fn project_permissions(value: &Value) -> Result<Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Permission profile must be an object".to_string())?;
    let mut output = Map::new();
    if let Some(network) = object.get("network").and_then(Value::as_object) {
        let mut projected = Map::new();
        if let Some(enabled) = network.get("enabled").and_then(Value::as_bool) {
            projected.insert("enabled".to_string(), Value::Bool(enabled));
        }
        output.insert("network".to_string(), Value::Object(projected));
    }
    if let Some(files) = object.get("fileSystem").and_then(Value::as_object) {
        let mut projected = Map::new();
        for key in ["read", "write"] {
            if let Some(items) = files.get(key).and_then(Value::as_array) {
                if items.len() > 100 {
                    return Err("Permission path list is too large".to_string());
                }
                projected.insert(
                    key.to_string(),
                    Value::Array(
                        items
                            .iter()
                            .map(|item| bounded_permission_text(item, 4_096).map(Value::String))
                            .collect::<Result<Vec<_>, _>>()?,
                    ),
                );
            }
        }
        if let Some(depth) = files.get("globScanMaxDepth").and_then(Value::as_u64) {
            if depth == 0 || depth > u32::MAX as u64 {
                return Err("Permission glob scan depth is invalid".to_string());
            }
            projected.insert("globScanMaxDepth".to_string(), json!(depth));
        }
        if let Some(entries) = files.get("entries").and_then(Value::as_array) {
            if entries.len() > 100 {
                return Err("Permission entry list is too large".to_string());
            }
            projected.insert(
                "entries".to_string(),
                Value::Array(
                    entries
                        .iter()
                        .map(project_permission_entry)
                        .collect::<Result<Vec<_>, _>>()?,
                ),
            );
        }
        output.insert("fileSystem".to_string(), Value::Object(projected));
    }
    Ok(Value::Object(output))
}

fn project_permission_entry(value: &Value) -> Result<Value, String> {
    let entry = value
        .as_object()
        .ok_or_else(|| "Permission entry must be an object".to_string())?;
    let access = entry
        .get("access")
        .and_then(Value::as_str)
        .filter(|access| matches!(*access, "read" | "write" | "deny"))
        .ok_or_else(|| "Permission entry access is invalid".to_string())?;
    let path = entry
        .get("path")
        .and_then(Value::as_object)
        .ok_or_else(|| "Permission entry path is invalid".to_string())?;
    let projected_path = match path.get("type").and_then(Value::as_str) {
        Some("path") => json!({
            "type": "path",
            "path": bounded_permission_text(path.get("path").unwrap_or(&Value::Null), 4_096)?
        }),
        Some("glob_pattern") => json!({
            "type": "glob_pattern",
            "pattern": bounded_permission_text(path.get("pattern").unwrap_or(&Value::Null), 4_096)?
        }),
        Some("special") => {
            let special = path
                .get("value")
                .and_then(Value::as_object)
                .ok_or_else(|| "Special permission path is invalid".to_string())?;
            let kind = special
                .get("kind")
                .and_then(Value::as_str)
                .filter(|kind| {
                    matches!(
                        *kind,
                        "root" | "minimal" | "project_roots" | "tmpdir" | "slash_tmp" | "unknown"
                    )
                })
                .ok_or_else(|| "Special permission path kind is invalid".to_string())?;
            let mut projected =
                Map::from_iter([("kind".to_string(), Value::String(kind.to_string()))]);
            for key in ["path", "subpath"] {
                if let Some(value) = special.get(key) {
                    projected.insert(
                        key.to_string(),
                        Value::String(bounded_permission_text(value, 4_096)?),
                    );
                }
            }
            json!({ "type": "special", "value": projected })
        }
        _ => return Err("Permission entry path type is invalid".to_string()),
    };
    Ok(json!({ "access": access, "path": projected_path }))
}

fn bounded_permission_text(value: &Value, max: usize) -> Result<String, String> {
    let text = value
        .as_str()
        .ok_or_else(|| "Permission path must be text".to_string())?;
    if text.chars().count() > max || text.chars().any(char::is_control) {
        return Err("Permission path exceeds supported bounds".to_string());
    }
    Ok(text.to_string())
}

fn project_user_question(value: &Value) -> Result<Value, String> {
    let question = value
        .as_object()
        .ok_or_else(|| "User input question must be an object".to_string())?;
    let id = required_text(question, "id", 128)?;
    let prompt = question
        .get("question")
        .and_then(Value::as_str)
        .or_else(|| question.get("header").and_then(Value::as_str))
        .ok_or_else(|| "User input question is missing text".to_string())?;
    let mut output = json!({
        "id": id,
        "question": bound_text(prompt, 2_000),
        "isSecret": question.get("isSecret").and_then(Value::as_bool).unwrap_or(false),
        "isOther": question.get("isOther").and_then(Value::as_bool).unwrap_or(false)
    });
    if let Some(options) = question.get("options").and_then(Value::as_array) {
        output["options"] = Value::Array(
            options
                .iter()
                .take(MAX_ENUM_OPTIONS)
                .filter_map(|option| option.as_object())
                .filter_map(|option| {
                    let label = option.get("label")?.as_str()?;
                    Some(json!({
                        "label": bound_text(label, 200),
                        "description": option.get("description").and_then(Value::as_str).map(|text| bound_text(text, 500)).unwrap_or_default()
                    }))
                })
                .collect(),
        );
    }
    Ok(output)
}

fn project_mcp_elicitation(params: &Map<String, Value>) -> Result<Value, String> {
    let mode = required_text(params, "mode", 32)?;
    let message = required_text(params, "message", 2_000)?;
    match mode.as_str() {
        "url" => {
            let url = required_text(params, "url", 4_096)?;
            if !(url.starts_with("https://") || url.starts_with("http://"))
                || url.chars().any(char::is_control)
            {
                return Err("MCP elicitation URL is invalid".to_string());
            }
            Ok(json!({
                "mode": "url",
                "message": message,
                "url": url,
                "elicitationId": params.get("elicitationId").and_then(Value::as_str).map(|value| bound_text(value, 512))
            }))
        }
        "form" | "openai/form" => {
            let schema = params
                .get("requestedSchema")
                .ok_or_else(|| "MCP form schema is missing".to_string())?;
            Ok(json!({
                "mode": mode,
                "message": message,
                "requestedSchema": project_mcp_schema(schema)?
            }))
        }
        _ => Err("MCP elicitation mode is unsupported".to_string()),
    }
}

fn project_mcp_schema(value: &Value) -> Result<Value, String> {
    let schema = value
        .as_object()
        .ok_or_else(|| "MCP form schema must be an object".to_string())?;
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err("MCP form schema must describe an object".to_string());
    }
    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .ok_or_else(|| "MCP form properties are missing".to_string())?;
    if properties.len() > MAX_FORM_FIELDS {
        return Err("MCP form has too many fields".to_string());
    }
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|key| properties.contains_key(*key))
        .map(|key| Value::String(bound_text(key, 128)))
        .collect::<Vec<_>>();
    let mut projected = Map::new();
    for (key, property) in properties {
        if key.is_empty() || key.chars().count() > 128 {
            return Err("MCP form field id is invalid".to_string());
        }
        projected.insert(key.clone(), project_mcp_property(property)?);
    }
    Ok(json!({ "type": "object", "properties": projected, "required": required }))
}

fn project_mcp_property(value: &Value) -> Result<Value, String> {
    let property = value
        .as_object()
        .ok_or_else(|| "MCP form field must be an object".to_string())?;
    let kind = required_text(property, "type", 32)?;
    if !matches!(
        kind.as_str(),
        "string" | "number" | "integer" | "boolean" | "array"
    ) {
        return Err("MCP form field type is unsupported".to_string());
    }
    let mut output = Map::from_iter([("type".to_string(), Value::String(kind.clone()))]);
    for key in ["title", "description", "format"] {
        copy_text(property, &mut output, key, 1_000);
    }
    for key in [
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
    ] {
        if let Some(number) = property.get(key).and_then(Value::as_f64) {
            if number.is_finite() {
                output.insert(key.to_string(), json!(number));
            }
        }
    }
    if let Some(default) = property.get("default") {
        let projected_default = match (kind.as_str(), default) {
            ("string", Value::String(text)) => {
                Some(Value::String(bound_text(text, MAX_DISPLAY_TEXT_CHARS)))
            }
            ("number" | "integer", Value::Number(_)) | ("boolean", Value::Bool(_)) => {
                Some(default.clone())
            }
            ("array", Value::Array(items)) => Some(Value::Array(
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .take(MAX_ENUM_OPTIONS)
                    .map(|text| Value::String(bound_text(text, 200)))
                    .collect(),
            )),
            _ => None,
        };
        if let Some(default) = projected_default {
            output.insert("default".to_string(), default);
        }
    }
    if kind == "array" {
        let items = property
            .get("items")
            .and_then(Value::as_object)
            .ok_or_else(|| "MCP array field is missing items".to_string())?;
        output.insert("items".to_string(), project_enum_container(items)?);
    } else if kind == "string" {
        for key in ["enum", "oneOf", "anyOf", "enumNames"] {
            if let Some(value) = property.get(key) {
                output.insert(key.to_string(), project_enum_value(key, value)?);
            }
        }
    }
    Ok(Value::Object(output))
}

fn project_enum_container(items: &Map<String, Value>) -> Result<Value, String> {
    let mut output = Map::from_iter([("type".to_string(), Value::String("string".to_string()))]);
    let mut found = false;
    for key in ["enum", "oneOf", "anyOf"] {
        if let Some(value) = items.get(key) {
            output.insert(key.to_string(), project_enum_value(key, value)?);
            found = true;
        }
    }
    if !found {
        return Err("MCP array options are missing".to_string());
    }
    Ok(Value::Object(output))
}

fn project_enum_value(key: &str, value: &Value) -> Result<Value, String> {
    let values = value
        .as_array()
        .ok_or_else(|| "MCP enum options must be an array".to_string())?;
    if values.is_empty() || values.len() > MAX_ENUM_OPTIONS {
        return Err("MCP enum option count is invalid".to_string());
    }
    Ok(Value::Array(
        values
            .iter()
            .map(|value| {
                if key == "enum" || key == "enumNames" {
                    value
                        .as_str()
                        .map(|text| Value::String(bound_text(text, 200)))
                        .ok_or_else(|| "MCP enum option is invalid".to_string())
                } else {
                    let option = value
                        .as_object()
                        .ok_or_else(|| "MCP titled enum option is invalid".to_string())?;
                    let constant = required_text(option, "const", 200)?;
                    Ok(json!({
                        "const": constant,
                        "title": option.get("title").and_then(Value::as_str).map(|text| bound_text(text, 200)).unwrap_or_else(|| "Option".to_string())
                    }))
                }
            })
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

fn validate_codex_server_result(
    method: &str,
    request_params: &Value,
    result: Value,
) -> Result<Value, String> {
    let object = result
        .as_object()
        .ok_or_else(|| "Codex server result must be an object".to_string())?;
    match method {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            let decision = object.get("decision").and_then(Value::as_str);
            if matches!(
                decision,
                Some("accept" | "acceptForSession" | "decline" | "cancel")
            ) && object.len() == 1
            {
                Ok(result)
            } else {
                Err("Codex approval decision is invalid".to_string())
            }
        }
        "execCommandApproval" | "applyPatchApproval" => {
            let decision = object.get("decision").and_then(Value::as_str);
            if matches!(
                decision,
                Some("approved" | "approved_for_session" | "denied" | "timed_out" | "abort")
            ) && object.len() == 1
            {
                Ok(result)
            } else {
                Err("Legacy Codex approval decision is invalid".to_string())
            }
        }
        "item/permissions/requestApproval" => {
            validate_permission_result(request_params, object).map(|_| result)
        }
        "item/tool/requestUserInput" | "tool/requestUserInput" => {
            validate_user_input_result(request_params, object).map(|_| result)
        }
        "mcpServer/elicitation/request" => {
            validate_mcp_result(request_params, object).map(|_| result)
        }
        _ => Err("This Codex server request only supports an error response".to_string()),
    }
}

fn validate_permission_result(
    request_params: &Value,
    object: &Map<String, Value>,
) -> Result<(), String> {
    let granted = object
        .get("permissions")
        .and_then(Value::as_object)
        .ok_or_else(|| "Codex permission response is missing permissions".to_string())?;
    let requested = project_permissions(request_params.get("permissions").unwrap_or(&Value::Null))?
        .as_object()
        .cloned()
        .ok_or_else(|| "Codex requested permission profile is invalid".to_string())?;
    if !granted.is_empty() && granted != &requested {
        return Err("Codex permission grants must match the requested profile".to_string());
    }
    if object
        .get("scope")
        .and_then(Value::as_str)
        .is_some_and(|scope| !matches!(scope, "turn" | "session"))
    {
        return Err("Codex permission scope is invalid".to_string());
    }
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "permissions" | "scope" | "strictAutoReview"))
    {
        return Err("Codex permission response contains unsupported fields".to_string());
    }
    Ok(())
}

fn validate_user_input_result(
    request_params: &Value,
    object: &Map<String, Value>,
) -> Result<(), String> {
    let answers = object
        .get("answers")
        .and_then(Value::as_object)
        .ok_or_else(|| "Codex user-input response is missing answers".to_string())?;
    let question_ids = request_params
        .get("questions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|question| question.get("id").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    if answers.keys().any(|id| !question_ids.contains(id.as_str())) {
        return Err("Codex user-input response contains an unknown question".to_string());
    }
    for answer in answers.values() {
        let values = answer
            .get("answers")
            .and_then(Value::as_array)
            .ok_or_else(|| "Codex user-input answer is invalid".to_string())?;
        if values.len() > 20
            || values.iter().any(|value| {
                value
                    .as_str()
                    .is_none_or(|text| text.chars().count() > MAX_DISPLAY_TEXT_CHARS)
            })
        {
            return Err("Codex user-input answer exceeds supported bounds".to_string());
        }
    }
    if object.len() != 1 {
        return Err("Codex user-input response contains unsupported fields".to_string());
    }
    Ok(())
}

fn validate_mcp_result(request_params: &Value, object: &Map<String, Value>) -> Result<(), String> {
    let action = object
        .get("action")
        .and_then(Value::as_str)
        .filter(|action| matches!(*action, "accept" | "decline" | "cancel"))
        .ok_or_else(|| "MCP elicitation action is invalid".to_string())?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "action" | "content" | "_meta"))
    {
        return Err("MCP elicitation response contains unsupported fields".to_string());
    }
    if action != "accept" {
        if object
            .get("content")
            .is_some_and(|content| !content.is_null())
        {
            return Err("Declined MCP elicitation cannot include content".to_string());
        }
        return Ok(());
    }
    let mode = request_params.get("mode").and_then(Value::as_str);
    if mode == Some("url") {
        if object
            .get("content")
            .is_some_and(|content| !content.is_null())
        {
            return Err("URL MCP elicitation cannot include form content".to_string());
        }
        return Ok(());
    }
    if !matches!(mode, Some("form" | "openai/form")) {
        return Err("MCP elicitation mode is unsupported".to_string());
    }
    let schema = request_params
        .get("requestedSchema")
        .and_then(Value::as_object)
        .ok_or_else(|| "MCP form schema is invalid".to_string())?;
    let content = object
        .get("content")
        .and_then(Value::as_object)
        .ok_or_else(|| "Accepted MCP form is missing content".to_string())?;
    validate_mcp_content(schema, content)
}

fn validate_mcp_content(
    schema: &Map<String, Value>,
    content: &Map<String, Value>,
) -> Result<(), String> {
    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .ok_or_else(|| "MCP form properties are invalid".to_string())?;
    if content.keys().any(|key| !properties.contains_key(key)) {
        return Err("MCP form response contains an unknown field".to_string());
    }
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str);
    for key in required {
        if !content.contains_key(key) {
            return Err(format!("MCP form response is missing required field {key}"));
        }
    }
    for (key, value) in content {
        let property = properties
            .get(key)
            .and_then(Value::as_object)
            .ok_or_else(|| "MCP form field schema is invalid".to_string())?;
        validate_mcp_value(property, value)?;
    }
    Ok(())
}

fn validate_mcp_value(schema: &Map<String, Value>, value: &Value) -> Result<(), String> {
    match schema.get("type").and_then(Value::as_str) {
        Some("string") => {
            let text = value
                .as_str()
                .ok_or_else(|| "MCP form value must be text".to_string())?;
            let length = text.chars().count();
            if length > MAX_DISPLAY_TEXT_CHARS
                || schema
                    .get("minLength")
                    .and_then(Value::as_u64)
                    .is_some_and(|min| length < min as usize)
                || schema
                    .get("maxLength")
                    .and_then(Value::as_u64)
                    .is_some_and(|max| length > max as usize)
            {
                return Err("MCP text value violates its bounds".to_string());
            }
            let options = enum_strings(schema);
            if !options.is_empty() && !options.iter().any(|option| option == text) {
                return Err("MCP text value is not an allowed option".to_string());
            }
        }
        Some("number") | Some("integer") => {
            let number = value
                .as_f64()
                .ok_or_else(|| "MCP form value must be numeric".to_string())?;
            if schema.get("type").and_then(Value::as_str) == Some("integer")
                && number.fract() != 0.0
            {
                return Err("MCP integer value is invalid".to_string());
            }
            if schema
                .get("minimum")
                .and_then(Value::as_f64)
                .is_some_and(|min| number < min)
                || schema
                    .get("maximum")
                    .and_then(Value::as_f64)
                    .is_some_and(|max| number > max)
            {
                return Err("MCP numeric value violates its bounds".to_string());
            }
        }
        Some("boolean") if value.is_boolean() => {}
        Some("array") => {
            let values = value
                .as_array()
                .ok_or_else(|| "MCP form value must be a list".to_string())?;
            if values.len() > MAX_ENUM_OPTIONS
                || schema
                    .get("minItems")
                    .and_then(Value::as_u64)
                    .is_some_and(|min| values.len() < min as usize)
                || schema
                    .get("maxItems")
                    .and_then(Value::as_u64)
                    .is_some_and(|max| values.len() > max as usize)
            {
                return Err("MCP list value violates its bounds".to_string());
            }
            let items = schema
                .get("items")
                .and_then(Value::as_object)
                .ok_or_else(|| "MCP list schema is invalid".to_string())?;
            let options = enum_strings(items);
            if values.iter().any(|value| {
                value
                    .as_str()
                    .is_none_or(|text| !options.iter().any(|option| option == text))
            }) {
                return Err("MCP list contains an invalid option".to_string());
            }
        }
        _ => return Err("MCP form value type is unsupported".to_string()),
    }
    Ok(())
}

fn enum_strings(schema: &Map<String, Value>) -> Vec<String> {
    if let Some(values) = schema.get("enum").and_then(Value::as_array) {
        return values
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
    }
    for key in ["oneOf", "anyOf"] {
        if let Some(values) = schema.get(key).and_then(Value::as_array) {
            return values
                .iter()
                .filter_map(|value| value.get("const").and_then(Value::as_str))
                .map(str::to_string)
                .collect();
        }
    }
    Vec::new()
}

fn copy_text(source: &Map<String, Value>, target: &mut Map<String, Value>, key: &str, max: usize) {
    if let Some(text) = source.get(key).and_then(Value::as_str) {
        target.insert(key.to_string(), Value::String(bound_text(text, max)));
    }
}

fn copy_text_or_string_array(
    source: &Map<String, Value>,
    target: &mut Map<String, Value>,
    key: &str,
    max_items: usize,
    max_chars: usize,
) {
    match source.get(key) {
        Some(Value::String(text)) => {
            target.insert(key.to_string(), Value::String(bound_text(text, max_chars)));
        }
        Some(Value::Array(items)) => {
            target.insert(
                key.to_string(),
                Value::Array(
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .take(max_items)
                        .map(|text| Value::String(bound_text(text, 1_000)))
                        .collect(),
                ),
            );
        }
        _ => {}
    }
}

fn required_text(source: &Map<String, Value>, key: &str, max: usize) -> Result<String, String> {
    let text = source
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| format!("Missing {key}"))?;
    Ok(bound_text(text, max))
}

fn bound_text(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_is_method_specific_and_never_copies_unknown_secrets() {
        let projected = project_server_request(
            "item/commandExecution/requestApproval",
            &json!({ "command": "npm test", "cwd": "/repo", "accessToken": "secret" }),
        )
        .unwrap();
        assert_eq!(projected["command"], "npm test");
        assert!(projected.get("accessToken").is_none());
        assert!(project_server_request(
            "account/chatgptAuthTokens/refresh",
            &json!({ "accessToken": "secret" })
        )
        .is_err());
    }

    #[test]
    fn mcp_url_projection_requires_a_web_url() {
        assert!(project_server_request(
            "mcpServer/elicitation/request",
            &json!({ "mode": "url", "message": "Sign in", "url": "https://example.com/login", "secret": "no" }),
        )
        .is_ok());
        assert!(project_server_request(
            "mcpServer/elicitation/request",
            &json!({ "mode": "url", "message": "Open", "url": "file:///etc/passwd" }),
        )
        .is_err());
    }

    #[test]
    fn modern_permission_profiles_round_trip_without_arbitrary_fields() {
        let permissions = json!({
            "fileSystem": {
                "globScanMaxDepth": 8,
                "entries": [
                    { "access": "read", "path": { "type": "path", "path": "/workspace" }, "secret": "drop" },
                    { "access": "write", "path": { "type": "glob_pattern", "pattern": "/workspace/**" } },
                    { "access": "deny", "path": { "type": "special", "value": { "kind": "tmpdir" } } }
                ]
            },
            "network": { "enabled": true, "unknown": "drop" },
            "unknown": "drop"
        });
        let projected = project_permissions(&permissions).unwrap();
        assert!(projected.get("unknown").is_none());
        assert!(projected["network"].get("unknown").is_none());
        assert!(projected["fileSystem"]["entries"][0]
            .get("secret")
            .is_none());
        assert!(validate_codex_server_result(
            "item/permissions/requestApproval",
            &json!({ "permissions": permissions }),
            json!({ "permissions": projected, "scope": "turn" }),
        )
        .is_ok());
    }

    #[test]
    fn mcp_form_validation_enforces_required_types_ranges_and_enums() {
        let params = json!({
            "mode": "form",
            "message": "Configure",
            "requestedSchema": {
                "type": "object",
                "required": ["region", "retries"],
                "properties": {
                    "region": { "type": "string", "enum": ["us", "eu"] },
                    "retries": { "type": "integer", "minimum": 1, "maximum": 3 },
                    "alerts": { "type": "boolean" },
                    "scopes": { "type": "array", "items": { "type": "string", "enum": ["read", "write"] }, "maxItems": 2 }
                }
            }
        });
        assert!(validate_codex_server_result(
            "mcpServer/elicitation/request",
            &params,
            json!({ "action": "accept", "content": { "region": "us", "retries": 2, "alerts": true, "scopes": ["read"] } }),
        )
        .is_ok());
        assert!(validate_codex_server_result(
            "mcpServer/elicitation/request",
            &params,
            json!({ "action": "accept", "content": { "region": "apac", "retries": 4 } }),
        )
        .is_err());
        assert!(validate_codex_server_result(
            "mcpServer/elicitation/request",
            &params,
            json!({ "action": "accept", "content": { "region": "us" } }),
        )
        .is_err());
    }

    #[test]
    fn pending_requests_have_a_real_wall_deadline() {
        let now = Instant::now();
        assert!(!pending_request_expired(now + Duration::from_secs(1), now));
        assert!(pending_request_expired(now, now));
        assert!(pending_request_expired(now - Duration::from_secs(1), now));
        assert!(MAX_HUMAN_WAIT <= Duration::from_secs(15 * 60));
    }
}
