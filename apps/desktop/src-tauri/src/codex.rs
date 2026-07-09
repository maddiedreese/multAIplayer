use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use crate::process::terminate_child;
use crate::validation::{
    codex_timeout, ensure_codex_input, ensure_room_id, normalize_codex_thread_id,
};
use crate::workspace::ensure_existing_dir;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexProbe {
    available: bool,
    version: Option<String>,
    error: Option<String>,
    models: Vec<CodexModelOption>,
    model_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexModelOption {
    id: String,
    label: String,
    description: String,
    model: String,
    hidden: bool,
    is_default: bool,
    default_reasoning_effort: String,
    supported_reasoning_efforts: Vec<String>,
    service_tiers: Vec<String>,
    default_service_tier: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexTurnResult {
    thread_id: Option<String>,
    status: String,
    transcript: String,
    events: Vec<String>,
    stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexGoal {
    objective: String,
    status: String,
    thread_id: String,
    created_at: i64,
    updated_at: i64,
    time_used_seconds: i64,
    tokens_used: i64,
    token_budget: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexTurnRequest {
    room_id: Option<String>,
    cwd: String,
    input: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    speed: Option<String>,
    sandbox_level: Option<String>,
    previous_thread_id: Option<String>,
    timeout_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexGoalSetRequest {
    room_id: String,
    thread_id: String,
    objective: Option<String>,
    status: Option<String>,
    token_budget: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexGoalThreadRequest {
    room_id: String,
    thread_id: String,
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
    stdin: ChildStdin,
    line_rx: mpsc::Receiver<String>,
    stderr_rx: mpsc::Receiver<String>,
    next_id: i64,
    last_used: Instant,
}

static CODEX_SESSIONS: OnceLock<Mutex<HashMap<CodexServerKey, CodexServerSession>>> =
    OnceLock::new();

const CODEX_SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(20 * 60);

#[tauri::command]
pub(crate) fn probe_codex() -> CodexProbe {
    match Command::new("codex").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let model_result = list_codex_models_once(Duration::from_secs(8));
            CodexProbe {
                available: true,
                version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
                error: None,
                models: model_result.clone().unwrap_or_default(),
                model_error: model_result.err(),
            }
        }
        Ok(output) => CodexProbe {
            available: false,
            version: None,
            error: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
            models: Vec::new(),
            model_error: None,
        },
        Err(error) => CodexProbe {
            available: false,
            version: None,
            error: Some(error.to_string()),
            models: Vec::new(),
            model_error: None,
        },
    }
}

#[tauri::command]
pub(crate) fn run_codex_turn(request: CodexTurnRequest) -> Result<CodexTurnResult, String> {
    ensure_existing_dir(&request.cwd)?;
    ensure_codex_input(&request.input)?;
    let previous_thread_id = normalize_codex_thread_id(request.previous_thread_id.as_deref())?;
    let timeout = codex_timeout(request.timeout_seconds)?;
    let model = request.model.unwrap_or_else(|| "gpt-5.5".to_string());
    let reasoning_effort = normalize_reasoning_effort(request.reasoning_effort.as_deref())?;
    let service_tier = service_tier_for_speed(request.speed.as_deref())?;
    let sandbox_config = codex_sandbox_config(request.sandbox_level.as_deref())?;
    let key = codex_server_key(
        request.room_id.as_deref(),
        &request.cwd,
        &model,
        &reasoning_effort,
        &service_tier,
        &sandbox_config,
    )?;
    let mut session = checkout_codex_session(&key, timeout)?;
    let result = session.run_turn(
        &request.cwd,
        &request.input,
        &model,
        &reasoning_effort,
        &service_tier,
        previous_thread_id.as_deref(),
        timeout,
    );
    if result.as_ref().is_ok_and(CodexTurnResult::is_reusable) && session.is_alive() {
        checkin_codex_session(key, session);
    }
    result
}

#[tauri::command]
pub(crate) fn set_codex_goal(request: CodexGoalSetRequest) -> Result<CodexGoal, String> {
    ensure_room_id(&request.room_id)?;
    let thread_id = normalize_codex_thread_id(Some(&request.thread_id))?
        .ok_or_else(|| "Codex thread id is required before setting a goal.".to_string())?;
    let status = match request.status.as_deref() {
        None
        | Some("active")
        | Some("paused")
        | Some("blocked")
        | Some("usageLimited")
        | Some("budgetLimited")
        | Some("complete") => request.status,
        Some(_) => return Err("Codex goal status is invalid.".to_string()),
    };
    let response = run_codex_goal_request(json!({
        "method": "thread/goal/set",
        "params": {
            "threadId": thread_id,
            "objective": request.objective,
            "status": status,
            "tokenBudget": request.token_budget
        }
    }))?;
    parse_codex_goal_response(&response)
}

#[tauri::command]
pub(crate) fn get_codex_goal(request: CodexGoalThreadRequest) -> Result<Option<CodexGoal>, String> {
    ensure_room_id(&request.room_id)?;
    let thread_id = normalize_codex_thread_id(Some(&request.thread_id))?
        .ok_or_else(|| "Codex thread id is required before reading a goal.".to_string())?;
    let response = run_codex_goal_request(json!({
        "method": "thread/goal/get",
        "params": {
            "threadId": thread_id
        }
    }))?;
    let Some(goal) = response
        .get("result")
        .and_then(|result| result.get("goal"))
        .filter(|goal| !goal.is_null())
    else {
        return Ok(None);
    };
    Ok(Some(parse_codex_goal(goal)?))
}

#[tauri::command]
pub(crate) fn clear_codex_goal(request: CodexGoalThreadRequest) -> Result<(), String> {
    ensure_room_id(&request.room_id)?;
    let thread_id = normalize_codex_thread_id(Some(&request.thread_id))?
        .ok_or_else(|| "Codex thread id is required before clearing a goal.".to_string())?;
    let _response = run_codex_goal_request(json!({
        "method": "thread/goal/clear",
        "params": {
            "threadId": thread_id
        }
    }))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn shutdown_codex_room(request: CodexRoomShutdownRequest) -> Result<usize, String> {
    ensure_room_id(&request.room_id)?;
    Ok(shutdown_codex_room_sessions(&request.room_id))
}

fn run_codex_goal_request(mut request: Value) -> Result<Value, String> {
    let timeout = Duration::from_secs(20);
    let started_at = Instant::now();
    let mut child = Command::new("codex")
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start codex app-server for goal: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open codex app-server stdin for goal".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open codex app-server stdout for goal".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not open codex app-server stderr for goal".to_string())?;

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

    let result = (|| {
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
        )?;
        wait_for_response(&line_rx, 1, started_at, timeout)?;
        send_json(&mut stdin, json!({ "method": "initialized", "params": {} }))?;
        request["id"] = json!(2);
        send_json(&mut stdin, request)?;
        wait_for_response(&line_rx, 2, started_at, timeout)
    })();

    terminate_child(&mut child);
    result.map_err(|error| {
        let stderr = stderr_rx.try_iter().collect::<Vec<_>>().join("\n");
        if stderr.trim().is_empty() {
            error
        } else {
            format!("{error}: {stderr}")
        }
    })
}

fn parse_codex_goal_response(value: &Value) -> Result<CodexGoal, String> {
    let goal = value
        .get("result")
        .and_then(|result| result.get("goal"))
        .ok_or_else(|| format!("Codex goal response did not include a goal: {value}"))?;
    parse_codex_goal(goal)
}

fn parse_codex_goal(value: &Value) -> Result<CodexGoal, String> {
    serde_json::from_value(value.clone())
        .map_err(|error| format!("Codex goal response was invalid: {error}; {value}"))
}

fn normalize_reasoning_effort(value: Option<&str>) -> Result<String, String> {
    let effort = value.unwrap_or("medium").trim();
    match effort {
        "none" | "minimal" | "low" | "medium" | "high" | "xhigh" => Ok(effort.to_string()),
        _ => Err(
            "Codex reasoning effort must be none, minimal, low, medium, high, or xhigh."
                .to_string(),
        ),
    }
}

fn list_codex_models_once(timeout: Duration) -> Result<Vec<CodexModelOption>, String> {
    let started_at = Instant::now();
    let mut child = Command::new("codex")
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start codex app-server for model list: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open codex app-server stdin for model list".to_string())
        .map_err(|error| {
            terminate_child(&mut child);
            error
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open codex app-server stdout for model list".to_string())
        .map_err(|error| {
            terminate_child(&mut child);
            error
        })?;
    let stderr = child.stderr.take();

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
    if let Some(stderr) = stderr {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if stderr_tx.send(line).is_err() {
                    break;
                }
            }
        });
    }

    let result = (|| {
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
        )?;
        wait_for_response(&line_rx, 1, started_at, timeout)?;
        send_json(&mut stdin, json!({ "method": "initialized", "params": {} }))?;
        send_json(
            &mut stdin,
            json!({
                "method": "model/list",
                "id": 2,
                "params": {
                    "includeHidden": false,
                    "limit": 100
                }
            }),
        )?;
        let response = wait_for_response_message(&line_rx, 2, started_at, timeout)?;
        if let Some(error) = response.get("error") {
            return Err(format!("model/list failed: {error}"));
        }
        let models = response
            .get("result")
            .and_then(|result| result.get("data"))
            .and_then(Value::as_array)
            .ok_or_else(|| format!("model/list did not return data: {response}"))?;
        Ok(models.iter().filter_map(parse_codex_model_option).collect())
    })();

    terminate_child(&mut child);
    result.map_err(|error| {
        let stderr = stderr_rx.try_iter().collect::<Vec<_>>().join("\n");
        if stderr.trim().is_empty() {
            error
        } else {
            format!("{error}: {stderr}")
        }
    })
}

fn parse_codex_model_option(value: &Value) -> Option<CodexModelOption> {
    let id = value.get("id")?.as_str()?.trim();
    let label = value
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or(id)
        .trim();
    if id.is_empty() || label.is_empty() {
        return None;
    }
    let model = value
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(id)
        .trim();
    let supported_reasoning_efforts = value
        .get("supportedReasoningEfforts")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("reasoningEffort")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    let service_tiers = value
        .get("serviceTiers")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    Some(CodexModelOption {
        id: id.to_string(),
        label: label.to_string(),
        description: value
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        model: model.to_string(),
        hidden: value
            .get("hidden")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        is_default: value
            .get("isDefault")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        default_reasoning_effort: value
            .get("defaultReasoningEffort")
            .and_then(Value::as_str)
            .unwrap_or("medium")
            .to_string(),
        supported_reasoning_efforts,
        service_tiers,
        default_service_tier: value
            .get("defaultServiceTier")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn service_tier_for_speed(value: Option<&str>) -> Result<String, String> {
    let speed = value.unwrap_or("standard").trim();
    match speed {
        "standard" => Ok("default".to_string()),
        "fast" => Ok("fast".to_string()),
        _ => Err("Codex speed must be standard or fast.".to_string()),
    }
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
    fn start(
        cwd: &str,
        reasoning_effort: &str,
        service_tier: &str,
        sandbox_config: &CodexSandboxConfig,
        timeout: Duration,
    ) -> Result<Self, String> {
        let started_at = Instant::now();
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

        Ok(Self {
            child,
            stdin,
            line_rx,
            stderr_rx,
            next_id: 2,
            last_used: Instant::now(),
        })
    }

    fn run_turn(
        &mut self,
        cwd: &str,
        input: &str,
        model: &str,
        reasoning_effort: &str,
        service_tier: &str,
        previous_thread_id: Option<&str>,
        timeout: Duration,
    ) -> Result<CodexTurnResult, String> {
        let started_at = Instant::now();
        let thread_request_id = self.allocate_id();
        cleanup_on_error(
            &mut self.child,
            send_json(
                &mut self.stdin,
                codex_thread_request(thread_request_id, previous_thread_id, cwd, model),
            ),
        )?;
        let thread_response = cleanup_on_error(
            &mut self.child,
            wait_for_response_message(&self.line_rx, thread_request_id, started_at, timeout),
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
                events.push(format!(
                    "{error}; starting a new thread instead of {previous_thread_id}."
                ));
                let fallback_request_id = self.allocate_id();
                cleanup_on_error(
                    &mut self.child,
                    send_json(
                        &mut self.stdin,
                        codex_thread_start_request(fallback_request_id, cwd, model),
                    ),
                )?;
                let fallback_response = cleanup_on_error(
                    &mut self.child,
                    wait_for_response(&self.line_rx, fallback_request_id, started_at, timeout),
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
            .map_err(|error| {
                terminate_child(&mut self.child);
                error
            })?;
        if previous_thread_id == Some(thread_id.as_str()) {
            events.push(format!("thread/resume: {thread_id}"));
        } else {
            events.push(format!("thread/start: {thread_id}"));
        }

        let turn_request_id = self.allocate_id();
        cleanup_on_error(
            &mut self.child,
            send_json(
                &mut self.stdin,
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

        let status = loop {
            if started_at.elapsed() > timeout {
                break "timeout".to_string();
            }

            match self.line_rx.recv_timeout(Duration::from_millis(500)) {
                Ok(line) => {
                    let parsed: Value = match serde_json::from_str(&line) {
                        Ok(parsed) => parsed,
                        Err(error) => {
                            events.push(format!("Invalid app-server JSON line: {error}"));
                            break "error".to_string();
                        }
                    };
                    if parsed.get("id").and_then(Value::as_i64) == Some(turn_request_id) {
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
        terminate_child(&mut self.child);
    }
}

impl CodexTurnResult {
    fn is_reusable(&self) -> bool {
        !matches!(self.status.as_str(), "timeout" | "disconnected")
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
        &key.cwd,
        &key.reasoning_effort,
        &key.service_tier,
        &CodexSandboxConfig {
            sandbox_mode: key.sandbox_mode.clone(),
            approval_policy: key.approval_policy.clone(),
            network_access: key.network_access,
        },
        timeout,
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

fn cleanup_on_error<T>(child: &mut Child, result: Result<T, String>) -> Result<T, String> {
    if result.is_err() {
        terminate_child(child);
    }
    result
}
