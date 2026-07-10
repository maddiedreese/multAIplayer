use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::codex_account::CodexHostState;
use crate::validation::{ensure_room_id, normalize_codex_thread_id};
use crate::workspace::ensure_existing_dir;

const MAX_THREADS: usize = 160;
const MAX_TITLE_CHARS: usize = 160;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CodexThreadListRequest {
    room_id: String,
    cwd: String,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CodexThreadForkRequest {
    room_id: String,
    thread_id: String,
    last_turn_id: Option<String>,
    cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexThreadNode {
    id: String,
    session_id: Option<String>,
    parent_thread_id: Option<String>,
    title: String,
    status: String,
    created_at: i64,
    updated_at: i64,
}

#[tauri::command]
pub(crate) fn list_codex_threads(
    request: CodexThreadListRequest,
    app: AppHandle,
    state: State<'_, CodexHostState>,
) -> Result<Vec<CodexThreadNode>, String> {
    ensure_room_id(&request.room_id)?;
    ensure_existing_dir(&request.cwd)?;
    let limit = request.limit.unwrap_or(100).clamp(1, MAX_THREADS);
    let result = state.request(
        &app,
        "thread/list",
        json!({
            "limit": limit,
            "cwd": request.cwd,
            "sortKey": "updated_at",
            "sortDirection": "desc"
        }),
    )?;
    let data = result
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "thread/list returned no data".to_string())?;
    Ok(data
        .iter()
        .filter_map(parse_thread_node)
        .take(limit)
        .collect())
}

#[tauri::command]
pub(crate) fn fork_codex_thread(
    request: CodexThreadForkRequest,
    app: AppHandle,
    state: State<'_, CodexHostState>,
) -> Result<CodexThreadNode, String> {
    ensure_room_id(&request.room_id)?;
    let thread_id = normalize_codex_thread_id(Some(&request.thread_id))?
        .ok_or_else(|| "Codex thread id is required".to_string())?;
    let last_turn_id = request
        .last_turn_id
        .as_deref()
        .map(|value| normalize_codex_thread_id(Some(value)))
        .transpose()?
        .flatten();
    if last_turn_id.is_some() && !state.capabilities(&app)?.supports_last_turn_fork {
        return Err("Forking through a specific turn requires Codex 0.143.0 or newer".to_string());
    }
    if let Some(cwd) = request.cwd.as_deref() {
        ensure_existing_dir(cwd)?;
    }
    let params = thread_fork_params(&thread_id, last_turn_id.as_deref(), request.cwd.as_deref());
    let result = state.request(&app, "thread/fork", params)?;
    result
        .get("thread")
        .and_then(parse_thread_node)
        .ok_or_else(|| "thread/fork returned no valid thread".to_string())
}

fn thread_fork_params(thread_id: &str, last_turn_id: Option<&str>, cwd: Option<&str>) -> Value {
    let mut params = serde_json::Map::from_iter([("threadId".to_string(), json!(thread_id))]);
    if let Some(last_turn_id) = last_turn_id {
        params.insert("lastTurnId".to_string(), json!(last_turn_id));
    }
    if let Some(cwd) = cwd {
        params.insert("cwd".to_string(), json!(cwd));
    }
    Value::Object(params)
}

fn parse_thread_node(value: &Value) -> Option<CodexThreadNode> {
    let id = normalize_codex_thread_id(value.get("id").and_then(Value::as_str))
        .ok()
        .flatten()?;
    let session_id = value
        .get("sessionId")
        .and_then(Value::as_str)
        .and_then(|value| normalize_codex_thread_id(Some(value)).ok().flatten());
    let parent_thread_id = value
        .get("forkedFromId")
        .and_then(Value::as_str)
        .and_then(|value| normalize_codex_thread_id(Some(value)).ok().flatten());
    // `preview` may contain prompt content. Only retain an explicit user-facing name.
    let title_source = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Codex thread");
    let title: String = title_source
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_TITLE_CHARS)
        .collect();
    let status = value
        .get("status")
        .and_then(|status| status.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    Some(CodexThreadNode {
        id,
        session_id,
        parent_thread_id,
        title: if title.trim().is_empty() {
            "Codex thread".to_string()
        } else {
            title
        },
        status: match status {
            "notLoaded" | "idle" | "systemError" | "active" => status,
            _ => "unknown",
        }
        .to_string(),
        created_at: value
            .get("createdAt")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        updated_at: value
            .get("updatedAt")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_projection_keeps_graph_metadata_and_bounds_title() {
        let node = parse_thread_node(&json!({
            "id": "thread-child", "sessionId": "session-1", "forkedFromId": "thread-root",
            "name": format!("{}secret", "x".repeat(200)), "preview": "private prompt", "createdAt": 10, "updatedAt": 20,
            "status": { "type": "idle" }, "turns": [{"raw": "not retained"}]
        }))
        .expect("node");
        assert_eq!(node.parent_thread_id.as_deref(), Some("thread-root"));
        assert_eq!(node.title.chars().count(), MAX_TITLE_CHARS);
        assert!(!serde_json::to_string(&node)
            .unwrap()
            .contains("not retained"));
        assert!(!serde_json::to_string(&node)
            .unwrap()
            .contains("private prompt"));
    }

    #[test]
    fn fork_params_include_optional_turn_without_untyped_configuration() {
        assert_eq!(
            thread_fork_params("thread-1", Some("turn-2"), Some("/tmp/project")),
            json!({
                "threadId": "thread-1", "lastTurnId": "turn-2", "cwd": "/tmp/project"
            })
        );
        assert_eq!(
            thread_fork_params("thread-1", None, None),
            json!({ "threadId": "thread-1" })
        );
    }
}
