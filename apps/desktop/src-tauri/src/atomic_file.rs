use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;

/// Writes and atomically installs an owner-only regular file at `target`.
///
/// This helper owns the complete shared security boundary: it rejects symlink
/// and special-file targets, creates a private temporary file beside the target,
/// syncs it, performs one atomic platform replace, and cleans up on failure.
pub(crate) fn atomic_write_private_file<F>(target: &Path, write: F) -> Result<(), String>
where
    F: FnOnce(&mut File) -> Result<(), String>,
{
    let parent = target
        .parent()
        .ok_or_else(|| "Target file has no parent directory".to_string())?
        .canonicalize()
        .map_err(|error| format!("Failed to resolve target file directory: {error}"))?;
    let target = parent.join(
        target
            .file_name()
            .ok_or_else(|| "Target file name is invalid".to_string())?,
    );
    reject_non_regular_target(&target)?;

    let temporary = parent.join(format!(".multaiplayer-atomic-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // The requested mode contains no group or other bits, and umask can
        // only remove bits. Do not chmod after creation: under a restrictive
        // umask that would widen permissions rather than restrict them.
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| format!("Failed to create private temporary file: {error}"))?;
    let write_result = (|| {
        write(&mut file)?;
        file.flush()
            .map_err(|error| format!("Failed to flush temporary file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Failed to sync temporary file: {error}"))
    })();
    // Windows cannot remove or replace an open file, including error cleanup.
    drop(file);
    let result = write_result.and_then(|_| replace_private_file(&temporary, &target));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn replace_private_file(temporary: &Path, target: &Path) -> Result<(), String> {
    let temporary_parent = temporary
        .parent()
        .ok_or_else(|| "Temporary file has no parent directory".to_string())?
        .canonicalize()
        .map_err(|error| format!("Failed to resolve temporary file directory: {error}"))?;
    let target_parent = target
        .parent()
        .ok_or_else(|| "Target file has no parent directory".to_string())?
        .canonicalize()
        .map_err(|error| format!("Failed to resolve target file directory: {error}"))?;
    if temporary_parent != target_parent {
        return Err("Temporary and target files must share a directory".to_string());
    }

    let temporary_metadata = fs::symlink_metadata(temporary)
        .map_err(|error| format!("Failed to inspect temporary file: {error}"))?;
    if temporary_metadata.file_type().is_symlink() || !temporary_metadata.is_file() {
        return Err("Temporary path must be a regular file, not a symlink".to_string());
    }
    reject_non_regular_target(target)?;
    platform_replace(temporary, target)
}

fn reject_non_regular_target(target: &Path) -> Result<(), String> {
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err("Target path must be a regular file, not a symlink".to_string())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to inspect target file: {error}")),
    }
}

#[cfg(not(windows))]
fn platform_replace(temporary: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temporary, target).map_err(|error| format!("Failed to replace file: {error}"))
}

#[cfg(windows)]
fn platform_replace(temporary: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        REPLACEFILE_WRITE_THROUGH,
    };

    let temporary_wide: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target_wide: Vec<u16> = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target_exists = target.exists();
    // SAFETY: both path buffers are NUL-terminated and remain alive for the call;
    // all optional pointer parameters are null.
    let replaced = unsafe {
        if target_exists {
            ReplaceFileW(
                target_wide.as_ptr(),
                temporary_wide.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_WRITE_THROUGH,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } else {
            MoveFileExW(
                temporary_wide.as_ptr(),
                target_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
    };
    if replaced == 0 {
        return Err(format!(
            "Failed to replace file: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{atomic_write_private_file, replace_private_file};
    use std::fs;
    use std::io::Write;

    #[test]
    fn replaces_existing_regular_file() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target");
        let temporary = directory.path().join("temporary");
        fs::write(&target, b"old").unwrap();
        fs::write(&temporary, b"new").unwrap();

        replace_private_file(&temporary, &target).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(!temporary.exists());
    }

    #[test]
    fn installs_a_new_file() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target");

        atomic_write_private_file(&target, |file| {
            file.write_all(b"new").map_err(|error| error.to_string())
        })
        .unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn cleans_up_when_writing_fails() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target");

        let error = atomic_write_private_file(&target, |_| Err("injected failure".to_string()))
            .unwrap_err();

        assert_eq!(error, "injected failure");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn rejects_a_temporary_file_from_another_directory() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let temporary = first.path().join("temporary");
        let target = second.path().join("target");
        fs::write(&temporary, b"new").unwrap();

        let error = replace_private_file(&temporary, &target).unwrap_err();

        assert!(error.contains("must share a directory"));
        assert!(temporary.exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_target() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let actual = directory.path().join("actual");
        let target = directory.path().join("target");
        let temporary = directory.path().join("temporary");
        fs::write(&actual, b"old").unwrap();
        symlink(&actual, &target).unwrap();
        fs::write(&temporary, b"new").unwrap();

        let error = replace_private_file(&temporary, &target).unwrap_err();

        assert!(error.contains("not a symlink"));
        assert_eq!(fs::read(&actual).unwrap(), b"old");
        assert!(temporary.exists());
    }

    #[cfg(unix)]
    #[test]
    fn creates_the_installed_file_for_its_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target");

        atomic_write_private_file(&target, |file| {
            file.write_all(b"new").map_err(|error| error.to_string())
        })
        .unwrap();

        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode & 0o077, 0, "group/other permissions must be absent");
        assert_eq!(mode & !0o600, 0, "umask may remove but never add mode bits");
    }
}
