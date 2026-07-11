use crate::codex_requests::{
    wait_for_response, wait_for_response_message, CodexRpcState, RpcRequestContext,
};
use crate::codex_rpc::{allocate_rpc_session_id, send_json_shared, ActiveTimeout, RpcId, RpcInbox};
use crate::process::terminate_child;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

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

#[tauri::command]
pub(crate) fn probe_codex(
    app: tauri::AppHandle,
    rpc_state: tauri::State<'_, CodexRpcState>,
) -> CodexProbe {
    match Command::new("codex").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let model_result =
                list_codex_models_once(Duration::from_secs(8), &app, rpc_state.inner().clone());
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

pub(crate) fn normalize_reasoning_effort(value: Option<&str>) -> Result<String, String> {
    let effort = value.unwrap_or("medium").trim();
    match effort {
        "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" => Ok(effort.to_string()),
        _ => Err(
            "Codex reasoning effort must be none, minimal, low, medium, high, xhigh, or max."
                .to_string(),
        ),
    }
}

pub(crate) fn normalize_service_tier(
    value: Option<&str>,
    legacy_speed: Option<&str>,
) -> Result<String, String> {
    let Some(value) = value else {
        return service_tier_for_speed(legacy_speed);
    };
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > 64
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err("Codex service tier is invalid.".to_string());
    }
    Ok(value.to_string())
}

fn service_tier_for_speed(value: Option<&str>) -> Result<String, String> {
    let speed = value.unwrap_or("standard").trim();
    match speed {
        "standard" => Ok("default".to_string()),
        "fast" => Ok("fast".to_string()),
        _ => Err("Codex speed must be standard or fast.".to_string()),
    }
}

fn list_codex_models_once(
    timeout: Duration,
    app: &tauri::AppHandle,
    rpc_state: CodexRpcState,
) -> Result<Vec<CodexModelOption>, String> {
    let mut child = Command::new("codex")
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start codex app-server for model list: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .map(|stdin| Arc::new(Mutex::new(stdin)))
        .ok_or_else(|| "Could not open codex app-server stdin for model list".to_string())
        .inspect_err(|_| {
            terminate_child(&mut child);
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open codex app-server stdout for model list".to_string())
        .inspect_err(|_| {
            terminate_child(&mut child);
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

    let session_id = allocate_rpc_session_id();
    let mut inbox = RpcInbox::new(line_rx);
    let mut budget = ActiveTimeout::new(timeout);
    let context = RpcRequestContext {
        app,
        state: rpc_state.clone(),
        room_id: "__probe_room",
        session_id,
        stdin: stdin.clone(),
        cancelled: None,
    };
    let result = (|| {
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
        wait_for_response(&mut inbox, RpcId::Number(1.into()), &mut budget, &context)?;
        send_json_shared(&stdin, json!({ "method": "initialized", "params": {} }))?;
        send_json_shared(
            &stdin,
            json!({
                "method": "model/list",
                "id": 2,
                "params": {
                    "includeHidden": false,
                    "limit": 100
                }
            }),
        )?;
        let response =
            wait_for_response_message(&mut inbox, RpcId::Number(2.into()), &mut budget, &context)?;
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

    rpc_state.cancel_session(session_id, "Codex model session ended");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_parsing_keeps_defaults_and_capabilities() {
        let model = parse_codex_model_option(&json!({
            "id": "gpt-test",
            "displayName": "GPT Test",
            "isDefault": true,
            "defaultReasoningEffort": "high",
            "supportedReasoningEfforts": [{ "reasoningEffort": "medium" }, { "reasoningEffort": "high" }],
            "serviceTiers": [{ "id": "default" }, { "id": "fast" }],
            "defaultServiceTier": "fast"
        }))
        .expect("model option");
        assert_eq!(model.id, "gpt-test");
        assert!(model.is_default);
        assert_eq!(model.default_reasoning_effort, "high");
        assert_eq!(model.service_tiers, ["default", "fast"]);
    }

    #[test]
    fn catalog_normalization_preserves_legacy_speed_mapping() {
        assert_eq!(normalize_reasoning_effort(None).unwrap(), "medium");
        assert_eq!(
            normalize_reasoning_effort(Some(" xhigh ")).unwrap(),
            "xhigh"
        );
        assert_eq!(normalize_reasoning_effort(Some("max")).unwrap(), "max");
        assert!(normalize_reasoning_effort(Some("extreme")).is_err());
        assert_eq!(normalize_service_tier(None, Some("fast")).unwrap(), "fast");
        assert_eq!(
            normalize_service_tier(Some("priority.v2"), None).unwrap(),
            "priority.v2"
        );
        assert!(normalize_service_tier(Some("bad tier"), None).is_err());
    }
}
