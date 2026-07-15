use chrono::{DateTime, Duration, SecondsFormat, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
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

#[typed_tauri_command::command]
pub(crate) fn record_diagnostic(
    state: State<'_, DiagnosticState>,
    entry: DiagnosticEntry,
) -> crate::command_error::CommandResult<()> {
    state
        .record(entry, Utc::now())
        .map_err(crate::command_error::CommandError::storage)
}

#[typed_tauri_command::command]
pub(crate) async fn save_diagnostic_bundle(
    app: AppHandle,
    state: State<'_, DiagnosticState>,
    context: DiagnosticExportContext,
) -> crate::command_error::CommandResult<DiagnosticExportOutcome> {
    let now = Utc::now();
    let bundle = build_diagnostic_bundle(&state, context, now)
        .map_err(crate::command_error::CommandError::storage)?;
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
        crate::command_error::CommandError::invalid_argument(
            "The selected diagnostic export destination is not a local file",
        )
    })?;
    write_diagnostic_bundle(&destination, &bundle)
        .map_err(crate::command_error::CommandError::storage)?;
    Ok(DiagnosticExportOutcome::Saved)
}

#[path = "diagnostics/redaction.rs"]
mod redaction;
use redaction::*;
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
#[path = "diagnostics/tests.rs"]
mod tests;
