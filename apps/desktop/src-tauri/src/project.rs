use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use crate::atomic_file::atomic_write_private_file;
use crate::output::{bound_git_diff, untracked_file_diff};
use crate::validation::safe_project_path;
use crate::workspace::{canonical_project_root, ensure_existing_dir};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectFileEntry {
    pub(crate) path: String,
    pub(crate) size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectFileContent {
    pub(crate) path: String,
    pub(crate) size: u64,
    pub(crate) truncated: bool,
    pub(crate) content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) media_type: Option<String>,
}

// A 2.5 MB binary image becomes about 3.34 MB as a data URL and about 4.45 MB
// after the encrypted envelope is base64 encoded. This stays below the relay's
// default 5 MB ciphertext cap with room for the authenticated envelope metadata.
const MAX_PROJECT_IMAGE_BYTES: u64 = 2_500_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectFileSearchRequest {
    pub(crate) cwd: String,
    pub(crate) query: String,
    pub(crate) limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectFileReadRequest {
    pub(crate) cwd: String,
    pub(crate) path: String,
    pub(crate) max_bytes: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectFileWriteRequest {
    pub(crate) cwd: String,
    pub(crate) path: String,
    pub(crate) content: String,
    pub(crate) expected_content: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectFileWriteResult {
    pub(crate) path: String,
    pub(crate) size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffRequest {
    pub(crate) cwd: String,
    pub(crate) path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffResult {
    pub(crate) path: String,
    pub(crate) diff: String,
}

#[typed_tauri_command::command]
pub(crate) fn project_files(
    request: ProjectFileSearchRequest,
) -> crate::command_error::CommandResult<Vec<ProjectFileEntry>> {
    ensure_existing_dir(&request.cwd)?;
    let root = canonical_project_root(&request.cwd)?;
    let query = request.query.trim().to_lowercase();
    let limit = request.limit.unwrap_or(80).clamp(1, 200);
    let mut results = Vec::new();
    collect_project_files(&root, &root, &query, limit, &mut results)?;
    results.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(results)
}

#[typed_tauri_command::command]
pub(crate) fn project_file_read(
    request: ProjectFileReadRequest,
) -> crate::command_error::CommandResult<ProjectFileContent> {
    ensure_existing_dir(&request.cwd)?;
    let root = canonical_project_root(&request.cwd)?;
    let relative = Path::new(&request.path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(crate::command_error::CommandError::invalid_argument(
            "File path must stay inside the project",
        ));
    }
    match fs::metadata(root.join(relative)) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(crate::command_error::CommandError::not_found(
                "The requested project file was not found",
            ));
        }
        Err(error) => {
            return Err(crate::command_error::CommandError::storage(format!(
                "Failed to read file metadata: {error}"
            )));
        }
    }
    let requested = safe_project_path(&root, &request.path)
        .map_err(crate::command_error::CommandError::invalid_argument)?;
    let metadata = fs::metadata(&requested).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            crate::command_error::CommandError::not_found(
                "The requested project file was not found",
            )
        } else {
            crate::command_error::CommandError::storage(format!(
                "Failed to read file metadata: {error}"
            ))
        }
    })?;
    if !metadata.is_file() {
        return Err(crate::command_error::CommandError::invalid_argument(
            format!("{} is not a file", request.path),
        ));
    }
    let image_extension = project_image_extension(&request.path);
    if image_extension.is_some() && metadata.len() > MAX_PROJECT_IMAGE_BYTES {
        return Err(crate::command_error::CommandError::invalid_argument(
            format!(
                "Image is too large to attach safely ({} bytes; limit {} bytes)",
                metadata.len(),
                MAX_PROJECT_IMAGE_BYTES
            ),
        ));
    }
    let max_bytes = request.max_bytes.unwrap_or(80_000).clamp(1_024, 250_000);
    let bytes = fs::read(&requested).map_err(|error| {
        crate::command_error::CommandError::storage(format!("Failed to read file: {error}"))
    })?;
    if let Some(extension) = image_extension {
        let media_type = verified_project_image_media_type(extension, &bytes)
            .map_err(crate::command_error::CommandError::invalid_argument)?;
        return Ok(ProjectFileContent {
            path: request.path,
            size: metadata.len(),
            truncated: false,
            content: format!(
                "data:{media_type};base64,{}",
                BASE64_STANDARD.encode(&bytes)
            ),
            media_type: Some(media_type.to_string()),
        });
    }
    let truncated = bytes.len() > max_bytes;
    let slice = if truncated {
        &bytes[..max_bytes]
    } else {
        &bytes
    };
    let content = String::from_utf8_lossy(slice).to_string();
    Ok(ProjectFileContent {
        path: request.path,
        size: metadata.len(),
        truncated,
        content,
        media_type: None,
    })
}

fn project_image_extension(path: &str) -> Option<&str> {
    let extension = Path::new(path).extension()?.to_str()?;
    if extension.eq_ignore_ascii_case("png") {
        Some("png")
    } else if extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg") {
        Some("jpeg")
    } else if extension.eq_ignore_ascii_case("gif") {
        Some("gif")
    } else if extension.eq_ignore_ascii_case("webp") {
        Some("webp")
    } else {
        None
    }
}

fn verified_project_image_media_type(
    extension: &str,
    bytes: &[u8],
) -> Result<&'static str, String> {
    let valid = match extension {
        "png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if !valid {
        return Err("Image contents do not match the allowlisted file type".to_string());
    }
    Ok(match extension {
        "png" => "image/png",
        "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("Unsupported image file type".to_string()),
    })
}

#[typed_tauri_command::command]
pub(crate) fn project_file_write(
    request: ProjectFileWriteRequest,
) -> crate::command_error::CommandResult<ProjectFileWriteResult> {
    ensure_existing_dir(&request.cwd)?;
    let root = canonical_project_root(&request.cwd)?;
    let requested = safe_project_write_path(&root, &request.path)
        .map_err(crate::command_error::CommandError::invalid_argument)?;
    if request.content.len() > 1_000_000 {
        return Err(crate::command_error::CommandError::invalid_argument(
            "File content is too large to save from the editor",
        ));
    }
    if let Some(expected) = request.expected_content.as_deref() {
        let current = fs::read(&requested).map_err(|error| {
            crate::command_error::CommandError::storage(format!(
                "Failed to compare current file: {error}"
            ))
        })?;
        if current != expected.as_bytes() {
            return Err(crate::command_error::CommandError::invalid_argument(
                "The file changed after this edit was prepared. Reload it before saving.",
            ));
        }
    }
    atomic_write_project_file(&requested, request.content.as_bytes())
        .map_err(crate::command_error::CommandError::storage)?;
    let metadata = fs::metadata(&requested).map_err(|error| {
        crate::command_error::CommandError::storage(format!(
            "Failed to read saved file metadata: {error}"
        ))
    })?;
    Ok(ProjectFileWriteResult {
        path: request.path,
        size: metadata.len(),
    })
}

fn atomic_write_project_file(path: &Path, content: &[u8]) -> Result<(), String> {
    atomic_write_private_file(path, |file| {
        file.write_all(content)
            .map_err(|error| format!("Failed to write temporary project file: {error}"))
    })
}

fn safe_project_write_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    if relative_path.trim() != relative_path || relative_path.trim().is_empty() {
        return Err("File path must stay inside the project".to_string());
    }
    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        return Err("File path must stay inside the project".to_string());
    }
    let mut normalized = PathBuf::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            _ => return Err("File path must stay inside the project".to_string()),
        }
    }
    let requested = root.join(&normalized);
    if requested.exists() {
        return safe_project_path(root, relative_path);
    }
    let parent = requested
        .parent()
        .ok_or_else(|| "File path must stay inside the project".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create file directory: {error}"))?;
    let parent = fs::canonicalize(parent)
        .map_err(|error| format!("Failed to resolve file directory: {error}"))?;
    if !parent.starts_with(root) {
        return Err("File path must stay inside the project".to_string());
    }
    Ok(parent.join(
        normalized
            .file_name()
            .ok_or_else(|| "File path must stay inside the project".to_string())?,
    ))
}

#[typed_tauri_command::command]
pub(crate) fn git_diff_file(
    request: GitDiffRequest,
) -> crate::command_error::CommandResult<GitDiffResult> {
    ensure_existing_dir(&request.cwd)?;
    let root = canonical_project_root(&request.cwd)?;
    let requested = safe_project_path(&root, &request.path)?;

    let status_output = Command::new("git")
        .args([
            "-C",
            &request.cwd,
            "status",
            "--porcelain=v1",
            "--",
            &request.path,
        ])
        .output()
        .map_err(|error| format!("Failed to run git status: {error}"))?;
    if !status_output.status.success() {
        return Err(String::from_utf8_lossy(&status_output.stderr)
            .trim()
            .to_string()
            .into());
    }

    let status = String::from_utf8_lossy(&status_output.stdout);
    let untracked = status.lines().any(|line| line.starts_with("??"));
    if untracked {
        let diff = untracked_file_diff(&requested, &request.path)?;
        return Ok(GitDiffResult {
            path: request.path,
            diff,
        });
    }

    let output = Command::new("git")
        .args(["-C", &request.cwd, "diff", "--", &request.path])
        .output()
        .map_err(|error| format!("Failed to run git diff: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .trim()
            .to_string()
            .into());
    }

    Ok(GitDiffResult {
        path: request.path,
        diff: bound_git_diff(&String::from_utf8_lossy(&output.stdout)),
    })
}

pub(crate) fn collect_project_files(
    root: &Path,
    dir: &Path,
    query: &str,
    limit: usize,
    results: &mut Vec<ProjectFileEntry>,
) -> Result<(), String> {
    if results.len() >= limit {
        return Ok(());
    }
    let entries =
        fs::read_dir(dir).map_err(|error| format!("Failed to read project directory: {error}"))?;
    for entry in entries {
        if results.len() >= limit {
            break;
        }
        let entry = entry.map_err(|error| format!("Failed to read project entry: {error}"))?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if should_skip_project_entry(&file_name) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to read project entry type: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Failed to read project entry metadata: {error}"))?;
        if metadata.is_dir() {
            collect_project_files(root, &path, query, limit, results)?;
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("Failed to resolve relative path: {error}"))?
            .to_string_lossy()
            .replace('\\', "/");
        if query.is_empty() || relative.to_lowercase().contains(query) {
            results.push(ProjectFileEntry {
                path: relative,
                size: metadata.len(),
            });
        }
    }
    Ok(())
}

fn should_skip_project_entry(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | ".next"
            | ".turbo"
            | ".cache"
            | ".DS_Store"
            | "Cargo.lock"
            | "package-lock.json"
    )
}
