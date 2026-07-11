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

use crate::codex_activity::{bounded_codex_identifier, project_codex_activity};
use crate::codex_catalog::{normalize_reasoning_effort, normalize_service_tier};
use crate::codex_requests::{
    wait_for_response, wait_for_response_message, CodexRpcState, CodexServerRequestEvent,
    PendingSessionGuard, RespondCodexServerRequest, RpcRequestContext,
};
use crate::codex_rpc::{
    allocate_rpc_session_id, send_json_shared, ActiveTimeout, RpcId, RpcInbox, RpcMessage,
    SharedStdin,
};
use crate::codex_turn_lifecycle::{cancel_codex_turns_for_room, CodexTurnLease};
use crate::process::terminate_child;
use crate::validation::{
    codex_timeout, ensure_codex_input, ensure_room_id, normalize_codex_thread_id,
};
use crate::workspace::ensure_existing_dir;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexTurnResult {
    thread_id: Option<String>,
    status: String,
    transcript: String,
    events: Vec<String>,
    stderr: String,
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
pub(crate) fn run_codex_turn(
    request: CodexTurnRequest,
    app: tauri::AppHandle,
    rpc_state: tauri::State<'_, CodexRpcState>,
) -> Result<CodexTurnResult, String> {
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
    let key = codex_server_key(
        request.room_id.as_deref(),
        &request.cwd,
        &model,
        &reasoning_effort,
        &service_tier,
        &sandbox_config,
    )?;
    if turn_lease.is_cancelled() {
        return Err("Codex turn was cancelled because the room host context changed".to_string());
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
        &request.cwd,
        &request.input,
        &model,
        &reasoning_effort,
        &service_tier,
        previous_thread_id.as_deref(),
        &client_turn_id,
        timeout,
        cancellation,
    );
    if result.as_ref().is_ok_and(CodexTurnResult::is_reusable) && session.is_alive() {
        let mut checked_out = Some(session);
        turn_lease.run_if_active(|| {
            checkin_codex_session(key, checked_out.take().expect("checked-out Codex session"));
        });
    }
    result
}

#[tauri::command]
pub(crate) fn shutdown_codex_room(
    request: CodexRoomShutdownRequest,
    rpc_state: tauri::State<'_, CodexRpcState>,
) -> Result<usize, String> {
    ensure_room_id(&request.room_id)?;
    rpc_state.cancel_room(&request.room_id, "Codex room shut down");
    let active = cancel_codex_turns_for_room(&request.room_id);
    Ok(active.saturating_add(shutdown_codex_room_sessions(&request.room_id)))
}

#[tauri::command]
pub(crate) fn list_codex_server_requests(
    rpc_state: tauri::State<'_, CodexRpcState>,
) -> Result<Vec<CodexServerRequestEvent>, String> {
    rpc_state.list()
}

#[tauri::command]
pub(crate) fn respond_codex_server_request(
    request: RespondCodexServerRequest,
    rpc_state: tauri::State<'_, CodexRpcState>,
) -> Result<(), String> {
    rpc_state.respond(request)
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

impl CodexServerSession {
    #[allow(clippy::too_many_arguments)]
    fn start(
        app: &tauri::AppHandle,
        rpc_state: CodexRpcState,
        room_id: &str,
        cwd: &str,
        reasoning_effort: &str,
        service_tier: &str,
        sandbox_config: &CodexSandboxConfig,
        timeout: Duration,
        cancelled: Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<Self, String> {
        let mut child = Command::new("codex")
            .arg("-c")
            .arg(format!("model_reasoning_effort=\"{reasoning_effort}\""))
            .arg("-c")
            .arg(format!("service_tier=\"{service_tier}\""))
            .arg("-c")
            .arg(format!("sandbox_mode=\"{}\"", sandbox_config.sandbox_mode))
            .arg("-c")
            .arg(format!(
                "approval_policy=\"{}\"",
                sandbox_config.approval_policy
            ))
            .arg("-c")
            .arg(format!(
                "sandbox_workspace_write.network_access={}",
                sandbox_config.network_access
            ))
            .arg("app-server")
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start codex app-server: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .map(|stdin| Arc::new(Mutex::new(stdin)))
            .ok_or_else(|| "Could not open codex app-server stdin".to_string())
            .inspect_err(|_| {
                terminate_child(&mut child);
            })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Could not open codex app-server stdout".to_string())
            .inspect_err(|_| {
                terminate_child(&mut child);
            })?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Could not open codex app-server stderr".to_string())
            .inspect_err(|_| {
                terminate_child(&mut child);
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

        let session_id = allocate_rpc_session_id();
        let mut inbox = RpcInbox::new(line_rx);
        let mut budget = ActiveTimeout::new(timeout);
        let context = RpcRequestContext {
            app,
            state: rpc_state.clone(),
            room_id,
            session_id,
            stdin: stdin.clone(),
            cancelled: Some(cancelled),
        };
        let mut pending_guard = PendingSessionGuard::new(rpc_state.clone(), session_id);
        cleanup_on_error(
            &mut child,
            send_json_shared(
                &stdin,
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
            wait_for_response(&mut inbox, RpcId::Number(1.into()), &mut budget, &context),
        )?;
        cleanup_on_error(
            &mut child,
            send_json_shared(&stdin, json!({ "method": "initialized", "params": {} })),
        )?;
        pending_guard.disarm();

        Ok(Self {
            child,
            stdin,
            inbox,
            stderr_rx,
            next_id: 2,
            last_used: Instant::now(),
            session_id,
            rpc_state,
            app: app.clone(),
            room_id: room_id.to_string(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn run_turn(
        &mut self,
        cwd: &str,
        input: &str,
        model: &str,
        reasoning_effort: &str,
        service_tier: &str,
        previous_thread_id: Option<&str>,
        client_turn_id: &str,
        timeout: Duration,
        cancelled: Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<CodexTurnResult, String> {
        let mut budget = ActiveTimeout::new(timeout);
        let stdin = self.stdin.clone();
        let app = self.app.clone();
        let rpc_state = self.rpc_state.clone();
        let room_id = self.room_id.clone();
        let context = RpcRequestContext {
            app: &app,
            state: rpc_state,
            room_id: &room_id,
            session_id: self.session_id,
            stdin,
            cancelled: Some(cancelled.clone()),
        };
        let thread_request_id = self.allocate_id();
        cleanup_on_error(
            &mut self.child,
            send_json_shared(
                &self.stdin,
                codex_thread_request(thread_request_id, previous_thread_id, cwd, model),
            ),
        )?;
        let thread_response = cleanup_on_error(
            &mut self.child,
            wait_for_response_message(
                &mut self.inbox,
                RpcId::Number(thread_request_id.into()),
                &mut budget,
                &context,
            ),
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
                let Some(previous_thread_id) = previous_thread_id else {
                    return Err(error);
                };
                let _ = error;
                events.push(format!(
                    "thread/resume failed; starting a new thread instead of {previous_thread_id}."
                ));
                let fallback_request_id = self.allocate_id();
                cleanup_on_error(
                    &mut self.child,
                    send_json_shared(
                        &self.stdin,
                        codex_thread_start_request(fallback_request_id, cwd, model),
                    ),
                )?;
                let fallback_response = cleanup_on_error(
                    &mut self.child,
                    wait_for_response(
                        &mut self.inbox,
                        RpcId::Number(fallback_request_id.into()),
                        &mut budget,
                        &context,
                    ),
                )?;
                fallback_response
                    .get("result")
                    .and_then(|result| result.get("thread"))
                    .and_then(|thread| thread.get("id"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .ok_or_else(|| {
                        format!(
                            "thread/start fallback did not return a thread id: {fallback_response}"
                        )
                    })
            })
            .inspect_err(|_| {
                terminate_child(&mut self.child);
            })?;
        if previous_thread_id == Some(thread_id.as_str()) {
            events.push(format!("thread/resume: {thread_id}"));
        } else {
            events.push(format!("thread/start: {thread_id}"));
        }

        let turn_request_id = self.allocate_id();
        cleanup_on_error(
            &mut self.child,
            send_json_shared(
                &self.stdin,
                json!({
                    "method": "turn/start",
                    "id": turn_request_id,
                    "params": {
                        "threadId": thread_id,
                        "input": [{ "type": "text", "text": input }],
                        "cwd": cwd,
                        "model": model,
                        "modelReasoningEffort": reasoning_effort,
                        "serviceTier": service_tier
                    }
                }),
            ),
        )?;

        let mut transcript = String::new();
        let mut activity_started_at = HashMap::<String, String>::new();

        let status = loop {
            if cancelled.load(Ordering::Acquire) {
                break "cancelled".to_string();
            }
            if budget.expired(self.rpc_state.has_pending_session(self.session_id)) {
                break "timeout".to_string();
            }

            let message = self
                .inbox
                .deferred
                .pop_front()
                .map(Ok)
                .unwrap_or_else(|| self.inbox.receive(Duration::from_millis(500)));
            match message {
                Ok(RpcMessage::Response { id, value: parsed }) => {
                    if id == RpcId::Number(turn_request_id.into()) {
                        events.push("turn/start acknowledged".to_string());
                        if parsed.get("error").is_some() {
                            events.push("turn/start failed".to_string());
                            break "error".to_string();
                        }
                    }
                }
                Ok(RpcMessage::ServerRequest { id, method, params }) => {
                    if let Err(error) =
                        self.rpc_state
                            .register(&context, id, method.clone(), params)
                    {
                        events.push(format!("{method}: request handling failed: {error}"));
                        break "error".to_string();
                    }
                    events.push(method);
                }
                Ok(RpcMessage::Notification {
                    method,
                    value: parsed,
                }) => {
                    if let Some(activity) = project_codex_activity(
                        &method,
                        &parsed,
                        &room_id,
                        client_turn_id,
                        &mut activity_started_at,
                    ) {
                        let _ = self.app.emit("codex://activity", activity);
                    }
                    if method == "serverRequest/resolved" {
                        if let Some(id) = parsed
                            .get("params")
                            .and_then(|params| params.get("requestId"))
                            .and_then(RpcId::from_value)
                        {
                            if let Some(event) =
                                self.rpc_state.remove_resolved(self.session_id, &id)
                            {
                                let _ = self.app.emit("codex://server-request-resolved", event);
                            }
                        }
                    }
                    if method.contains("agentMessage") || method.contains("message") {
                        if let Some(delta) = extract_text_delta(&parsed) {
                            transcript.push_str(&delta);
                        }
                    }

                    events.push(method.clone());

                    if method == "turn/completed" {
                        break parsed
                            .get("params")
                            .and_then(|params| params.get("turn"))
                            .and_then(|turn| turn.get("status"))
                            .and_then(Value::as_str)
                            .unwrap_or("completed")
                            .to_string();
                    }
                }
                Err(error) if error == "timeout" => continue,
                Err(error) => {
                    events.push(error);
                    break "disconnected".to_string();
                }
            }
        };

        self.rpc_state.cancel_session(
            self.session_id,
            "Codex turn ended before the request was answered",
        );

        self.last_used = Instant::now();
        let stderr = self.stderr_rx.try_iter().collect::<Vec<_>>().join("\n");

        Ok(CodexTurnResult {
            thread_id: Some(std::mem::take(&mut thread_id)),
            status,
            transcript,
            events,
            stderr,
        })
    }

    fn allocate_id(&mut self) -> i64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
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
