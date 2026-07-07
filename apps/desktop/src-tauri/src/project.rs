use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

use crate::output::{bound_git_diff, untracked_file_diff};
use crate::validation::safe_project_path;
use crate::{canonical_project_root, ensure_existing_dir};

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
}

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

#[tauri::command]
pub(crate) fn project_files(
    request: ProjectFileSearchRequest,
) -> Result<Vec<ProjectFileEntry>, String> {
    ensure_existing_dir(&request.cwd)?;
    let root = canonical_project_root(&request.cwd)?;
    let query = request.query.trim().to_lowercase();
    let limit = request.limit.unwrap_or(80).clamp(1, 200);
    let mut results = Vec::new();
    collect_project_files(&root, &root, &query, limit, &mut results)?;
    results.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(results)
}

#[tauri::command]
pub(crate) fn project_file_read(
    request: ProjectFileReadRequest,
) -> Result<ProjectFileContent, String> {
    ensure_existing_dir(&request.cwd)?;
    let root = canonical_project_root(&request.cwd)?;
    let requested = safe_project_path(&root, &request.path)?;
    let metadata = fs::metadata(&requested)
        .map_err(|error| format!("Failed to read file metadata: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", request.path));
    }
    let max_bytes = request.max_bytes.unwrap_or(80_000).clamp(1_024, 250_000);
    let bytes = fs::read(&requested).map_err(|error| format!("Failed to read file: {error}"))?;
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
    })
}

#[tauri::command]
pub(crate) fn git_diff_file(request: GitDiffRequest) -> Result<GitDiffResult, String> {
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
            .to_string());
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
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
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
