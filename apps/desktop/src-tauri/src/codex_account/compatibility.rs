use super::*;

pub(super) fn selected_manifest(version: &str) -> Result<CompatibilityManifest, String> {
    let current = parse_semver(version).ok_or_else(|| "Codex version is invalid".to_string())?;
    let source = if current >= (0, 144, 0) {
        MANIFEST_0144
    } else if current >= (0, 143, 0) {
        MANIFEST_0143
    } else if current >= (0, 133, 0) {
        MANIFEST_0133
    } else {
        return Err(
            "Codex is older than the minimum supported app-server version (0.133.0)".to_string(),
        );
    };
    serde_json::from_str(source)
        .map_err(|error| format!("Bundled Codex manifest is invalid: {error}"))
}

pub(super) fn capabilities_for_version(version: &str) -> Result<CodexHostCapabilities, String> {
    let manifest = selected_manifest(version)?;
    let has = |method: &str| {
        manifest
            .client_request_methods
            .iter()
            .any(|entry| entry == method)
    };
    let notification = |method: &str| {
        manifest
            .server_notification_methods
            .iter()
            .any(|entry| entry == method)
    };
    let current = parse_semver(version).ok_or_else(|| "Codex version is invalid".to_string())?;
    let security_features_contract_tested = current <= (0, 144, 0);
    Ok(CodexHostCapabilities {
        codex_version: version.to_string(),
        manifest_version: manifest.codex_version,
        supports_account: has("account/read"),
        supports_browser_login: has("account/login/start")
            && notification("account/login/completed"),
        supports_device_login: has("account/login/start")
            && notification("account/login/completed"),
        supports_hosted_login_success: current == (0, 144, 0),
        supports_apps: has("app/list"),
        supports_mcp: has("mcpServerStatus/list") && has("mcpServer/oauth/login"),
        supports_writes_approval: security_features_contract_tested
            && manifest
                .app_tool_approval_modes
                .iter()
                .any(|mode| mode == "writes"),
        compatibility_warning: (!security_features_contract_tested).then(|| {
            "This Codex version is newer than the latest contract-tested version (0.144.0); security-affecting login and app approval additions are disabled.".to_string()
        }),
        supports_last_turn_fork: current >= (0, 143, 0),
    })
}

pub(super) fn parse_codex_version(value: &str) -> Option<String> {
    value
        .split_whitespace()
        .find_map(|part| parse_semver(part).map(|_| part.to_string()))
}

pub(super) fn parse_semver(value: &str) -> Option<(u64, u64, u64)> {
    let clean = value.split(['-', '+']).next()?;
    let mut parts = clean.split('.');
    let parsed = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    if parts.next().is_some() {
        None
    } else {
        Some(parsed)
    }
}

pub(super) fn bounded_string(
    value: Option<&Value>,
    field: &str,
    max: usize,
) -> Result<String, String> {
    let value = value
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Codex response is missing {field}"))?;
    if value.is_empty() || value.chars().count() > max {
        Err(format!("Codex response {field} is invalid"))
    } else {
        Ok(value.to_string())
    }
}

pub(super) fn safe_url(value: Option<&Value>, field: &str) -> Result<String, String> {
    let value = bounded_string(value, field, 8_192)?;
    let has_controls = value
        .chars()
        .any(|character| character.is_control() || character.is_whitespace());
    let allowed_scheme = value
        .strip_prefix("https://")
        .is_some_and(|rest| !rest.is_empty())
        || value
            .strip_prefix("http://127.0.0.1:")
            .is_some_and(|rest| !rest.is_empty())
        || value
            .strip_prefix("http://localhost:")
            .is_some_and(|rest| !rest.is_empty());
    if allowed_scheme && !has_controls {
        Ok(value)
    } else {
        Err(format!(
            "Codex response {field} did not use an allowed URL scheme"
        ))
    }
}
