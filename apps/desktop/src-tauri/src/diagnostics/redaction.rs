use super::*;

pub(super) fn build_diagnostic_bundle(
    state: &DiagnosticState,
    context: DiagnosticExportContext,
    now: DateTime<Utc>,
) -> Result<Vec<u8>, String> {
    let context = validate_export_context(context)?;
    let bundle = DiagnosticBundle {
        generated_at: now.to_rfc3339_opts(SecondsFormat::Millis, true),
        app: DiagnosticBundleApp {
            version: env!("CARGO_PKG_VERSION"),
            runtime: "tauri",
            user_agent: sanitized_context_value(context.user_agent.as_deref()),
            language: sanitized_context_value(context.language.as_deref()),
            platform: sanitized_context_value(context.platform.as_deref()),
        },
        relay: DiagnosticBundleRelay {
            http_origin: normalized_relay_origin(
                context.relay_http_origin.as_deref(),
                &["http", "https"],
            ),
            ws_origin: normalized_relay_origin(context.relay_ws_origin.as_deref(), &["ws", "wss"]),
        },
        entries: state.export(now)?,
    };
    let mut encoded = serde_json::to_vec_pretty(&bundle)
        .map_err(|error| format!("Failed to serialize diagnostic bundle: {error}"))?;
    encoded.push(b'\n');
    Ok(encoded)
}

pub(super) fn validate_export_context(
    context: DiagnosticExportContext,
) -> Result<DiagnosticExportContext, String> {
    validate_optional_context_length(
        "userAgent",
        context.user_agent.as_deref(),
        MAX_USER_AGENT_CHARS,
    )?;
    validate_optional_context_length("language", context.language.as_deref(), MAX_LANGUAGE_CHARS)?;
    validate_optional_context_length("platform", context.platform.as_deref(), MAX_PLATFORM_CHARS)?;
    validate_optional_context_length(
        "relayHttpOrigin",
        context.relay_http_origin.as_deref(),
        MAX_RELAY_URL_CHARS,
    )?;
    validate_optional_context_length(
        "relayWsOrigin",
        context.relay_ws_origin.as_deref(),
        MAX_RELAY_URL_CHARS,
    )?;
    Ok(context)
}

pub(super) fn validate_optional_context_length(
    field: &str,
    value: Option<&str>,
    max_chars: usize,
) -> Result<(), String> {
    if value.is_some_and(|value| value.chars().count() > max_chars) {
        Err(format!(
            "Diagnostic export {field} must be {max_chars} characters or fewer"
        ))
    } else {
        Ok(())
    }
}

pub(super) fn sanitized_context_value(value: Option<&str>) -> String {
    value
        .filter(|value| !value.trim().is_empty())
        .map(redact_text)
        .unwrap_or_else(|| "unavailable".to_string())
}

pub(super) fn normalized_relay_origin(value: Option<&str>, allowed_schemes: &[&str]) -> String {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return "unavailable".to_string();
    };
    match tauri::Url::parse(value) {
        Ok(url) if allowed_schemes.contains(&url.scheme()) => url.origin().ascii_serialization(),
        _ => "unavailable".to_string(),
    }
}

pub(super) fn validate_and_redact(
    mut entry: DiagnosticEntry,
    now: DateTime<Utc>,
) -> Result<DiagnosticEntry, String> {
    if entry.message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(format!(
            "Diagnostic message must be {MAX_MESSAGE_CHARS} characters or fewer"
        ));
    }
    if entry
        .detail
        .as_ref()
        .is_some_and(|detail| detail.chars().count() > MAX_DETAIL_CHARS)
    {
        return Err(format!(
            "Diagnostic detail must be {MAX_DETAIL_CHARS} characters or fewer"
        ));
    }

    let created_at = DateTime::parse_from_rfc3339(&entry.created_at)
        .map_err(|_| "Diagnostic createdAt must be an RFC3339 timestamp".to_string())?
        .with_timezone(&Utc);
    if created_at < now - Duration::days(RETENTION_DAYS) {
        return Err("Diagnostic entry is older than the retention window".to_string());
    }
    if created_at > now + Duration::minutes(MAX_FUTURE_SKEW_MINUTES) {
        return Err("Diagnostic createdAt is too far in the future".to_string());
    }

    entry.message = redact_text(&entry.message);
    entry.detail = entry.detail.map(|detail| redact_text(&detail));
    entry.created_at = created_at.to_rfc3339_opts(SecondsFormat::Millis, true);
    Ok(entry)
}

pub(super) fn redact_text(value: &str) -> String {
    let without_url_secrets = url_regex()
        .replace_all(value, |captures: &regex::Captures<'_>| {
            let matched = captures.get(0).map_or("", |capture| capture.as_str());
            match tauri::Url::parse(matched) {
                Ok(url) => format!("{}{}", url.origin().ascii_serialization(), url.path()),
                Err(_) => "[url]".to_string(),
            }
        })
        .into_owned();
    token_regex()
        .replace_all(&without_url_secrets, "[redacted-token]")
        .into_owned()
}

pub(super) fn url_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r#"https?://[^\s"')]+"#).expect("valid diagnostic URL regex"))
}

pub(super) fn token_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"\b[A-Za-z0-9_-]{32,}\b").expect("valid diagnostic token regex")
    })
}
