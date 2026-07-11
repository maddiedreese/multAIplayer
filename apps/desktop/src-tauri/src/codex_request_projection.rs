use serde_json::{json, Map, Value};

pub(super) const MAX_DISPLAY_TEXT_CHARS: usize = 8_000;
pub(super) const MAX_ENUM_OPTIONS: usize = 50;
const MAX_FORM_FIELDS: usize = 24;

pub(super) fn project_server_request(method: &str, params: &Value) -> Result<Value, String> {
    let params = params
        .as_object()
        .ok_or_else(|| "Request params must be an object".to_string())?;
    let mut output = Map::new();
    match method {
        "item/commandExecution/requestApproval" | "execCommandApproval" => {
            copy_text(params, &mut output, "reason", 2_000);
            copy_text(params, &mut output, "cwd", 4_096);
            copy_text_or_string_array(params, &mut output, "command", 200, MAX_DISPLAY_TEXT_CHARS);
        }
        "item/fileChange/requestApproval" | "applyPatchApproval" => {
            copy_text(params, &mut output, "reason", 2_000);
            copy_text(params, &mut output, "grantRoot", 4_096);
        }
        "item/permissions/requestApproval" => {
            copy_text(params, &mut output, "reason", 2_000);
            copy_text(params, &mut output, "cwd", 4_096);
            output.insert(
                "permissions".to_string(),
                project_permissions(params.get("permissions").unwrap_or(&Value::Null))?,
            );
        }
        "item/tool/requestUserInput" | "tool/requestUserInput" => {
            let questions = params
                .get("questions")
                .and_then(Value::as_array)
                .ok_or_else(|| "User input questions are missing".to_string())?;
            let projected = questions
                .iter()
                .take(3)
                .map(project_user_question)
                .collect::<Result<Vec<_>, _>>()?;
            if projected.is_empty() {
                return Err("User input questions are empty".to_string());
            }
            output.insert("questions".to_string(), Value::Array(projected));
        }
        "mcpServer/elicitation/request" => return project_mcp_elicitation(params),
        _ => return Err("Unsupported interactive request".to_string()),
    }
    for key in ["threadId", "turnId", "itemId"] {
        copy_text(params, &mut output, key, 512);
    }
    Ok(Value::Object(output))
}

pub(super) fn project_permissions(value: &Value) -> Result<Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Permission profile must be an object".to_string())?;
    let mut output = Map::new();
    if let Some(network) = object.get("network").and_then(Value::as_object) {
        let mut projected = Map::new();
        if let Some(enabled) = network.get("enabled").and_then(Value::as_bool) {
            projected.insert("enabled".to_string(), Value::Bool(enabled));
        }
        output.insert("network".to_string(), Value::Object(projected));
    }
    if let Some(files) = object.get("fileSystem").and_then(Value::as_object) {
        let mut projected = Map::new();
        for key in ["read", "write"] {
            if let Some(items) = files.get(key).and_then(Value::as_array) {
                if items.len() > 100 {
                    return Err("Permission path list is too large".to_string());
                }
                projected.insert(
                    key.to_string(),
                    Value::Array(
                        items
                            .iter()
                            .map(|item| bounded_permission_text(item, 4_096).map(Value::String))
                            .collect::<Result<Vec<_>, _>>()?,
                    ),
                );
            }
        }
        if let Some(depth) = files.get("globScanMaxDepth").and_then(Value::as_u64) {
            if depth == 0 || depth > u32::MAX as u64 {
                return Err("Permission glob scan depth is invalid".to_string());
            }
            projected.insert("globScanMaxDepth".to_string(), json!(depth));
        }
        if let Some(entries) = files.get("entries").and_then(Value::as_array) {
            if entries.len() > 100 {
                return Err("Permission entry list is too large".to_string());
            }
            projected.insert(
                "entries".to_string(),
                Value::Array(
                    entries
                        .iter()
                        .map(project_permission_entry)
                        .collect::<Result<Vec<_>, _>>()?,
                ),
            );
        }
        output.insert("fileSystem".to_string(), Value::Object(projected));
    }
    Ok(Value::Object(output))
}

fn project_permission_entry(value: &Value) -> Result<Value, String> {
    let entry = value
        .as_object()
        .ok_or_else(|| "Permission entry must be an object".to_string())?;
    let access = entry
        .get("access")
        .and_then(Value::as_str)
        .filter(|access| matches!(*access, "read" | "write" | "deny"))
        .ok_or_else(|| "Permission entry access is invalid".to_string())?;
    let path = entry
        .get("path")
        .and_then(Value::as_object)
        .ok_or_else(|| "Permission entry path is invalid".to_string())?;
    let projected_path = match path.get("type").and_then(Value::as_str) {
        Some("path") => json!({
            "type": "path",
            "path": bounded_permission_text(path.get("path").unwrap_or(&Value::Null), 4_096)?
        }),
        Some("glob_pattern") => json!({
            "type": "glob_pattern",
            "pattern": bounded_permission_text(path.get("pattern").unwrap_or(&Value::Null), 4_096)?
        }),
        Some("special") => {
            let special = path
                .get("value")
                .and_then(Value::as_object)
                .ok_or_else(|| "Special permission path is invalid".to_string())?;
            let kind = special
                .get("kind")
                .and_then(Value::as_str)
                .filter(|kind| {
                    matches!(
                        *kind,
                        "root" | "minimal" | "project_roots" | "tmpdir" | "slash_tmp" | "unknown"
                    )
                })
                .ok_or_else(|| "Special permission path kind is invalid".to_string())?;
            let mut projected =
                Map::from_iter([("kind".to_string(), Value::String(kind.to_string()))]);
            for key in ["path", "subpath"] {
                if let Some(value) = special.get(key) {
                    projected.insert(
                        key.to_string(),
                        Value::String(bounded_permission_text(value, 4_096)?),
                    );
                }
            }
            json!({ "type": "special", "value": projected })
        }
        _ => return Err("Permission entry path type is invalid".to_string()),
    };
    Ok(json!({ "access": access, "path": projected_path }))
}

fn bounded_permission_text(value: &Value, max: usize) -> Result<String, String> {
    let text = value
        .as_str()
        .ok_or_else(|| "Permission path must be text".to_string())?;
    if text.chars().count() > max || text.chars().any(char::is_control) {
        return Err("Permission path exceeds supported bounds".to_string());
    }
    Ok(text.to_string())
}

fn project_user_question(value: &Value) -> Result<Value, String> {
    let question = value
        .as_object()
        .ok_or_else(|| "User input question must be an object".to_string())?;
    let id = required_text(question, "id", 128)?;
    let prompt = question
        .get("question")
        .and_then(Value::as_str)
        .or_else(|| question.get("header").and_then(Value::as_str))
        .ok_or_else(|| "User input question is missing text".to_string())?;
    let mut output = json!({
        "id": id,
        "question": bound_text(prompt, 2_000),
        "isSecret": question.get("isSecret").and_then(Value::as_bool).unwrap_or(false),
        "isOther": question.get("isOther").and_then(Value::as_bool).unwrap_or(false)
    });
    if let Some(options) = question.get("options").and_then(Value::as_array) {
        output["options"] = Value::Array(
            options
                .iter()
                .take(MAX_ENUM_OPTIONS)
                .filter_map(|option| option.as_object())
                .filter_map(|option| {
                    let label = option.get("label")?.as_str()?;
                    Some(json!({
                        "label": bound_text(label, 200),
                        "description": option.get("description").and_then(Value::as_str).map(|text| bound_text(text, 500)).unwrap_or_default()
                    }))
                })
                .collect(),
        );
    }
    Ok(output)
}

fn project_mcp_elicitation(params: &Map<String, Value>) -> Result<Value, String> {
    let mode = required_text(params, "mode", 32)?;
    let message = required_text(params, "message", 2_000)?;
    match mode.as_str() {
        "url" => {
            let url = required_text(params, "url", 4_096)?;
            if !(url.starts_with("https://") || url.starts_with("http://"))
                || url.chars().any(char::is_control)
            {
                return Err("MCP elicitation URL is invalid".to_string());
            }
            Ok(json!({
                "mode": "url",
                "message": message,
                "url": url,
                "elicitationId": params.get("elicitationId").and_then(Value::as_str).map(|value| bound_text(value, 512))
            }))
        }
        "form" | "openai/form" => {
            let schema = params
                .get("requestedSchema")
                .ok_or_else(|| "MCP form schema is missing".to_string())?;
            Ok(json!({
                "mode": mode,
                "message": message,
                "requestedSchema": project_mcp_schema(schema)?
            }))
        }
        _ => Err("MCP elicitation mode is unsupported".to_string()),
    }
}

fn project_mcp_schema(value: &Value) -> Result<Value, String> {
    let schema = value
        .as_object()
        .ok_or_else(|| "MCP form schema must be an object".to_string())?;
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err("MCP form schema must describe an object".to_string());
    }
    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .ok_or_else(|| "MCP form properties are missing".to_string())?;
    if properties.len() > MAX_FORM_FIELDS {
        return Err("MCP form has too many fields".to_string());
    }
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|key| properties.contains_key(*key))
        .map(|key| Value::String(bound_text(key, 128)))
        .collect::<Vec<_>>();
    let mut projected = Map::new();
    for (key, property) in properties {
        if key.is_empty() || key.chars().count() > 128 {
            return Err("MCP form field id is invalid".to_string());
        }
        projected.insert(key.clone(), project_mcp_property(property)?);
    }
    Ok(json!({ "type": "object", "properties": projected, "required": required }))
}

fn project_mcp_property(value: &Value) -> Result<Value, String> {
    let property = value
        .as_object()
        .ok_or_else(|| "MCP form field must be an object".to_string())?;
    let kind = required_text(property, "type", 32)?;
    if !matches!(
        kind.as_str(),
        "string" | "number" | "integer" | "boolean" | "array"
    ) {
        return Err("MCP form field type is unsupported".to_string());
    }
    let mut output = Map::from_iter([("type".to_string(), Value::String(kind.clone()))]);
    for key in ["title", "description", "format"] {
        copy_text(property, &mut output, key, 1_000);
    }
    for key in [
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
    ] {
        if let Some(number) = property.get(key).and_then(Value::as_f64) {
            if number.is_finite() {
                output.insert(key.to_string(), json!(number));
            }
        }
    }
    if let Some(default) = property.get("default") {
        let projected_default = match (kind.as_str(), default) {
            ("string", Value::String(text)) => {
                Some(Value::String(bound_text(text, MAX_DISPLAY_TEXT_CHARS)))
            }
            ("number" | "integer", Value::Number(_)) | ("boolean", Value::Bool(_)) => {
                Some(default.clone())
            }
            ("array", Value::Array(items)) => Some(Value::Array(
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .take(MAX_ENUM_OPTIONS)
                    .map(|text| Value::String(bound_text(text, 200)))
                    .collect(),
            )),
            _ => None,
        };
        if let Some(default) = projected_default {
            output.insert("default".to_string(), default);
        }
    }
    if kind == "array" {
        let items = property
            .get("items")
            .and_then(Value::as_object)
            .ok_or_else(|| "MCP array field is missing items".to_string())?;
        output.insert("items".to_string(), project_enum_container(items)?);
    } else if kind == "string" {
        for key in ["enum", "oneOf", "anyOf", "enumNames"] {
            if let Some(value) = property.get(key) {
                output.insert(key.to_string(), project_enum_value(key, value)?);
            }
        }
    }
    Ok(Value::Object(output))
}

fn project_enum_container(items: &Map<String, Value>) -> Result<Value, String> {
    let mut output = Map::from_iter([("type".to_string(), Value::String("string".to_string()))]);
    let mut found = false;
    for key in ["enum", "oneOf", "anyOf"] {
        if let Some(value) = items.get(key) {
            output.insert(key.to_string(), project_enum_value(key, value)?);
            found = true;
        }
    }
    if !found {
        return Err("MCP array options are missing".to_string());
    }
    Ok(Value::Object(output))
}

fn project_enum_value(key: &str, value: &Value) -> Result<Value, String> {
    let values = value
        .as_array()
        .ok_or_else(|| "MCP enum options must be an array".to_string())?;
    if values.is_empty() || values.len() > MAX_ENUM_OPTIONS {
        return Err("MCP enum option count is invalid".to_string());
    }
    Ok(Value::Array(
        values
            .iter()
            .map(|value| {
                if key == "enum" || key == "enumNames" {
                    value
                        .as_str()
                        .map(|text| Value::String(bound_text(text, 200)))
                        .ok_or_else(|| "MCP enum option is invalid".to_string())
                } else {
                    let option = value
                        .as_object()
                        .ok_or_else(|| "MCP titled enum option is invalid".to_string())?;
                    let constant = required_text(option, "const", 200)?;
                    Ok(json!({
                        "const": constant,
                        "title": option.get("title").and_then(Value::as_str).map(|text| bound_text(text, 200)).unwrap_or_else(|| "Option".to_string())
                    }))
                }
            })
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

fn copy_text(source: &Map<String, Value>, target: &mut Map<String, Value>, key: &str, max: usize) {
    if let Some(text) = source.get(key).and_then(Value::as_str) {
        target.insert(key.to_string(), Value::String(bound_text(text, max)));
    }
}

fn copy_text_or_string_array(
    source: &Map<String, Value>,
    target: &mut Map<String, Value>,
    key: &str,
    max_items: usize,
    max_chars: usize,
) {
    match source.get(key) {
        Some(Value::String(text)) => {
            target.insert(key.to_string(), Value::String(bound_text(text, max_chars)));
        }
        Some(Value::Array(items)) => {
            target.insert(
                key.to_string(),
                Value::Array(
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .take(max_items)
                        .map(|text| Value::String(bound_text(text, 1_000)))
                        .collect(),
                ),
            );
        }
        _ => {}
    }
}

fn required_text(source: &Map<String, Value>, key: &str, max: usize) -> Result<String, String> {
    let text = source
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| format!("Missing {key}"))?;
    Ok(bound_text(text, max))
}

fn bound_text(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_is_method_specific_and_never_copies_unknown_secrets() {
        let projected = project_server_request(
            "item/commandExecution/requestApproval",
            &json!({ "command": "npm test", "cwd": "/repo", "accessToken": "secret" }),
        )
        .unwrap();
        assert_eq!(projected["command"], "npm test");
        assert!(projected.get("accessToken").is_none());
        assert!(project_server_request(
            "account/chatgptAuthTokens/refresh",
            &json!({ "accessToken": "secret" })
        )
        .is_err());
    }

    #[test]
    fn mcp_url_projection_requires_a_web_url() {
        assert!(project_server_request(
            "mcpServer/elicitation/request",
            &json!({ "mode": "url", "message": "Sign in", "url": "https://example.com/login", "secret": "no" }),
        )
        .is_ok());
        assert!(project_server_request(
            "mcpServer/elicitation/request",
            &json!({ "mode": "url", "message": "Open", "url": "file:///etc/passwd" }),
        )
        .is_err());
    }
}
