use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexActivityEvent {
    room_id: String,
    activity_id: String,
    turn_id: String,
    item_id: String,
    thread_id: Option<String>,
    kind: String,
    status: String,
    title: String,
    agent: Option<CodexAgentActivity>,
    started_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexAgentActivity {
    action: String,
    sender_id: String,
    receiver_ids: Vec<String>,
}

pub(crate) fn bounded_codex_identifier(value: Option<&str>, fallback: &str) -> String {
    let value = value.unwrap_or(fallback).trim();
    let safe: String = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
        .take(120)
        .collect();
    if safe.is_empty() {
        fallback.to_string()
    } else {
        safe
    }
}

pub(crate) fn project_codex_activity(
    method: &str,
    notification: &Value,
    room_id: &str,
    client_turn_id: &str,
    started_by_item: &mut HashMap<String, String>,
) -> Option<CodexActivityEvent> {
    let lifecycle_status = match method {
        "item/started" => "started",
        "item/updated" => "running",
        "item/completed" => "completed",
        _ => return None,
    };
    let params = notification.get("params")?;
    let item = params.get("item")?;
    let item_id = bounded_codex_identifier(item.get("id").and_then(Value::as_str), "item");
    let item_type = item.get("type").and_then(Value::as_str).unwrap_or("other");
    let (kind, title) = match item_type {
        "commandExecution" => ("command", "Command execution"),
        "fileChange" => ("file_change", "File change"),
        "dynamicToolCall" | "mcpToolCall" => ("tool", "Tool call"),
        "webSearch" => ("web_search", "Web search"),
        "imageGeneration" => ("image_generation", "Image generation"),
        "collabAgentToolCall" | "agentIdentity" => ("agent", "Agent activity"),
        "enteredReviewMode" | "exitedReviewMode" => ("review", "Review activity"),
        "hookPrompt" => ("hook", "Hook prompt"),
        "reasoning" => ("reasoning", "Reasoning"),
        _ => ("other", "Codex activity"),
    };
    let agent = if item_type == "collabAgentToolCall" {
        let action = match item.get("tool").and_then(Value::as_str)? {
            "spawnAgent" => "spawn",
            "sendInput" => "send",
            "resumeAgent" => "resume",
            "wait" => "wait",
            "closeAgent" => "close",
            _ => return None,
        };
        let sender_id =
            bounded_codex_identifier(item.get("senderThreadId").and_then(Value::as_str), "agent");
        let receiver_ids = item
            .get("receiverThreadIds")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|value| bounded_codex_identifier(Some(value), "agent"))
                    .take(16)
                    .collect()
            })
            .unwrap_or_default();
        Some(CodexAgentActivity {
            action: action.to_string(),
            sender_id,
            receiver_ids,
        })
    } else {
        None
    };
    let item_status = item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or(lifecycle_status);
    let status = match item_status {
        "failed" | "error" => "failed",
        "declined" | "denied" | "cancelled" => "declined",
        "completed" => "completed",
        "inProgress" | "running" => "running",
        _ => lifecycle_status,
    };
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let started_at = started_by_item
        .entry(item_id.clone())
        .or_insert_with(|| now.clone())
        .clone();
    Some(CodexActivityEvent {
        room_id: room_id.to_string(),
        activity_id: bounded_codex_identifier(
            Some(&format!("{client_turn_id}-{item_id}")),
            "activity",
        ),
        turn_id: client_turn_id.to_string(),
        item_id,
        thread_id: params
            .get("threadId")
            .and_then(Value::as_str)
            .map(|value| bounded_codex_identifier(Some(value), "thread")),
        kind: kind.to_string(),
        status: status.to_string(),
        title: title.to_string(),
        agent,
        started_at,
        updated_at: now,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn projects_only_bounded_safe_lifecycle_metadata() {
        let raw = json!({"params": {"threadId": "thread-1", "item": {
            "id": "command-1", "type": "commandExecution", "status": "inProgress",
            "command": "echo super-secret", "aggregatedOutput": "token=secret"
        }}});
        let activity = project_codex_activity(
            "item/started",
            &raw,
            "room-1",
            "turn-1",
            &mut HashMap::new(),
        )
        .expect("activity");
        let encoded = serde_json::to_string(&activity).expect("serialize");
        assert!(encoded.contains("Command execution"));
        assert!(!encoded.contains("super-secret"));
        assert!(!encoded.contains("token=secret"));
    }

    #[test]
    fn ignores_token_delta_notifications() {
        assert!(project_codex_activity(
            "item/commandExecution/outputDelta",
            &json!({"params": {"delta": "secret"}}),
            "room-1",
            "turn-1",
            &mut HashMap::new(),
        )
        .is_none());
    }
}
