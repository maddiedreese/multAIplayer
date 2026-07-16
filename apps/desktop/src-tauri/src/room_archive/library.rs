use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};
use tauri::Manager;

use super::{
    ArchiveBody, ArchiveLibraryEntry, ArchiveOpened, ARCHIVE_EXTENSION, ARCHIVE_VERSION,
    MAX_ARCHIVE_BYTES,
};
use crate::atomic_file::atomic_write_private_file;

static ARCHIVE_LIBRARY_LOCK: Mutex<()> = Mutex::new(());

pub(super) fn lock_archive_library() -> Result<MutexGuard<'static, ()>, String> {
    ARCHIVE_LIBRARY_LOCK
        .lock()
        .map_err(|_| "Archive library lock is unavailable.".to_string())
}

pub(super) fn persist_import<F>(
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

pub(super) fn safe_read(path: &Path) -> Result<Vec<u8>, String> {
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

pub(super) fn safe_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
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
    atomic_write_private_file(&target, |file| {
        file.write_all(bytes).map_err(|error| error.to_string())
    })
    .map_err(|_| "Archive could not be written safely.".to_string())?;
    secure_permissions(&target)?;
    Ok(())
}

pub(super) fn library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

pub(super) fn entry_for(id: &str, archive: &ArchiveBody, byte_length: u64) -> ArchiveLibraryEntry {
    ArchiveLibraryEntry {
        id: id.to_string(),
        imported_at: chrono::Utc::now().to_rfc3339(),
        byte_length,
        version: archive.version,
    }
}

pub(super) fn write_entry(library: &Path, entry: &ArchiveLibraryEntry) -> Result<(), String> {
    let encoded = serde_json::to_vec(entry)
        .map_err(|_| "Archive metadata could not be encoded.".to_string())?;
    safe_write(&library.join(format!("{}.json", entry.id)), &encoded)
}

pub(super) fn read_entry(library: &Path, id: &str) -> Result<ArchiveLibraryEntry, String> {
    let bytes = safe_read(&library.join(format!("{id}.json")))?;
    serde_json::from_slice(&bytes).map_err(|_| "Archive metadata is invalid.".to_string())
}

pub(super) fn recover_and_list_entries(library: &Path) -> Result<Vec<ArchiveLibraryEntry>, String> {
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

pub(super) fn validate_archive_id(id: &str) -> Result<(), String> {
    canonical_archive_id(id)
        .map(|_| ())
        .ok_or_else(|| "Archive id is invalid.".to_string())
}

pub(super) fn remove_if_regular(path: &Path) -> Result<(), String> {
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
