use crate::codex_requests::{wait_for_response, CodexRpcState, RpcRequestContext};
use crate::codex_rpc::{allocate_rpc_session_id, send_json_shared, ActiveTimeout, RpcId, RpcInbox};
use crate::process::terminate_child;
use crate::validation::{ensure_room_id, normalize_codex_thread_id};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

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

#[tauri::command]
pub(crate) fn set_codex_goal(
    request: CodexGoalSetRequest,
    app: tauri::AppHandle,
    rpc_state: tauri::State<'_, CodexRpcState>,
) -> crate::command_error::CommandResult<CodexGoal> {
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
        Some(_) => return Err("Codex goal status is invalid.".into()),
    };
    let room_id = request.room_id.clone();
    let response = run_codex_goal_request(
        json!({
            "method": "thread/goal/set",
            "params": {
                "threadId": thread_id,
                "objective": request.objective,
                "status": status,
                "tokenBudget": request.token_budget
            }
        }),
        (&app, rpc_state.inner().clone(), room_id),
    )?;
    Ok(parse_codex_goal_response(&response)?)
}

#[tauri::command]
pub(crate) fn get_codex_goal(
    request: CodexGoalThreadRequest,
    app: tauri::AppHandle,
    rpc_state: tauri::State<'_, CodexRpcState>,
) -> crate::command_error::CommandResult<Option<CodexGoal>> {
    ensure_room_id(&request.room_id)?;
    let thread_id = normalize_codex_thread_id(Some(&request.thread_id))?
        .ok_or_else(|| "Codex thread id is required before reading a goal.".to_string())?;
    let room_id = request.room_id.clone();
    let response = run_codex_goal_request(
        json!({
            "method": "thread/goal/get",
            "params": {
                "threadId": thread_id
            }
        }),
        (&app, rpc_state.inner().clone(), room_id),
    )?;
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
pub(crate) fn clear_codex_goal(
    request: CodexGoalThreadRequest,
    app: tauri::AppHandle,
    rpc_state: tauri::State<'_, CodexRpcState>,
) -> crate::command_error::CommandResult<()> {
    ensure_room_id(&request.room_id)?;
    let thread_id = normalize_codex_thread_id(Some(&request.thread_id))?
        .ok_or_else(|| "Codex thread id is required before clearing a goal.".to_string())?;
    let room_id = request.room_id.clone();
    let _response = run_codex_goal_request(
        json!({
            "method": "thread/goal/clear",
            "params": {
                "threadId": thread_id
            }
        }),
        (&app, rpc_state.inner().clone(), room_id),
    )?;
    Ok(())
}

fn run_codex_goal_request(
    mut request: Value,
    context: (&tauri::AppHandle, CodexRpcState, String),
) -> Result<Value, String> {
    let timeout = Duration::from_secs(20);
    let mut child = Command::new("codex")
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start codex app-server for goal: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .map(|stdin| Arc::new(Mutex::new(stdin)))
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

    let session_id = allocate_rpc_session_id();
    let mut inbox = RpcInbox::new(line_rx);
    let mut budget = ActiveTimeout::new(timeout);
    let result = (|| {
        let (app, state, room_id) = &context;
        let rpc_context = RpcRequestContext {
            app,
            state: state.clone(),
            room_id,
            session_id,
            stdin: stdin.clone(),
            cancelled: None,
            proposed_by: None,
            context_summary: None,
        };
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
        )?;
        wait_for_response(
            &mut inbox,
            RpcId::Number(1.into()),
            &mut budget,
            &rpc_context,
        )?;
        send_json_shared(&stdin, json!({ "method": "initialized", "params": {} }))?;
        request["id"] = json!(2);
        send_json_shared(&stdin, request)?;
        wait_for_response(
            &mut inbox,
            RpcId::Number(2.into()),
            &mut budget,
            &rpc_context,
        )
    })();

    context
        .1
        .cancel_session(session_id, "Codex goal session ended");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn goal_response_parsing_preserves_usage_and_budget() {
        let goal = parse_codex_goal_response(&json!({
            "result": {
                "goal": {
                    "objective": "Ship it",
                    "status": "active",
                    "threadId": "thread-1",
                    "createdAt": 1,
                    "updatedAt": 2,
                    "timeUsedSeconds": 3,
                    "tokensUsed": 4,
                    "tokenBudget": 100
                }
            }
        }))
        .expect("goal");
        assert_eq!(goal.objective, "Ship it");
        assert_eq!(goal.tokens_used, 4);
        assert_eq!(goal.token_budget, Some(100));
    }

    #[test]
    fn goal_response_requires_a_goal_object() {
        assert!(parse_codex_goal_response(&json!({ "result": {} })).is_err());
        assert!(parse_codex_goal(&json!({ "objective": "incomplete" })).is_err());
    }
}
