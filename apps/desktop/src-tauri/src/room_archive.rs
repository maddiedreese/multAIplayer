use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

mod codec;
mod library;

use codec::{open_archive_bytes, seal_archive, validate_passphrase};
use library::{
    entry_for, library_dir, lock_archive_library, persist_import, read_entry,
    recover_and_list_entries, remove_if_regular, safe_read, safe_write, validate_archive_id,
    write_entry,
};

pub(super) const ARCHIVE_VERSION: u8 = 1;
pub(super) const MAX_ARCHIVE_BYTES: u64 = 16 * 1024 * 1024;
pub(super) const MAX_ARCHIVES: usize = 100;
pub(super) const ARCHIVE_EXTENSION: &str = "multai.age";

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
