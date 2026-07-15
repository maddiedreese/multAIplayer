use age::secrecy::SecretString;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};
use tauri::Manager;

const ARCHIVE_VERSION: u8 = 1;
const MAX_ARCHIVE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES: usize = 12 * 1024 * 1024;
const MAX_ARCHIVES: usize = 100;
const MIN_PASSPHRASE_BYTES: usize = 12;
const ARCHIVE_EXTENSION: &str = "multai.age";
static ARCHIVE_LIBRARY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveSource {
    room_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    team_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveBody {
    version: u8,
    exported_at: String,
    source: ArchiveSource,
    omissions: Vec<String>,
    history: ArchiveHistory,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveHistory {
    version: u8,
    messages: Vec<Value>,
    chat_edits: Vec<Value>,
    chat_deletes: Vec<Value>,
    terminal_requests: Vec<Value>,
    file_save_requests: Vec<Value>,
    browser_requests: Vec<Value>,
    codex_events: Vec<Value>,
    codex_activities: Vec<Value>,
    git_workflow_events: Vec<Value>,
    github_actions_events: Vec<Value>,
    local_previews: Vec<Value>,
    terminal_snapshots: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    room_goal: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArchiveEnvelope {
    body: ArchiveBody,
    payload_sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveExportRequest {
    path: String,
    passphrase: String,
    archive: ArchiveBody,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveImportRequest {
    path: String,
    passphrase: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveOpenRequest {
    archive_id: String,
    passphrase: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveDeleteRequest {
    archive_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArchiveLibraryEntry {
    id: String,
    imported_at: String,
    byte_length: u64,
    version: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveOpened {
    entry: ArchiveLibraryEntry,
    archive: ArchiveBody,
}

#[typed_tauri_command::command]
pub(crate) fn room_archive_export(
    request: ArchiveExportRequest,
) -> crate::command_error::CommandResult<ArchiveLibraryEntry> {
    let path = PathBuf::from(&request.path);
    let envelope = seal_archive(request.archive, &request.passphrase)?;
    safe_write(&path, &envelope)?;
    let opened = open_archive_bytes(&envelope, &request.passphrase)?;
    Ok(entry_for("export", &opened, envelope.len() as u64))
}

#[typed_tauri_command::command]
pub(crate) fn room_archive_import(
    request: ArchiveImportRequest,
    app: tauri::AppHandle,
) -> crate::command_error::CommandResult<ArchiveOpened> {
    let source = PathBuf::from(&request.path);
    let encrypted = safe_read(&source)?;
    let archive = open_archive_bytes(&encrypted, &request.passphrase)?;
    let library = library_dir(&app)?;
    let _lock = lock_archive_library()?;
    let entries = recover_and_list_entries(&library)?;
    if entries.len() >= MAX_ARCHIVES {
        return Err(
            "Archive library limit reached (100). Delete an imported archive first.".into(),
        );
    }
    let id = uuid::Uuid::new_v4().to_string();
    Ok(persist_import(
        &library,
        &id,
        encrypted,
        archive,
        write_entry,
    )?)
}

#[typed_tauri_command::command]
pub(crate) fn room_archive_list(
    app: tauri::AppHandle,
) -> crate::command_error::CommandResult<Vec<ArchiveLibraryEntry>> {
    let library = library_dir(&app)?;
    let _lock = lock_archive_library()?;
    let mut entries = recover_and_list_entries(&library)?;
    entries.sort_by(|left, right| right.imported_at.cmp(&left.imported_at));
    Ok(entries)
}

#[typed_tauri_command::command]
pub(crate) fn room_archive_open(
    request: ArchiveOpenRequest,
    app: tauri::AppHandle,
) -> crate::command_error::CommandResult<ArchiveOpened> {
    validate_archive_id(&request.archive_id)?;
    validate_passphrase(&request.passphrase)?;
    let library = library_dir(&app)?;
    let _lock = lock_archive_library()?;
    let entry = read_entry(&library, &request.archive_id)?;
    let encrypted =
        safe_read(&library.join(format!("{}.{}", request.archive_id, ARCHIVE_EXTENSION)))?;
    let archive = open_archive_bytes(&encrypted, &request.passphrase)?;
    Ok(ArchiveOpened { entry, archive })
}

#[typed_tauri_command::command]
pub(crate) fn room_archive_delete(
    request: ArchiveDeleteRequest,
    app: tauri::AppHandle,
) -> crate::command_error::CommandResult<()> {
    validate_archive_id(&request.archive_id)?;
    let library = library_dir(&app)?;
    let _lock = lock_archive_library()?;
    // Remove discoverability first. A crash or failure before the ciphertext removal leaves an
    // orphan that recovery can safely discard, never a visible entry that cannot be opened.
    remove_if_regular(&library.join(format!("{}.json", request.archive_id)))?;
    remove_if_regular(&library.join(format!("{}.{}", request.archive_id, ARCHIVE_EXTENSION)))?;
    Ok(())
}

fn lock_archive_library() -> Result<MutexGuard<'static, ()>, String> {
    ARCHIVE_LIBRARY_LOCK
        .lock()
        .map_err(|_| "Archive library lock is unavailable.".to_string())
}

fn persist_import<F>(
    library: &Path,
    id: &str,
    encrypted: Vec<u8>,
    archive: ArchiveBody,
    write_metadata: F,
) -> Result<ArchiveOpened, String>
where
    F: FnOnce(&Path, &ArchiveLibraryEntry) -> Result<(), String>,
{
    validate_archive_id(id)?;
    let ciphertext_path = library.join(format!("{id}.{ARCHIVE_EXTENSION}"));
    safe_write(&ciphertext_path, &encrypted)?;
    let entry = entry_for(id, &archive, encrypted.len() as u64);
    if let Err(error) = write_metadata(library, &entry) {
        return match remove_if_regular(&ciphertext_path) {
            Ok(()) => Err(error),
            Err(_) => Err(format!(
                "{error} The incomplete archive could not be rolled back; reopen the archive library to retry recovery."
            )),
        };
    }
    Ok(ArchiveOpened { entry, archive })
}

fn seal_archive(mut archive: ArchiveBody, passphrase: &str) -> Result<Vec<u8>, String> {
    validate_passphrase(passphrase)?;
    normalize_and_validate(&mut archive)?;
    let envelope = ArchiveEnvelope {
        payload_sha256: archive_hash(&archive)?,
        body: archive,
    };
    let plaintext =
        serde_json::to_vec(&envelope).map_err(|_| "Archive could not be encoded.".to_string())?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err("Archive exceeds the 12 MiB plaintext limit.".to_string());
    }
    let encryptor = age::Encryptor::with_user_passphrase(SecretString::from(passphrase.to_owned()));
    let mut encrypted = Vec::new();
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .map_err(|_| "Archive encryption failed.".to_string())?;
    writer
        .write_all(&plaintext)
        .map_err(|_| "Archive encryption failed.".to_string())?;
    writer
        .finish()
        .map_err(|_| "Archive encryption failed.".to_string())?;
    if encrypted.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Encrypted archive exceeds the 16 MiB limit.".to_string());
    }
    Ok(encrypted)
}

fn open_archive_bytes(encrypted: &[u8], passphrase: &str) -> Result<ArchiveBody, String> {
    validate_passphrase(passphrase)?;
    if encrypted.is_empty() || encrypted.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Archive is empty or exceeds the 16 MiB limit.".to_string());
    }
    let decryptor =
        age::Decryptor::new(encrypted).map_err(|_| "Archive format is invalid.".to_string())?;
    let identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_owned()));
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| "Archive passphrase is incorrect or the file was modified.".to_string())?;
    let mut plaintext = Vec::new();
    reader
        .by_ref()
        .take((MAX_PLAINTEXT_BYTES + 1) as u64)
        .read_to_end(&mut plaintext)
        .map_err(|_| "Archive passphrase is incorrect or the file was modified.".to_string())?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err("Archive exceeds the 12 MiB plaintext limit.".to_string());
    }
    let mut envelope: ArchiveEnvelope = serde_json::from_slice(&plaintext)
        .map_err(|_| "Archive payload is invalid.".to_string())?;
    normalize_and_validate(&mut envelope.body)?;
    let digest = archive_hash(&envelope.body)?;
    if digest != envelope.payload_sha256 {
        return Err("Archive integrity check failed.".to_string());
    }
    Ok(envelope.body)
}

fn normalize_and_validate(archive: &mut ArchiveBody) -> Result<(), String> {
    if archive.version != ARCHIVE_VERSION {
        return Err(format!(
            "Unsupported room archive version {}.",
            archive.version
        ));
    }
    archive.source.room_name = bounded_text(&archive.source.room_name, "room name", 200)?;
    archive.source.team_name = archive
        .source
        .team_name
        .as_deref()
        .map(|value| bounded_text(value, "team name", 200))
        .transpose()?;
    if archive.exported_at.len() > 64
        || chrono::DateTime::parse_from_rfc3339(&archive.exported_at).is_err()
    {
        return Err("Archive export timestamp is invalid.".to_string());
    }
    if archive.omissions.is_empty() || archive.omissions.len() > 32 {
        return Err("Archive omission manifest is invalid.".to_string());
    }
    for omission in &archive.omissions {
        bounded_text(omission, "omission", 160)?;
    }
    if archive.history.version != 1 {
        return Err("Unsupported archive history version.".to_string());
    }
    let history = serde_json::to_value(&archive.history)
        .map_err(|_| "Archive history could not be validated.".to_string())?;
    validate_json_shape(&history, 0, &mut 0)?;
    Ok(())
}

fn validate_json_shape(value: &Value, depth: usize, nodes: &mut usize) -> Result<(), String> {
    *nodes += 1;
    if depth > 16 || *nodes > 100_000 {
        return Err("Archive history is too deeply nested or complex.".to_string());
    }
    match value {
        Value::String(text) if text.len() > 2 * 1024 * 1024 => {
            Err("Archive contains an oversized text value.".to_string())
        }
        Value::Array(values) if values.len() > 20_000 => {
            Err("Archive contains too many list entries.".to_string())
        }
        Value::Array(values) => values
            .iter()
            .try_for_each(|value| validate_json_shape(value, depth + 1, nodes)),
        Value::Object(values) if values.len() > 128 => {
            Err("Archive contains an oversized object.".to_string())
        }
        Value::Object(values) => values
            .values()
            .try_for_each(|value| validate_json_shape(value, depth + 1, nodes)),
        _ => Ok(()),
    }
}

fn archive_hash(archive: &ArchiveBody) -> Result<String, String> {
    let encoded =
        serde_json::to_vec(archive).map_err(|_| "Archive could not be hashed.".to_string())?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}

fn validate_passphrase(passphrase: &str) -> Result<(), String> {
    if passphrase.len() < MIN_PASSPHRASE_BYTES || passphrase.len() > 1024 {
        return Err("Archive passphrase must be between 12 and 1024 bytes.".to_string());
    }
    Ok(())
}

fn bounded_text(value: &str, label: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(format!("Archive {label} is invalid."));
    }
    Ok(value.to_string())
}

fn safe_read(path: &Path) -> Result<Vec<u8>, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "Archive file could not be opened.".to_string())?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_ARCHIVE_BYTES
    {
        return Err(
            "Archive must be a regular file no larger than 16 MiB; symlinks are rejected."
                .to_string(),
        );
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "Archive file could not be opened.".to_string())?;
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take(MAX_ARCHIVE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Archive file could not be read.".to_string())?;
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Archive exceeds the 16 MiB limit.".to_string());
    }
    Ok(bytes)
}

fn safe_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Archive exceeds the 16 MiB limit.".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Archive destination has no parent directory.".to_string())?;
    let parent = parent
        .canonicalize()
        .map_err(|_| "Archive destination directory is unavailable.".to_string())?;
    let target = parent.join(
        path.file_name()
            .ok_or_else(|| "Archive destination is invalid.".to_string())?,
    );
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Archive destination must not be a symlink or special file.".to_string());
        }
    }
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        target
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("archive"),
        uuid::Uuid::new_v4()
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "Archive temporary file could not be created.".to_string())?;
    let result = file
        .write_all(bytes)
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::rename(&temporary, &target));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        return Err("Archive could not be written safely.".to_string());
    }
    secure_permissions(&target)?;
    Ok(())
}

fn library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| "Archive library directory is unavailable.".to_string())?
        .join("room-archives-v1");
    fs::create_dir_all(&path)
        .map_err(|_| "Archive library directory could not be created.".to_string())?;
    secure_permissions(&path)?;
    Ok(path)
}

fn entry_for(id: &str, archive: &ArchiveBody, byte_length: u64) -> ArchiveLibraryEntry {
    ArchiveLibraryEntry {
        id: id.to_string(),
        imported_at: chrono::Utc::now().to_rfc3339(),
        byte_length,
        version: archive.version,
    }
}

fn write_entry(library: &Path, entry: &ArchiveLibraryEntry) -> Result<(), String> {
    let encoded = serde_json::to_vec(entry)
        .map_err(|_| "Archive metadata could not be encoded.".to_string())?;
    safe_write(&library.join(format!("{}.json", entry.id)), &encoded)
}

fn read_entry(library: &Path, id: &str) -> Result<ArchiveLibraryEntry, String> {
    let bytes = safe_read(&library.join(format!("{id}.json")))?;
    serde_json::from_slice(&bytes).map_err(|_| "Archive metadata is invalid.".to_string())
}

fn recover_and_list_entries(library: &Path) -> Result<Vec<ArchiveLibraryEntry>, String> {
    let mut ciphertext_ids = BTreeSet::new();
    let mut metadata_ids = BTreeSet::new();
    for item in
        fs::read_dir(library).map_err(|_| "Archive library could not be read.".to_string())?
    {
        let path = item
            .map_err(|_| "Archive library contains an unreadable entry.".to_string())?
            .path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let artifact = if let Some(id) = name.strip_suffix(&format!(".{ARCHIVE_EXTENSION}")) {
            canonical_archive_id(id).map(|id| (id, true))
        } else if let Some(id) = name.strip_suffix(".json") {
            canonical_archive_id(id).map(|id| (id, false))
        } else {
            None
        };
        let Some((id, is_ciphertext)) = artifact else {
            continue;
        };
        require_regular_library_artifact(&path)?;
        if is_ciphertext {
            ciphertext_ids.insert(id);
        } else {
            metadata_ids.insert(id);
        }
    }

    for id in ciphertext_ids.difference(&metadata_ids) {
        remove_if_regular(&library.join(format!("{id}.{ARCHIVE_EXTENSION}")))?;
    }
    for id in metadata_ids.difference(&ciphertext_ids) {
        remove_if_regular(&library.join(format!("{id}.json")))?;
    }

    let mut entries = Vec::new();
    for id in ciphertext_ids.intersection(&metadata_ids) {
        let entry = read_entry(library, id)?;
        if entry.id != *id || entry.version != ARCHIVE_VERSION {
            return Err("Archive library metadata is inconsistent.".to_string());
        }
        let ciphertext = library.join(format!("{id}.{ARCHIVE_EXTENSION}"));
        let byte_length = require_regular_library_artifact(&ciphertext)?;
        if entry.byte_length != byte_length || byte_length > MAX_ARCHIVE_BYTES {
            return Err("Archive library metadata is inconsistent.".to_string());
        }
        entries.push(entry);
    }
    Ok(entries)
}

fn canonical_archive_id(id: &str) -> Option<String> {
    let parsed = uuid::Uuid::parse_str(id).ok()?;
    let canonical = parsed.hyphenated().to_string();
    (id == canonical).then_some(canonical)
}

fn require_regular_library_artifact(path: &Path) -> Result<u64, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err("Archive library entry is not a regular file.".to_string())
        }
        Ok(metadata) => Ok(metadata.len()),
        Err(_) => Err("Archive library entry could not be inspected.".to_string()),
    }
}

fn validate_archive_id(id: &str) -> Result<(), String> {
    canonical_archive_id(id)
        .map(|_| ())
        .ok_or_else(|| "Archive id is invalid.".to_string())
}

fn remove_if_regular(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err("Archive library entry is not a regular file.".to_string())
        }
        Ok(_) => fs::remove_file(path)
            .map_err(|_| "Archive library entry could not be deleted.".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Archive library entry could not be inspected.".to_string()),
    }
}

#[cfg(unix)]
fn secure_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mode = if path.is_dir() { 0o700 } else { 0o600 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|_| "Archive permissions could not be secured.".to_string())
}

#[cfg(not(unix))]
fn secure_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive() -> ArchiveBody {
        ArchiveBody {
            version: 1,
            exported_at: "2026-07-14T12:00:00Z".into(),
            source: ArchiveSource {
                room_name: "Demo".into(),
                team_name: Some("Team".into()),
            },
            omissions: vec!["mls_private_state".into()],
            history: ArchiveHistory {
                version: 1,
                messages: vec![serde_json::json!({"body": "hello"})],
                chat_edits: vec![],
                chat_deletes: vec![],
                terminal_requests: vec![],
                file_save_requests: vec![],
                browser_requests: vec![],
                codex_events: vec![],
                codex_activities: vec![],
                git_workflow_events: vec![],
                github_actions_events: vec![],
                local_previews: vec![],
                terminal_snapshots: vec![],
                room_goal: None,
            },
        }
    }

    #[test]
    fn passphrase_archive_round_trips_and_rejects_wrong_password_or_tampering() {
        let encrypted = seal_archive(archive(), "correct horse battery").unwrap();
        assert_eq!(
            open_archive_bytes(&encrypted, "correct horse battery")
                .unwrap()
                .source
                .room_name,
            "Demo"
        );
        assert!(open_archive_bytes(&encrypted, "wrong password value").is_err());
        let mut tampered = encrypted;
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert!(open_archive_bytes(&tampered, "correct horse battery").is_err());
    }

    #[test]
    fn archive_validation_rejects_versions_bounds_and_symlinks() {
        let mut unsupported = archive();
        unsupported.version = 2;
        assert!(seal_archive(unsupported, "correct horse battery").is_err());
        assert!(seal_archive(archive(), "short").is_err());
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.age");
        fs::write(&real, b"age").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&real, dir.path().join("link.age")).unwrap();
            assert!(safe_read(&dir.path().join("link.age")).is_err());
        }
    }

    #[test]
    fn exported_files_are_owner_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("archive.multai.age");
        safe_write(&path, b"encrypted").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn failed_metadata_write_rolls_back_imported_ciphertext() {
        let dir = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let result = persist_import(
            dir.path(),
            &id,
            b"encrypted archive".to_vec(),
            archive(),
            |_library, _entry| Err("injected metadata failure".to_string()),
        );

        assert_eq!(result.unwrap_err(), "injected metadata failure");
        assert!(!dir
            .path()
            .join(format!("{id}.{ARCHIVE_EXTENSION}"))
            .exists());
        assert!(!dir.path().join(format!("{id}.json")).exists());
    }

    #[test]
    fn library_recovery_removes_partial_pairs_and_preserves_complete_entries() {
        let dir = tempfile::tempdir().unwrap();
        let ciphertext_only = uuid::Uuid::new_v4().to_string();
        let metadata_only = uuid::Uuid::new_v4().to_string();
        let complete = uuid::Uuid::new_v4().to_string();

        safe_write(
            &dir.path()
                .join(format!("{ciphertext_only}.{ARCHIVE_EXTENSION}")),
            b"orphan ciphertext",
        )
        .unwrap();
        write_entry(
            dir.path(),
            &ArchiveLibraryEntry {
                id: metadata_only.clone(),
                imported_at: "2026-07-14T12:00:00Z".into(),
                byte_length: 17,
                version: ARCHIVE_VERSION,
            },
        )
        .unwrap();
        let complete_bytes = b"complete ciphertext";
        safe_write(
            &dir.path().join(format!("{complete}.{ARCHIVE_EXTENSION}")),
            complete_bytes,
        )
        .unwrap();
        write_entry(
            dir.path(),
            &ArchiveLibraryEntry {
                id: complete.clone(),
                imported_at: "2026-07-14T12:00:00Z".into(),
                byte_length: complete_bytes.len() as u64,
                version: ARCHIVE_VERSION,
            },
        )
        .unwrap();

        let entries = recover_and_list_entries(dir.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, complete);
        assert!(!dir
            .path()
            .join(format!("{ciphertext_only}.{ARCHIVE_EXTENSION}"))
            .exists());
        assert!(!dir.path().join(format!("{metadata_only}.json")).exists());
    }

    #[cfg(unix)]
    #[test]
    fn library_recovery_rejects_recognized_symlinks_without_touching_the_target() {
        let dir = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let target = dir.path().join("outside");
        fs::write(&target, b"must remain").unwrap();
        let link = dir.path().join(format!("{id}.{ARCHIVE_EXTENSION}"));
        std::os::unix::fs::symlink(&target, &link).unwrap();

        assert!(recover_and_list_entries(dir.path()).is_err());
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&target).unwrap(), b"must remain");
    }

    #[test]
    fn archive_schema_rejects_authority_fields_and_sidecar_has_no_content_metadata() {
        let mut value = serde_json::to_value(archive()).unwrap();
        value["history"]["mlsGroupState"] = serde_json::json!({"private": "forbidden"});
        assert!(serde_json::from_value::<ArchiveBody>(value).is_err());

        let sidecar = serde_json::to_string(&ArchiveLibraryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            imported_at: "2026-07-14T12:00:00Z".into(),
            byte_length: 123,
            version: 1,
        })
        .unwrap();
        assert!(!sidecar.contains("room_name"));
        assert!(!sidecar.contains("payload_sha"));
        assert!(!sidecar.contains("Demo"));
    }
}
