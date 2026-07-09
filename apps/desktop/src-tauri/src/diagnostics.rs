use chrono::{DateTime, Duration, SecondsFormat, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const MAX_MESSAGE_CHARS: usize = 240;
const MAX_DETAIL_CHARS: usize = 800;
const MAX_LOG_BYTES: usize = 256 * 1024;
const MAX_LOG_ENTRIES: usize = 500;
const MAX_ENCODED_LINE_BYTES: usize = 8 * 1024;
const RETENTION_DAYS: i64 = 7;
const MAX_FUTURE_SKEW_MINUTES: i64 = 5;
const MAX_USER_AGENT_CHARS: usize = 240;
const MAX_LANGUAGE_CHARS: usize = 64;
const MAX_PLATFORM_CHARS: usize = 120;
const MAX_RELAY_URL_CHARS: usize = 2_048;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DiagnosticLevel {
    Warn,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DiagnosticEntry {
    level: DiagnosticLevel,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    created_at: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DiagnosticExportContext {
    user_agent: Option<String>,
    language: Option<String>,
    platform: Option<String>,
    relay_http_origin: Option<String>,
    relay_ws_origin: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DiagnosticExportOutcome {
    Saved,
    Cancelled,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticBundle {
    generated_at: String,
    app: DiagnosticBundleApp,
    relay: DiagnosticBundleRelay,
    entries: Vec<DiagnosticEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticBundleApp {
    version: &'static str,
    runtime: &'static str,
    user_agent: String,
    language: String,
    platform: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticBundleRelay {
    http_origin: String,
    ws_origin: String,
}

#[derive(Clone)]
pub(crate) struct DiagnosticState {
    store: Arc<Mutex<DiagnosticStore>>,
    initialization_error: Option<String>,
}

struct DiagnosticStore {
    path: PathBuf,
    available: bool,
    entries: Vec<DiagnosticEntry>,
}

impl DiagnosticState {
    pub(crate) fn initialize(path: PathBuf) -> Self {
        match DiagnosticStore::initialize(path.clone(), Utc::now()) {
            Ok(store) => Self {
                store: Arc::new(Mutex::new(store)),
                initialization_error: None,
            },
            Err(error) => Self {
                store: Arc::new(Mutex::new(DiagnosticStore {
                    path,
                    available: false,
                    entries: Vec::new(),
                })),
                initialization_error: Some(error),
            },
        }
    }

    pub(crate) fn unavailable(error: String) -> Self {
        Self {
            store: Arc::new(Mutex::new(DiagnosticStore {
                path: PathBuf::new(),
                available: false,
                entries: Vec::new(),
            })),
            initialization_error: Some(error),
        }
    }

    pub(crate) fn initialization_error(&self) -> Option<&str> {
        self.initialization_error.as_deref()
    }

    fn record(&self, entry: DiagnosticEntry, now: DateTime<Utc>) -> Result<(), String> {
        let entry = validate_and_redact(entry, now)?;
        self.lock_store()?.record(entry)
    }

    fn export(&self, now: DateTime<Utc>) -> Result<Vec<DiagnosticEntry>, String> {
        self.lock_store()?.export(now)
    }

    fn lock_store(&self) -> Result<std::sync::MutexGuard<'_, DiagnosticStore>, String> {
        self.store
            .lock()
            .map_err(|_| "Diagnostic storage lock is unavailable".to_string())
    }
}

impl DiagnosticStore {
    fn initialize(path: PathBuf, now: DateTime<Utc>) -> Result<Self, String> {
        let parent = path
            .parent()
            .ok_or_else(|| "Diagnostic log path has no parent directory".to_string())?;
        create_private_directory(parent)?;
        ensure_safe_log_target(&path)?;
        let entries = if path.exists() {
            read_bounded_entries(&path)?
                .into_iter()
                .filter_map(|entry| validate_and_redact(entry, now).ok())
                .collect()
        } else {
            Vec::new()
        };
        let entries = retain_capped(entries)?;
        rewrite_entries(&path, &entries)?;
        Ok(Self {
            path,
            available: true,
            entries,
        })
    }

    fn ensure_available(&self) -> Result<(), String> {
        if self.available {
            Ok(())
        } else {
            Err("Diagnostic persistence is unavailable".to_string())
        }
    }

    fn record(&mut self, entry: DiagnosticEntry) -> Result<(), String> {
        self.ensure_available()?;
        let encoded = encode_line(&entry)?;
        let current_bytes = encoded_entries_len(&self.entries)?;
        if self.entries.len() < MAX_LOG_ENTRIES
            && current_bytes.saturating_add(encoded.len()) <= MAX_LOG_BYTES
        {
            append_line(&self.path, &encoded)?;
            self.entries.push(entry);
            return Ok(());
        }

        let mut next = self.entries.clone();
        next.push(entry);
        let next = retain_capped(next)?;
        rewrite_entries(&self.path, &next)?;
        self.entries = next;
        Ok(())
    }

    fn export(&self, now: DateTime<Utc>) -> Result<Vec<DiagnosticEntry>, String> {
        self.ensure_available()?;
        let entries = self
            .entries
            .iter()
            .cloned()
            .filter_map(|entry| validate_and_redact(entry, now).ok())
            .collect();
        retain_capped(entries)
    }
}

#[tauri::command]
pub(crate) fn record_diagnostic(
    state: State<'_, DiagnosticState>,
    entry: DiagnosticEntry,
) -> Result<(), String> {
    state.record(entry, Utc::now())
}

#[tauri::command]
pub(crate) async fn save_diagnostic_bundle(
    app: AppHandle,
    state: State<'_, DiagnosticState>,
    context: DiagnosticExportContext,
) -> Result<DiagnosticExportOutcome, String> {
    let now = Utc::now();
    let bundle = build_diagnostic_bundle(&state, context, now)?;
    let suggested_name = format!("multaiplayer-diagnostics-{}.json", now.format("%Y-%m-%d"));
    let Some(destination) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(suggested_name)
        .set_title("Save multAIplayer diagnostics")
        .blocking_save_file()
    else {
        return Ok(DiagnosticExportOutcome::Cancelled);
    };
    let destination = destination.into_path().map_err(|_| {
        "The selected diagnostic export destination is not a local file".to_string()
    })?;
    write_diagnostic_bundle(&destination, &bundle)?;
    Ok(DiagnosticExportOutcome::Saved)
}

fn build_diagnostic_bundle(
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

fn validate_export_context(
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

fn validate_optional_context_length(
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

fn sanitized_context_value(value: Option<&str>) -> String {
    value
        .filter(|value| !value.trim().is_empty())
        .map(redact_text)
        .unwrap_or_else(|| "unavailable".to_string())
}

fn normalized_relay_origin(value: Option<&str>, allowed_schemes: &[&str]) -> String {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return "unavailable".to_string();
    };
    match tauri::Url::parse(value) {
        Ok(url) if allowed_schemes.contains(&url.scheme()) => url.origin().ascii_serialization(),
        _ => "unavailable".to_string(),
    }
}

fn validate_and_redact(
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

fn redact_text(value: &str) -> String {
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

fn url_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r#"https?://[^\s"')]+"#).expect("valid diagnostic URL regex"))
}

fn token_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"\b[A-Za-z0-9_-]{32,}\b").expect("valid diagnostic token regex")
    })
}

fn read_bounded_entries(path: &Path) -> Result<Vec<DiagnosticEntry>, String> {
    let mut file =
        File::open(path).map_err(|error| format!("Failed to open diagnostic log: {error}"))?;
    let length = file
        .metadata()
        .map_err(|error| format!("Failed to inspect diagnostic log: {error}"))?
        .len();
    let read_limit = (MAX_LOG_BYTES + MAX_ENCODED_LINE_BYTES) as u64;
    let offset = length.saturating_sub(read_limit);
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("Failed to seek diagnostic log: {error}"))?;
    let mut bytes = Vec::with_capacity((length - offset).min(read_limit) as usize);
    file.take(read_limit)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read diagnostic log: {error}"))?;

    let bytes = if offset > 0 {
        match bytes.iter().position(|byte| *byte == b'\n') {
            Some(index) => &bytes[index + 1..],
            None => &[],
        }
    } else {
        &bytes[..]
    };

    Ok(bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty() && line.len() <= MAX_ENCODED_LINE_BYTES)
        .filter_map(|line| serde_json::from_slice::<DiagnosticEntry>(line).ok())
        .collect())
}

fn retain_capped(entries: Vec<DiagnosticEntry>) -> Result<Vec<DiagnosticEntry>, String> {
    let mut kept = Vec::new();
    let mut bytes = 0usize;
    for entry in entries.into_iter().rev() {
        if kept.len() >= MAX_LOG_ENTRIES {
            break;
        }
        let encoded_len = encode_line(&entry)?.len();
        if bytes.saturating_add(encoded_len) > MAX_LOG_BYTES {
            break;
        }
        bytes += encoded_len;
        kept.push(entry);
    }
    kept.reverse();
    Ok(kept)
}

fn encoded_entries_len(entries: &[DiagnosticEntry]) -> Result<usize, String> {
    entries.iter().try_fold(0usize, |total, entry| {
        Ok(total.saturating_add(encode_line(entry)?.len()))
    })
}

fn encode_line(entry: &DiagnosticEntry) -> Result<Vec<u8>, String> {
    let mut encoded = serde_json::to_vec(entry)
        .map_err(|error| format!("Failed to serialize diagnostic entry: {error}"))?;
    encoded.push(b'\n');
    if encoded.len() > MAX_ENCODED_LINE_BYTES {
        return Err("Serialized diagnostic entry is too large".to_string());
    }
    Ok(encoded)
}

fn append_line(path: &Path, encoded: &[u8]) -> Result<(), String> {
    ensure_safe_log_target(path)?;
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    configure_private_create_mode(&mut options);
    let mut file = options
        .open(path)
        .map_err(|error| format!("Failed to open diagnostic log for append: {error}"))?;
    ensure_open_regular_file(&file)?;
    ensure_private_file(path)?;
    file.write_all(encoded)
        .map_err(|error| format!("Failed to append diagnostic entry: {error}"))?;
    file.flush()
        .map_err(|error| format!("Failed to flush diagnostic entry: {error}"))
}

fn write_diagnostic_bundle(path: &Path, encoded: &[u8]) -> Result<(), String> {
    ensure_safe_export_target(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Diagnostic export path has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| "diagnostics.json".into());
    let temporary = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        temporary_file_nonce()
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        configure_private_create_mode(&mut options);
        let mut file = options
            .open(&temporary)
            .map_err(|error| format!("Failed to create diagnostic export: {error}"))?;
        ensure_open_regular_file(&file)?;
        ensure_private_file(&temporary)?;
        file.write_all(encoded)
            .map_err(|error| format!("Failed to write diagnostic export: {error}"))?;
        file.flush()
            .map_err(|error| format!("Failed to flush diagnostic export: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Failed to sync diagnostic export: {error}"))?;
        drop(file);
        replace_file(&temporary, path)?;
        ensure_private_file(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn rewrite_entries(path: &Path, entries: &[DiagnosticEntry]) -> Result<(), String> {
    ensure_safe_log_target(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Diagnostic log path has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("diagnostics.jsonl");
    let temporary = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        temporary_file_nonce()
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        configure_private_create_mode(&mut options);
        let mut file = options
            .open(&temporary)
            .map_err(|error| format!("Failed to create diagnostic rewrite: {error}"))?;
        ensure_open_regular_file(&file)?;
        ensure_private_file(&temporary)?;
        for entry in entries {
            file.write_all(&encode_line(entry)?)
                .map_err(|error| format!("Failed to rewrite diagnostic log: {error}"))?;
        }
        file.flush()
            .map_err(|error| format!("Failed to flush diagnostic rewrite: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Failed to sync diagnostic rewrite: {error}"))?;
        drop(file);
        replace_file(&temporary, path)?;
        ensure_private_file(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, path: &Path) -> Result<(), String> {
    fs::rename(temporary, path)
        .map_err(|error| format!("Failed to replace diagnostic log: {error}"))
}

#[cfg(windows)]
fn replace_file(temporary: &Path, path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Failed to replace diagnostic log: {error}"))?;
    }
    fs::rename(temporary, path)
        .map_err(|error| format!("Failed to replace diagnostic log: {error}"))
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("Failed to create diagnostic log directory: {error}"))?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect diagnostic log directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Diagnostic log directory must be a real directory".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
            format!("Failed to restrict diagnostic log directory permissions: {error}")
        })?;
    }
    Ok(())
}

fn configure_private_create_mode(options: &mut OpenOptions) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
        options.custom_flags(libc::O_NOFOLLOW);
    }
}

fn ensure_safe_log_target(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("Diagnostic log cannot be a symbolic link".to_string())
        }
        Ok(metadata) if !metadata.is_file() => {
            Err("Diagnostic log must be a regular file".to_string())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to inspect diagnostic log target: {error}")),
    }
}

fn ensure_safe_export_target(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("Diagnostic export cannot replace a symbolic link".to_string())
        }
        Ok(metadata) if !metadata.is_file() => {
            Err("Diagnostic export destination must be a regular file".to_string())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to inspect diagnostic export destination: {error}"
        )),
    }
}

fn ensure_open_regular_file(file: &File) -> Result<(), String> {
    if file
        .metadata()
        .map_err(|error| format!("Failed to inspect open diagnostic log: {error}"))?
        .is_file()
    {
        Ok(())
    } else {
        Err("Diagnostic log must be a regular file".to_string())
    }
}

fn temporary_file_nonce() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

fn ensure_private_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to restrict diagnostic log permissions: {error}"))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-07-09T12:00:00.000Z")
            .expect("test timestamp")
            .with_timezone(&Utc)
    }

    fn entry(index: usize) -> DiagnosticEntry {
        DiagnosticEntry {
            level: DiagnosticLevel::Warn,
            message: format!("event-{index}"),
            detail: None,
            created_at: now().to_rfc3339_opts(SecondsFormat::Millis, true),
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir()
            .join(format!(
                "multaiplayer-diagnostics-{name}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ))
            .join("diagnostics.jsonl")
    }

    #[test]
    fn serde_rejects_unknown_fields_and_levels() {
        let valid = r#"{"level":"warn","message":"hello","createdAt":"2026-07-09T12:00:00Z"}"#;
        assert!(serde_json::from_str::<DiagnosticEntry>(valid).is_ok());
        assert!(
            serde_json::from_str::<DiagnosticEntry>(&valid.replace("}", ",\"payload\":{}}"))
                .is_err()
        );
        assert!(serde_json::from_str::<DiagnosticEntry>(&valid.replace("warn", "info")).is_err());
    }

    #[test]
    fn export_context_rejects_unknown_and_oversized_fields() {
        assert!(serde_json::from_str::<DiagnosticExportContext>(
            r#"{"language":"en-US","payload":"not allowed"}"#
        )
        .is_err());
        let context = DiagnosticExportContext {
            user_agent: Some("x".repeat(MAX_USER_AGENT_CHARS + 1)),
            ..DiagnosticExportContext::default()
        };
        assert!(validate_export_context(context).is_err());
    }

    #[test]
    fn validation_bounds_text_and_timestamp() {
        let mut valid = entry(1);
        valid.message = "x".repeat(MAX_MESSAGE_CHARS);
        valid.detail = Some("y".repeat(MAX_DETAIL_CHARS));
        assert!(validate_and_redact(valid.clone(), now()).is_ok());
        valid.message.push('x');
        assert!(validate_and_redact(valid, now()).is_err());

        let mut oversized_detail = entry(2);
        oversized_detail.detail = Some("y".repeat(MAX_DETAIL_CHARS + 1));
        assert!(validate_and_redact(oversized_detail, now()).is_err());

        let mut invalid_date = entry(3);
        invalid_date.created_at = "today".to_string();
        assert!(validate_and_redact(invalid_date, now()).is_err());
    }

    #[test]
    fn startup_prunes_expired_future_corrupt_and_oversized_lines() {
        let path = temp_path("prune");
        fs::create_dir_all(path.parent().expect("parent")).expect("create test dir");
        let mut old = entry(1);
        old.created_at = (now() - Duration::days(8)).to_rfc3339();
        let mut future = entry(2);
        future.created_at = (now() + Duration::minutes(6)).to_rfc3339();
        let current = entry(3);
        let content = format!(
            "{}not json\n{}\n{}\n{}\n",
            "x".repeat(MAX_ENCODED_LINE_BYTES + 1),
            serde_json::to_string(&old).expect("old"),
            serde_json::to_string(&future).expect("future"),
            serde_json::to_string(&current).expect("current")
        );
        fs::write(&path, content).expect("seed log");

        let store = DiagnosticStore::initialize(path.clone(), now()).expect("initialize");
        assert_eq!(store.entries, vec![current]);
        assert_eq!(
            read_bounded_entries(&path).expect("read canonical").len(),
            1
        );
        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn record_enforces_entry_and_byte_caps_with_newest_entries() {
        let count_path = temp_path("count-cap");
        let mut count_store =
            DiagnosticStore::initialize(count_path.clone(), now()).expect("initialize count");
        for index in 0..550 {
            count_store
                .record(entry(index))
                .expect("record count entry");
        }
        assert_eq!(count_store.entries.len(), MAX_LOG_ENTRIES);
        assert_eq!(
            count_store.entries.first().expect("first").message,
            "event-50"
        );

        let byte_path = temp_path("byte-cap");
        let mut byte_store =
            DiagnosticStore::initialize(byte_path.clone(), now()).expect("initialize bytes");
        for index in 0..500 {
            let mut large = entry(index);
            large.detail = Some("z ".repeat(MAX_DETAIL_CHARS / 2));
            byte_store.record(large).expect("record large entry");
        }
        assert!(fs::metadata(&byte_path).expect("metadata").len() <= MAX_LOG_BYTES as u64);
        assert!(byte_store.entries.len() < MAX_LOG_ENTRIES);
        assert_eq!(
            byte_store.entries.last().expect("last").message,
            "event-499"
        );

        let _ = fs::remove_dir_all(count_path.parent().expect("parent"));
        let _ = fs::remove_dir_all(byte_path.parent().expect("parent"));
    }

    #[test]
    fn concurrent_records_produce_complete_json_lines() {
        let path = temp_path("concurrent");
        let state = DiagnosticState {
            store: Arc::new(Mutex::new(
                DiagnosticStore::initialize(path.clone(), now()).expect("initialize"),
            )),
            initialization_error: None,
        };
        let threads = (0..8)
            .map(|thread_index| {
                let state = state.clone();
                thread::spawn(move || {
                    for item in 0..25 {
                        state
                            .record(entry(thread_index * 25 + item), now())
                            .expect("record concurrently");
                    }
                })
            })
            .collect::<Vec<_>>();
        for thread in threads {
            thread.join().expect("join");
        }
        let persisted = read_bounded_entries(&path).expect("read persisted");
        assert_eq!(persisted.len(), 200);
        assert_eq!(state.export(now()).expect("export").len(), 200);
        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn capture_and_export_redact_urls_and_tokens() {
        let path = temp_path("redaction");
        let state = DiagnosticState {
            store: Arc::new(Mutex::new(
                DiagnosticStore::initialize(path.clone(), now()).expect("initialize"),
            )),
            initialization_error: None,
        };
        let mut unsafe_entry = entry(1);
        unsafe_entry.detail = Some(
            "https://user:password@relay.example.com/invites?token=secret gho_abcdefghijklmnopqrstuvwxyz1234567890"
                .to_string(),
        );
        state.record(unsafe_entry, now()).expect("record");

        // Simulate a legacy in-memory record so export's independent redaction is exercised.
        state.lock_store().expect("lock").entries[0].message =
            "legacy abcdefghijklmnopqrstuvwxyz1234567890".to_string();
        let exported = state.export(now()).expect("export");
        let serialized = serde_json::to_string(&exported).expect("serialize export");
        assert!(!serialized.contains("token=secret"));
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("gho_"));
        assert!(!serialized.contains("abcdefghijklmnopqrstuvwxyz1234567890"));
        assert!(serialized.contains("[redacted-token]"));
        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn native_bundle_normalizes_context_and_never_exposes_unredacted_entries() {
        let path = temp_path("native-bundle");
        let state = DiagnosticState {
            store: Arc::new(Mutex::new(
                DiagnosticStore::initialize(path.clone(), now()).expect("initialize"),
            )),
            initialization_error: None,
        };
        state.record(entry(1), now()).expect("record");
        state.lock_store().expect("lock").entries[0].detail = Some(
            "legacy https://relay.example.com/path?secret=leaked abcdefghijklmnopqrstuvwxyz1234567890"
                .to_string(),
        );
        let context = DiagnosticExportContext {
            user_agent: Some("Browser abcdefghijklmnopqrstuvwxyz1234567890".to_string()),
            language: Some("en-US".to_string()),
            platform: Some("macOS".to_string()),
            relay_http_origin: Some(
                "https://user:password@relay.example.com/api?secret=leaked".to_string(),
            ),
            relay_ws_origin: Some("wss://relay.example.com/rooms?secret=leaked".to_string()),
        };
        let encoded = build_diagnostic_bundle(&state, context, now()).expect("build bundle");
        let bundle: serde_json::Value = serde_json::from_slice(&encoded).expect("parse bundle");

        assert_eq!(bundle["generatedAt"], "2026-07-09T12:00:00.000Z");
        assert_eq!(bundle["app"]["runtime"], "tauri");
        assert_eq!(bundle["app"]["language"], "en-US");
        assert_eq!(bundle["relay"]["httpOrigin"], "https://relay.example.com");
        assert_eq!(bundle["relay"]["wsOrigin"], "wss://relay.example.com");
        let serialized = String::from_utf8(encoded).expect("utf8 bundle");
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("secret=leaked"));
        assert!(!serialized.contains("abcdefghijklmnopqrstuvwxyz1234567890"));
        assert!(serialized.contains("[redacted-token]"));
        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn bundle_writer_replaces_regular_files_and_writes_complete_json() {
        let path = temp_path("bundle-write").with_file_name("diagnostics.json");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(&path, "old contents").expect("seed export");
        let encoded = br#"{"complete":true}
"#;
        write_diagnostic_bundle(&path, encoded).expect("write bundle");
        assert_eq!(fs::read(&path).expect("read bundle"), encoded);
        let leftovers = fs::read_dir(path.parent().expect("parent"))
            .expect("read parent")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[cfg(unix)]
    #[test]
    fn bundle_writer_is_private_and_rejects_symlink_destinations() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let path = temp_path("bundle-symlink").with_file_name("diagnostics.json");
        let parent = path.parent().expect("parent");
        fs::create_dir_all(parent).expect("create parent");
        let outside = parent.join("outside.json");
        fs::write(&outside, "do not overwrite").expect("write outside");
        symlink(&outside, &path).expect("create symlink");
        assert!(write_diagnostic_bundle(&path, b"{}\n").is_err());
        assert_eq!(
            fs::read_to_string(&outside).expect("read outside"),
            "do not overwrite"
        );

        fs::remove_file(&path).expect("remove symlink");
        write_diagnostic_bundle(&path, b"{}\n").expect("write bundle");
        let mode = fs::metadata(&path).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = fs::remove_dir_all(parent);
    }

    #[cfg(unix)]
    #[test]
    fn log_and_directory_permissions_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_path("permissions");
        let mut store = DiagnosticStore::initialize(path.clone(), now()).expect("initialize");
        store.record(entry(1)).expect("record");
        let file_mode = fs::metadata(&path)
            .expect("file metadata")
            .permissions()
            .mode()
            & 0o777;
        let directory_mode = fs::metadata(path.parent().expect("parent"))
            .expect("directory metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(file_mode, 0o600);
        assert_eq!(directory_mode, 0o700);
        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[cfg(unix)]
    #[test]
    fn initialization_rejects_symlink_and_non_regular_targets() {
        use std::os::unix::fs::symlink;
        let symlink_path = temp_path("symlink-target");
        let parent = symlink_path.parent().expect("parent");
        fs::create_dir_all(parent).expect("create parent");
        let outside = parent.join("outside.log");
        fs::write(&outside, "do not overwrite").expect("write outside file");
        symlink(&outside, &symlink_path).expect("create symlink");
        assert!(DiagnosticStore::initialize(symlink_path.clone(), now()).is_err());
        assert_eq!(
            fs::read_to_string(&outside).expect("read outside"),
            "do not overwrite"
        );

        fs::remove_file(&symlink_path).expect("remove symlink");
        fs::create_dir(&symlink_path).expect("create directory target");
        assert!(DiagnosticStore::initialize(symlink_path.clone(), now()).is_err());
        let _ = fs::remove_dir_all(parent);
    }
}
