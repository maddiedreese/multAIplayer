use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::codex_authorization::{
    CodexAuthorizationState, CodexConfirmationBinding, ProjectRootAuthorization,
};
use crate::codex_catalog::{normalize_reasoning_effort, normalize_service_tier};
use crate::codex_requests::{
    wait_for_response, wait_for_response_message, CodexRpcState, CodexServerRequestEvent,
    PendingSessionGuard, RespondCodexServerRequest, RpcRequestContext,
};
use crate::codex_rpc::{
    allocate_rpc_session_id, send_json_shared, ActiveTimeout, RpcId, RpcInbox, RpcMessage,
    SharedStdin,
};
use crate::codex_steering::{
    new_codex_steering_responses, register_active_codex_turn, route_codex_steer_response,
};
use crate::codex_turn_lifecycle::{cancel_codex_turns_for_room, CodexTurnLease};
use crate::process::terminate_child;
use crate::validation::{
    codex_timeout, ensure_codex_input, ensure_room_id, normalize_codex_thread_id,
};
use crate::workspace::ensure_existing_dir;
use codex_activity_projection::{bounded_codex_identifier, project_codex_activity};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexTurnResult {
    thread_id: Option<String>,
    status: String,
    transcript: String,
    events: Vec<String>,
    stderr: String,
    generated_images: Vec<CodexGeneratedImage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexGeneratedImage {
    data: String,
    mime_type: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexTurnRequest {
    room_id: Option<String>,
    client_turn_id: Option<String>,
    cwd: String,
    input: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    speed: Option<String>,
    service_tier: Option<String>,
    sandbox_level: Option<String>,
    previous_thread_id: Option<String>,
    timeout_seconds: Option<u64>,
    proposed_by: Option<String>,
    context_summary: Option<String>,
    #[serde(default)]
    share_raw_reasoning: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRoomShutdownRequest {
    room_id: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub(crate) struct CodexServerKey {
    room_id: String,
    cwd: String,
    model: String,
    reasoning_effort: String,
    service_tier: String,
    sandbox_mode: String,
    approval_policy: String,
    network_access: bool,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct CodexSandboxConfig {
    sandbox_mode: String,
    approval_policy: String,
    network_access: bool,
}

struct CodexServerSession {
    child: Child,
    stdin: SharedStdin,
    inbox: RpcInbox,
    stderr_rx: mpsc::Receiver<String>,
    next_id: i64,
    last_used: Instant,
    session_id: u64,
    rpc_state: CodexRpcState,
    app: tauri::AppHandle,
    room_id: String,
}

static CODEX_SESSIONS: OnceLock<Mutex<HashMap<CodexServerKey, CodexServerSession>>> =
    OnceLock::new();
const CODEX_SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(20 * 60);

#[tauri::command]
pub(crate) async fn run_codex_turn(
    request: CodexTurnRequest,
    app: tauri::AppHandle,
    rpc_state: tauri::State<'_, CodexRpcState>,
    authorization_state: tauri::State<'_, CodexAuthorizationState>,
) -> crate::command_error::CommandResult<CodexTurnResult> {
    let lifecycle_room_id = request.room_id.as_deref().unwrap_or("__legacy_room");
    ensure_room_id(lifecycle_room_id)?;
    let turn_lease = CodexTurnLease::begin(lifecycle_room_id)?;
    ensure_existing_dir(&request.cwd)?;
    ensure_codex_input(&request.input)?;
    let previous_thread_id = normalize_codex_thread_id(request.previous_thread_id.as_deref())?;
    let timeout = codex_timeout(request.timeout_seconds)?;
    // Keep this native fallback aligned with @multaiplayer/protocol's defaultCodexModel.
    let model = request.model.unwrap_or_else(|| "gpt-5.6-sol".to_string());
    let reasoning_effort = normalize_reasoning_effort(request.reasoning_effort.as_deref())?;
    let service_tier =
        normalize_service_tier(request.service_tier.as_deref(), request.speed.as_deref())?;
    let sandbox_config = codex_sandbox_config(request.sandbox_level.as_deref())?;
    let canonical_cwd = match authorization_state.classify_project_root(
        lifecycle_room_id,
        &request.cwd,
        &sandbox_config.sandbox_mode,
        sandbox_config.network_access,
    )? {
        ProjectRootAuthorization::AlreadyAuthorized(root) => root,
        ProjectRootAuthorization::RequiresConfirmation(root) => {
            let binding = CodexConfirmationBinding::ProjectRoot {
                room_id: lifecycle_room_id.to_string(),
                canonical_root: root.clone(),
                sandbox_mode: sandbox_config.sandbox_mode.clone(),
                network_access: sandbox_config.network_access,
            };
            authorization_state.begin_confirmation(binding.clone())?;
            let app_for_dialog = app.clone();
            let room_for_dialog = lifecycle_room_id.to_string();
            let root_for_dialog = root.to_string_lossy().to_string();
            let sandbox_for_dialog = sandbox_config.sandbox_mode.clone();
            let network_for_dialog = sandbox_config.network_access;
            let dialog_result = tauri::async_runtime::spawn_blocking(move || {
                app_for_dialog
                    .dialog()
                    .message(format!(
                        "Room: {room_for_dialog}\n\nCanonical project root:\n{root_for_dialog}\n\nSandbox: {sandbox_for_dialog}\nNetwork access: {network_for_dialog}\n\nAllow Codex to use this project root and execution profile for this room? Changing either or shutting down the room requires confirmation again."
                    ))
                    .title("Allow Codex project access?")
                    .kind(MessageDialogKind::Warning)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Allow project".to_string(),
                        "Cancel".to_string(),
                    ))
                    .blocking_show()
            })
            .await;
            authorization_state.finish_confirmation(&binding)?;
            let approved = dialog_result
                .map_err(|error| format!("Native Codex project confirmation failed: {error}"))?;
            if !approved {
                return Err(crate::command_error::CommandError::unauthorized(
                    "Codex project access was denied in the native confirmation dialog",
                ));
            }
            let canonical = authorization_state.authorize_project_root(
                lifecycle_room_id,
                &root,
                &sandbox_config.sandbox_mode,
                sandbox_config.network_access,
            )?;
            // A changed root invalidates any dormant app-server process and its
            // pending approvals before a process can start under the new grant.
            rpc_state.cancel_room(
                lifecycle_room_id,
                "Codex project-root authorization changed",
            );
            shutdown_codex_room_sessions(lifecycle_room_id);
            canonical
        }
    };
    let canonical_cwd = canonical_cwd
        .into_os_string()
        .into_string()
        .map_err(|_| "Codex project root must be valid UTF-8".to_string())?;
    let key = codex_server_key(
        request.room_id.as_deref(),
        &canonical_cwd,
        &model,
        &reasoning_effort,
        &service_tier,
        &sandbox_config,
    )?;
    if turn_lease.is_cancelled() {
        return Err("Codex turn was cancelled because the room host context changed".into());
    }
    let cancellation = turn_lease.cancellation_flag();
    let mut session = checkout_codex_session(
        &key,
        timeout,
        &app,
        rpc_state.inner().clone(),
        cancellation.clone(),
    )?;
    let client_turn_id = bounded_codex_identifier(request.client_turn_id.as_deref(), "turn");
    let result = session.run_turn(
        &canonical_cwd,
        &request.input,
        &model,
        &reasoning_effort,
        &service_tier,
        previous_thread_id.as_deref(),
        &client_turn_id,
        timeout,
        cancellation,
        request.proposed_by.as_deref(),
        request.context_summary.as_deref(),
        request.share_raw_reasoning,
    );
    if result.as_ref().is_ok_and(CodexTurnResult::is_reusable) && session.is_alive() {
        let mut checked_out = Some(session);
        turn_lease.run_if_active(|| {
            // `run_if_active` invokes this closure at most once. Keep that
            // invariant non-panicking anyway: if ownership has already moved,
            // dropping through is safer than taking down the Tauri command.
            if let Some(session) = checked_out.take() {
                checkin_codex_session(key, session);
            }
        });
    }
    Ok(result?)
}

#[tauri::command]
pub(crate) fn shutdown_codex_room(
    request: CodexRoomShutdownRequest,
    rpc_state: tauri::State<'_, CodexRpcState>,
    authorization_state: tauri::State<'_, CodexAuthorizationState>,
) -> crate::command_error::CommandResult<usize> {
    ensure_room_id(&request.room_id)?;
    rpc_state.cancel_room(&request.room_id, "Codex room shut down");
    authorization_state.revoke_project_root(&request.room_id)?;
    let active = cancel_codex_turns_for_room(&request.room_id);
    Ok(active.saturating_add(shutdown_codex_room_sessions(&request.room_id)))
}

#[tauri::command]
pub(crate) fn list_codex_server_requests(
    rpc_state: tauri::State<'_, CodexRpcState>,
) -> crate::command_error::CommandResult<Vec<CodexServerRequestEvent>> {
    Ok(rpc_state.list()?)
}

#[tauri::command]
pub(crate) async fn respond_codex_server_request(
    request: RespondCodexServerRequest,
    app: tauri::AppHandle,
    rpc_state: tauri::State<'_, CodexRpcState>,
    authorization_state: tauri::State<'_, CodexAuthorizationState>,
) -> crate::command_error::CommandResult<()> {
    let prepared = rpc_state.prepare_response(request)?;
    if let (Some(binding), Some(message)) = (
        prepared.confirmation.clone(),
        prepared.confirmation_message.clone(),
    ) {
        authorization_state.begin_confirmation(binding.clone())?;
        let dialog_result = tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .message(message)
                .title("Approve Codex native authority?")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Approve request".to_string(),
                    "Cancel".to_string(),
                ))
                .blocking_show()
        })
        .await;
        authorization_state.finish_confirmation(&binding)?;
        let approved = dialog_result
            .map_err(|error| format!("Native Codex request confirmation failed: {error}"))?;
        if !approved {
            return Err(crate::command_error::CommandError::unauthorized(
                "Codex request was not approved in the native confirmation dialog",
            ));
        }
    }
    Ok(rpc_state.finish_response(prepared)?)
}

pub(crate) fn codex_sandbox_config(value: Option<&str>) -> Result<CodexSandboxConfig, String> {
    let level = value.unwrap_or("workspace_write").trim();
    match level {
        "read_only" => Ok(CodexSandboxConfig {
            sandbox_mode: "read-only".to_string(),
            approval_policy: "on-request".to_string(),
            network_access: false,
        }),
        "workspace_write" => Ok(CodexSandboxConfig {
            sandbox_mode: "workspace-write".to_string(),
            approval_policy: "on-request".to_string(),
            network_access: false,
        }),
        "workspace_write_network" => Ok(CodexSandboxConfig {
            sandbox_mode: "workspace-write".to_string(),
            approval_policy: "on-request".to_string(),
            network_access: true,
        }),
        "danger_full_access" => Ok(CodexSandboxConfig {
            sandbox_mode: "danger-full-access".to_string(),
            approval_policy: "on-request".to_string(),
            network_access: true,
        }),
        _ => Err("Codex sandbox level must be read_only, workspace_write, workspace_write_network, or danger_full_access.".to_string()),
    }
}

mod session;
fn project_generated_image(notification: &Value) -> Option<CodexGeneratedImage> {
    // Keep the IPC result within the relay's default 5 MB encrypted-blob budget.
    const MAX_IMAGE_DATA_CHARS: usize = 5_000_000;
    let item = notification.get("params")?.get("item")?;
    if item.get("type")?.as_str()? != "imageGeneration" {
        return None;
    }
    let result = item.get("result")?.as_str()?.trim();
    if result.is_empty() || result.len() > MAX_IMAGE_DATA_CHARS {
        return None;
    }

    let (data, mime_type, extension) = if result.starts_with("data:") {
        let (metadata, encoded) = result.split_once(',')?;
        let mime_type = metadata.strip_prefix("data:")?.strip_suffix(";base64")?;
        let extension = supported_image_extension(mime_type)?;
        if !is_base64_payload(encoded) {
            return None;
        }
        (result.to_string(), mime_type.to_string(), extension)
    } else {
        if !is_base64_payload(result) {
            return None;
        }
        (
            format!("data:image/png;base64,{result}"),
            "image/png".to_string(),
            "png",
        )
    };
    let id = bounded_codex_identifier(item.get("id").and_then(Value::as_str), "generated-image");
    Some(CodexGeneratedImage {
        data,
        mime_type,
        name: format!("{id}.{extension}"),
        prompt: item
            .get("revisedPrompt")
            .and_then(Value::as_str)
            .map(|value| value.chars().take(120_000).collect()),
    })
}

fn supported_image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn is_base64_payload(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
}

impl Drop for CodexServerSession {
    fn drop(&mut self) {
        self.rpc_state
            .cancel_session(self.session_id, "Codex app-server session ended");
        terminate_child(&mut self.child);
    }
}

impl CodexTurnResult {
    fn is_reusable(&self) -> bool {
        !matches!(
            self.status.as_str(),
            "timeout" | "disconnected" | "cancelled"
        )
    }
}

pub(crate) fn codex_server_key(
    room_id: Option<&str>,
    cwd: &str,
    model: &str,
    reasoning_effort: &str,
    service_tier: &str,
    sandbox_config: &CodexSandboxConfig,
) -> Result<CodexServerKey, String> {
    let room_id = room_id.unwrap_or("__legacy_room");
    ensure_room_id(room_id)?;
    Ok(CodexServerKey {
        room_id: room_id.to_string(),
        cwd: cwd.to_string(),
        model: model.to_string(),
        reasoning_effort: reasoning_effort.to_string(),
        service_tier: service_tier.to_string(),
        sandbox_mode: sandbox_config.sandbox_mode.clone(),
        approval_policy: sandbox_config.approval_policy.clone(),
        network_access: sandbox_config.network_access,
    })
}

fn codex_sessions() -> &'static Mutex<HashMap<CodexServerKey, CodexServerSession>> {
    CODEX_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn checkout_codex_session(
    key: &CodexServerKey,
    timeout: Duration,
    app: &tauri::AppHandle,
    rpc_state: CodexRpcState,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
) -> Result<CodexServerSession, String> {
    prune_idle_codex_sessions();
    if let Some(mut session) = codex_sessions()
        .lock()
        .map_err(|_| "Codex session cache is unavailable".to_string())?
        .remove(key)
    {
        if session.is_alive() {
            return Ok(session);
        }
    }
    CodexServerSession::start(
        app,
        rpc_state,
        &key.room_id,
        &key.cwd,
        &key.reasoning_effort,
        &key.service_tier,
        &CodexSandboxConfig {
            sandbox_mode: key.sandbox_mode.clone(),
            approval_policy: key.approval_policy.clone(),
            network_access: key.network_access,
        },
        timeout,
        cancelled,
    )
}

fn checkin_codex_session(key: CodexServerKey, session: CodexServerSession) {
    if let Ok(mut sessions) = codex_sessions().lock() {
        sessions.insert(key, session);
    }
}

fn prune_idle_codex_sessions() {
    let Ok(mut sessions) = codex_sessions().lock() else {
        return;
    };
    let now = Instant::now();
    sessions
        .retain(|_, session| now.duration_since(session.last_used) < CODEX_SESSION_IDLE_TIMEOUT);
}

pub(crate) fn should_shutdown_codex_session_for_room(key: &CodexServerKey, room_id: &str) -> bool {
    key.room_id == room_id
}

fn shutdown_codex_room_sessions(room_id: &str) -> usize {
    let Ok(mut sessions) = codex_sessions().lock() else {
        return 0;
    };
    let before = sessions.len();
    sessions.retain(|key, _| !should_shutdown_codex_session_for_room(key, room_id));
    before.saturating_sub(sessions.len())
}

pub(crate) fn codex_thread_request(
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

fn cleanup_on_error<T>(child: &mut Child, result: Result<T, String>) -> Result<T, String> {
    if result.is_err() {
        terminate_child(child);
    }
    result
}

#[cfg(test)]
mod generated_image_tests {
    use super::*;

    #[test]
    fn projects_completed_image_data_without_saved_path() {
        let notification = json!({"params":{"item":{
            "id":"image-1",
            "type":"imageGeneration",
            "status":"completed",
            "revisedPrompt":"A lighthouse at dusk",
            "result":"iVBORw0KGgo=",
            "savedPath":"/Users/private/result.png"
        }}});
        let image = project_generated_image(&notification).expect("generated image");
        let encoded = serde_json::to_string(&image).expect("serialize");
        assert!(encoded.contains("data:image/png;base64,iVBORw0KGgo="));
        assert!(encoded.contains("image-1.png"));
        assert!(encoded.contains("A lighthouse at dusk"));
        assert!(!encoded.contains("/Users/private"));
    }

    #[test]
    fn accepts_only_bounded_supported_image_data() {
        let unsupported = json!({"params":{"item":{
            "id":"image-1", "type":"imageGeneration",
            "result":"data:image/svg+xml;base64,PHN2Zz4="
        }}});
        let path_only = json!({"params":{"item":{
            "id":"image-2", "type":"imageGeneration", "savedPath":"/tmp/image.png"
        }}});
        assert!(project_generated_image(&unsupported).is_none());
        assert!(project_generated_image(&path_only).is_none());
    }
}
