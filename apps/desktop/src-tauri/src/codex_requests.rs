use crate::codex_request_projection::project_server_request;
use crate::codex_request_validation::validate_codex_server_result;
use crate::codex_rpc::{
    send_json_shared, wait_for_response as wait_for_rpc_response,
    wait_for_response_message as wait_for_rpc_response_message, ActiveTimeout, RpcId, RpcInbox,
    SharedStdin,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

const MAX_RPC_METHOD_CHARS: usize = 256;
const MAX_RPC_PARAMS_BYTES: usize = 256 * 1024;
const MAX_PENDING_REQUESTS_PER_SESSION: usize = 64;
const MAX_HUMAN_WAIT: Duration = Duration::from_secs(15 * 60);
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
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_requests_have_a_real_wall_deadline() {
        let now = Instant::now();
        assert!(!pending_request_expired(now + Duration::from_secs(1), now));
        assert!(pending_request_expired(now, now));
        assert!(pending_request_expired(now - Duration::from_secs(1), now));
        assert!(MAX_HUMAN_WAIT <= Duration::from_secs(15 * 60));
    }
}
