use super::codex_request_projection::{
    project_permissions, MAX_DISPLAY_TEXT_CHARS, MAX_ENUM_OPTIONS,
};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub(super) fn validate_codex_server_result(
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn modern_permission_profiles_round_trip_without_arbitrary_fields() {
        let permissions = json!({
            "fileSystem": { "globScanMaxDepth": 8, "entries": [
                { "access": "read", "path": { "type": "path", "path": "/workspace" }, "secret": "drop" },
                { "access": "write", "path": { "type": "glob_pattern", "pattern": "/workspace/**" } },
                { "access": "deny", "path": { "type": "special", "value": { "kind": "tmpdir" } } }
            ] },
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
            "mode": "form", "message": "Configure", "requestedSchema": {
                "type": "object", "required": ["region", "retries"], "properties": {
                    "region": { "type": "string", "enum": ["us", "eu"] },
                    "retries": { "type": "integer", "minimum": 1, "maximum": 3 },
                    "alerts": { "type": "boolean" },
                    "scopes": { "type": "array", "items": { "type": "string", "enum": ["read", "write"] }, "maxItems": 2 }
                }
            }
        });
        assert!(validate_codex_server_result(
            "mcpServer/elicitation/request", &params,
            json!({ "action": "accept", "content": { "region": "us", "retries": 2, "alerts": true, "scopes": ["read"] } }),
        ).is_ok());
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
}
