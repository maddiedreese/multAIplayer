//! Bounded projection of untrusted Codex app-server activity.

pub mod host;

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexActivityEvent {
    room_id: String,
    activity_id: String,
    turn_id: String,
    item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread_id: Option<String>,
    kind: String,
    status: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<CodexActivityDetails>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent: Option<CodexAgentActivity>,
    started_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum CodexActivityDetails {
    Reasoning {
        summaries: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        raw_content: Option<Vec<String>>,
    },
    Command {
        command: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    FileChange {
        changes: Vec<CodexFileChange>,
    },
    Tool {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        server: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        arguments: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    WebSearch {
        #[serde(skip_serializing_if = "Option::is_none")]
        action: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        query: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pattern: Option<String>,
    },
    ImageGeneration {
        #[serde(skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
    },
    Agent {
        #[serde(skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning_effort: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        states: Option<Vec<CodexAgentState>>,
    },
}

#[derive(Debug, Clone, Serialize)]
struct CodexFileChange {
    path: String,
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    diff: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexAgentState {
    thread_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexAgentActivity {
    action: String,
    sender_id: String,
    receiver_ids: Vec<String>,
}

pub fn bounded_codex_identifier(value: Option<&str>, fallback: &str) -> String {
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

pub fn project_codex_activity(
    method: &str,
    notification: &Value,
    room_id: &str,
    client_turn_id: &str,
    started_by_item: &mut HashMap<String, String>,
    share_raw_reasoning: bool,
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
    let details = project_activity_details(item_type, item, share_raw_reasoning);
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
        details,
        agent,
        started_at,
        updated_at: now,
    })
}

fn project_activity_details(
    item_type: &str,
    item: &Value,
    share_raw_reasoning: bool,
) -> Option<CodexActivityDetails> {
    match item_type {
        "reasoning" => {
            let summaries = item
                .get("summary")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|value| reasoning_text(value, &["summary_text"]))
                .take(12)
                .collect::<Vec<_>>();
            let raw_content = share_raw_reasoning.then(|| {
                item.get("content")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|value| reasoning_text(value, &["reasoning_text", "text"]))
                    .take(12)
                    .collect::<Vec<_>>()
            });
            let raw_content = raw_content.filter(|content| !content.is_empty());
            (!summaries.is_empty() || raw_content.is_some()).then_some(
                CodexActivityDetails::Reasoning {
                    summaries,
                    raw_content,
                },
            )
        }
        "commandExecution" => Some(CodexActivityDetails::Command {
            command: bounded_nonempty(item.get("command")?.as_str()?, 120_000)?,
            output: item
                .get("aggregatedOutput")
                .and_then(Value::as_str)
                .map(|value| bounded_text(value, 120_000)),
            exit_code: item.get("exitCode").and_then(Value::as_i64),
            duration_ms: item.get("durationMs").and_then(Value::as_u64),
        }),
        "fileChange" => {
            let changes = item
                .get("changes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|change| {
                    let action = match change.get("kind").and_then(Value::as_str)? {
                        "add" => "add",
                        "delete" => "delete",
                        "update" => "update",
                        _ => return None,
                    };
                    Some(CodexFileChange {
                        path: bounded_nonempty(change.get("path")?.as_str()?, 2_048)?,
                        action: action.to_string(),
                        diff: change
                            .get("diff")
                            .and_then(Value::as_str)
                            .map(|value| bounded_text(value, 120_000)),
                    })
                })
                .take(64)
                .collect::<Vec<_>>();
            Some(CodexActivityDetails::FileChange { changes })
        }
        "mcpToolCall" | "dynamicToolCall" => {
            let name = bounded_nonempty(item.get("tool")?.as_str()?, 240)?;
            Some(CodexActivityDetails::Tool {
                name,
                server: item
                    .get("server")
                    .and_then(Value::as_str)
                    .and_then(|value| bounded_nonempty(value, 240)),
                arguments: item.get("arguments").map(bounded_json),
                result: item
                    .get("result")
                    .or_else(|| item.get("contentItems"))
                    .filter(|value| !value.is_null())
                    .map(bounded_json),
                error: item
                    .get("error")
                    .and_then(|error| error.get("message").or(Some(error)))
                    .and_then(Value::as_str)
                    .map(|value| bounded_text(value, 4_096)),
                duration_ms: item.get("durationMs").and_then(Value::as_u64),
            })
        }
        "webSearch" => {
            let action = item.get("action");
            let action_type = action
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str)
                .map(|value| match value {
                    "openPage" | "open_page" => "open_page",
                    "findInPage" | "find_in_page" => "find_in_page",
                    "search" => "search",
                    _ => "other",
                })
                .map(str::to_string);
            Some(CodexActivityDetails::WebSearch {
                action: action_type,
                query: action
                    .and_then(|value| value.get("query"))
                    .or_else(|| item.get("query"))
                    .and_then(Value::as_str)
                    .map(|value| bounded_text(value, 4_096)),
                url: action
                    .and_then(|value| value.get("url"))
                    .and_then(Value::as_str)
                    .map(|value| bounded_text(value, 8_192)),
                pattern: action
                    .and_then(|value| value.get("pattern"))
                    .and_then(Value::as_str)
                    .map(|value| bounded_text(value, 4_096)),
            })
        }
        "imageGeneration" => Some(CodexActivityDetails::ImageGeneration {
            prompt: item
                .get("revisedPrompt")
                .and_then(Value::as_str)
                .map(|value| bounded_text(value, 120_000)),
        }),
        "collabAgentToolCall" => {
            let states = item
                .get("agentsStates")
                .and_then(Value::as_object)
                .map(|states| {
                    states
                        .iter()
                        .filter_map(|(thread_id, state)| {
                            Some(CodexAgentState {
                                thread_id: bounded_codex_identifier(Some(thread_id), "agent"),
                                status: bounded_nonempty(state.get("status")?.as_str()?, 240)?,
                                message: state
                                    .get("message")
                                    .and_then(Value::as_str)
                                    .map(|value| bounded_text(value, 4_096)),
                            })
                        })
                        .take(16)
                        .collect::<Vec<_>>()
                });
            Some(CodexActivityDetails::Agent {
                prompt: item
                    .get("prompt")
                    .and_then(Value::as_str)
                    .map(|value| bounded_text(value, 120_000)),
                model: item
                    .get("model")
                    .and_then(Value::as_str)
                    .and_then(|value| bounded_nonempty(value, 240)),
                reasoning_effort: item
                    .get("reasoningEffort")
                    .and_then(Value::as_str)
                    .filter(|value| {
                        matches!(
                            *value,
                            "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
                        )
                    })
                    .map(str::to_string),
                states,
            })
        }
        _ => None,
    }
}

fn reasoning_text(value: &Value, allowed_types: &[&str]) -> Option<String> {
    if let Some(value) = value.as_str() {
        return bounded_nonempty(value, 4_096);
    }
    let item_type = value.get("type").and_then(Value::as_str)?;
    if !allowed_types.contains(&item_type) {
        return None;
    }
    value
        .get("text")
        .and_then(Value::as_str)
        .and_then(|value| bounded_nonempty(value, 4_096))
}

fn bounded_json(value: &Value) -> String {
    bounded_text(&serde_json::to_string(value).unwrap_or_default(), 120_000)
}

fn bounded_text(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn bounded_nonempty(value: &str, max_chars: usize) -> Option<String> {
    let value = bounded_text(value.trim(), max_chars);
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn projects_bounded_command_disclosure_details() {
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
            false,
        )
        .expect("activity");
        let encoded = serde_json::to_string(&activity).expect("serialize");
        assert!(encoded.contains("Command execution"));
        assert!(encoded.contains("echo super-secret"));
        assert!(encoded.contains("token=secret"));
        assert!(encoded.contains("\"type\":\"command\""));
    }

    #[test]
    fn exposes_reasoning_summaries_but_not_raw_reasoning_content() {
        let raw = json!({"params": {"item": {
            "id": "reasoning-1", "type": "reasoning", "status": "completed",
            "summary": [{"type":"summary_text","text":"Checked the public contract."}],
            "content": [{"type":"reasoning_text","text":"private chain of thought"}]
        }}});
        let activity = project_codex_activity(
            "item/completed",
            &raw,
            "room-1",
            "turn-1",
            &mut HashMap::new(),
            false,
        )
        .expect("activity");
        let encoded = serde_json::to_string(&activity).expect("serialize");
        assert!(encoded.contains("Checked the public contract."));
        assert!(!encoded.contains("private chain of thought"));

        let shared = project_codex_activity(
            "item/completed",
            &raw,
            "room-1",
            "turn-1",
            &mut HashMap::new(),
            true,
        )
        .expect("activity");
        let shared_encoded = serde_json::to_string(&shared).expect("serialize");
        assert!(shared_encoded.contains("private chain of thought"));
        assert!(shared_encoded.contains("rawContent"));
    }

    #[test]
    fn projects_file_tool_web_image_and_agent_details() {
        let cases = [
            json!({"params":{"item":{"id":"file-1","type":"fileChange","changes":[
                {"path":"src/app.ts","kind":"update","diff":"+ready"}
            ]}}}),
            json!({"params":{"item":{"id":"tool-1","type":"mcpToolCall","server":"docs","tool":"search","arguments":{"q":"ipc"},"durationMs":12}}}),
            json!({"params":{"item":{"id":"web-1","type":"webSearch","query":"WebKit bridge","action":{"type":"search","query":"WebKit bridge"}}}}),
            json!({"params":{"item":{"id":"image-1","type":"imageGeneration","revisedPrompt":"A safe prompt","savedPath":"/private/image.png"}}}),
            json!({"params":{"item":{"id":"agent-1","type":"collabAgentToolCall","tool":"spawnAgent","senderThreadId":"root","receiverThreadIds":["child"],"prompt":"Inspect tests","model":"gpt-5","reasoningEffort":"high","agentsStates":{"child":{"status":"running","message":"Reviewing"}}}}}),
        ];
        let encoded = cases
            .iter()
            .map(|raw| {
                serde_json::to_string(
                    &project_codex_activity(
                        "item/completed",
                        raw,
                        "room-1",
                        "turn-1",
                        &mut HashMap::new(),
                        false,
                    )
                    .expect("activity"),
                )
                .expect("serialize")
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert!(encoded.contains("src/app.ts"));
        assert!(encoded.contains("\"name\":\"search\""));
        assert!(encoded.contains("WebKit bridge"));
        assert!(encoded.contains("A safe prompt"));
        assert!(encoded.contains("Inspect tests"));
        assert!(!encoded.contains("/private/image.png"));
    }

    #[test]
    fn ignores_token_delta_notifications() {
        assert!(project_codex_activity(
            "item/commandExecution/outputDelta",
            &json!({"params": {"delta": "secret"}}),
            "room-1",
            "turn-1",
            &mut HashMap::new(),
            false,
        )
        .is_none());
    }
}
