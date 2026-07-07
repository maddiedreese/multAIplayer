use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::output::{
    bound_command_output, bound_text_chars, git_status_label, normalize_no_index_patch,
};
use crate::validation::{
    ensure_git_patch, ensure_git_remote_url, ensure_safe_branch_name, normalize_commit_message,
    repo_name_from_remote_url, safe_project_path, MAX_GIT_PATCH_CHARS,
};
use crate::{canonical_project_root, ensure_existing_dir};

use crate::shell::CommandResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatusFile {
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) added: u32,
    pub(crate) removed: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatusSummary {
    pub(crate) branch: String,
    pub(crate) files: Vec<GitStatusFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRemoteInfo {
    origin_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitPatchResult {
    pub(crate) patch: String,
    pub(crate) truncated: bool,
    dirty_files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCloneResult {
    path: String,
    command: String,
    status: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitApplyPatchResult {
    command: String,
    cwd: String,
    pub(crate) status: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCloneRequest {
    remote_url: String,
    parent_dir: String,
    branch: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitApplyPatchRequest {
    pub(crate) cwd: String,
    pub(crate) patch: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitWorkflowRequest {
    cwd: String,
    branch: String,
    message: String,
    push: bool,
}

#[tauri::command]
pub(crate) fn git_status(cwd: String) -> Result<GitStatusSummary, String> {
    ensure_existing_dir(&cwd)?;

    let branch_output = Command::new("git")
        .args(["-C", &cwd, "branch", "--show-current"])
        .output()
        .map_err(|error| format!("Failed to run git branch: {error}"))?;

    let status_output = Command::new("git")
        .args(["-C", &cwd, "status", "--porcelain=v1"])
        .output()
        .map_err(|error| format!("Failed to run git status: {error}"))?;

    if !status_output.status.success() {
        return Err(String::from_utf8_lossy(&status_output.stderr)
            .trim()
            .to_string());
    }

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    let mut files = Vec::new();
    for line in String::from_utf8_lossy(&status_output.stdout).lines() {
        if line.len() < 4 {
            continue;
        }
        let code = &line[0..2];
        let path = line[3..].to_string();
        files.push(GitStatusFile {
            path,
            status: git_status_label(code),
            added: if code.contains('A') || code.contains('?') {
                1
            } else {
                0
            },
            removed: if code.contains('D') { 1 } else { 0 },
        });
    }

    Ok(GitStatusSummary {
        branch: if branch.is_empty() {
            "detached".to_string()
        } else {
            branch
        },
        files,
    })
}

#[tauri::command]
pub(crate) fn git_remote_origin(cwd: String) -> Result<GitRemoteInfo, String> {
    ensure_existing_dir(&cwd)?;

    let output = Command::new("git")
        .args(["-C", &cwd, "remote", "get-url", "origin"])
        .output()
        .map_err(|error| format!("Failed to run git remote: {error}"))?;

    if !output.status.success() {
        return Ok(GitRemoteInfo { origin_url: None });
    }

    let origin_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(GitRemoteInfo {
        origin_url: if origin_url.is_empty() {
            None
        } else {
            Some(origin_url)
        },
    })
}

#[tauri::command]
pub(crate) fn git_create_patch(cwd: String) -> Result<GitPatchResult, String> {
    ensure_existing_dir(&cwd)?;
    let status = git_status(cwd.clone())?;
    if status.files.is_empty() {
        return Ok(GitPatchResult {
            patch: String::new(),
            truncated: false,
            dirty_files: Vec::new(),
        });
    }

    let output = Command::new("git")
        .args(["-C", &cwd, "diff", "--binary", "HEAD"])
        .output()
        .map_err(|error| format!("Failed to create git patch: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let mut patch = String::from_utf8_lossy(&output.stdout).to_string();
    for file in status
        .files
        .iter()
        .filter(|file| file.status == "untracked")
    {
        let root = canonical_project_root(&cwd)?;
        let requested = safe_project_path(&root, &file.path)?;
        let output = Command::new("git")
            .args([
                "-C",
                &cwd,
                "diff",
                "--binary",
                "--no-index",
                "--",
                "/dev/null",
            ])
            .arg(&requested)
            .output()
            .map_err(|error| format!("Failed to create untracked file patch: {error}"))?;
        if !output.stdout.is_empty() {
            if !patch.is_empty() && !patch.ends_with('\n') {
                patch.push('\n');
            }
            patch.push_str(&normalize_no_index_patch(
                &String::from_utf8_lossy(&output.stdout),
                &file.path,
            ));
        }
    }

    let truncated = patch.chars().count() > MAX_GIT_PATCH_CHARS;
    Ok(GitPatchResult {
        patch: bound_text_chars(
            &patch,
            MAX_GIT_PATCH_CHARS,
            "\n\n[multAIplayer truncated this handoff patch. Ask the previous host to push or share a patch if needed.]\n",
        ),
        truncated,
        dirty_files: status.files.into_iter().map(|file| file.path).collect(),
    })
}

#[tauri::command]
pub(crate) fn git_clone_repository(request: GitCloneRequest) -> Result<GitCloneResult, String> {
    ensure_git_remote_url(&request.remote_url)?;
    ensure_existing_dir(&request.parent_dir)?;
    if let Some(branch) = request.branch.as_deref() {
        if branch != "detached" {
            ensure_safe_branch_name(branch)?;
        }
    }

    let repo_name = repo_name_from_remote_url(&request.remote_url)?;
    let target = next_available_clone_path(Path::new(&request.parent_dir), &repo_name)?;
    let target_arg = target.to_string_lossy().to_string();
    let mut command = Command::new("git");
    command.arg("clone");
    if let Some(branch) = request.branch.as_deref() {
        if branch != "detached" {
            command.args(["--branch", branch]);
        }
    }
    command.args([&request.remote_url, &target_arg]);
    let output = command
        .output()
        .map_err(|error| format!("Failed to run git clone: {error}"))?;
    Ok(GitCloneResult {
        path: target_arg,
        command: format!("git clone {} {}", request.remote_url, target.display()),
        status: output.status.code(),
        stdout: bound_command_output(&output.stdout),
        stderr: bound_command_output(&output.stderr),
    })
}

#[tauri::command]
pub(crate) fn git_apply_patch(
    request: GitApplyPatchRequest,
) -> Result<GitApplyPatchResult, String> {
    ensure_existing_dir(&request.cwd)?;
    ensure_git_patch(&request.patch)?;
    let mut child = Command::new("git")
        .args(["-C", &request.cwd, "apply", "--whitespace=nowarn", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to run git apply: {error}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(request.patch.as_bytes())
            .map_err(|error| format!("Failed to write handoff patch to git apply: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to read git apply output: {error}"))?;
    Ok(GitApplyPatchResult {
        command: "git apply --whitespace=nowarn -".to_string(),
        cwd: request.cwd,
        status: output.status.code(),
        stdout: bound_command_output(&output.stdout),
        stderr: bound_command_output(&output.stderr),
    })
}

#[tauri::command]
pub(crate) fn run_git_workflow(request: GitWorkflowRequest) -> Result<Vec<CommandResult>, String> {
    ensure_existing_dir(&request.cwd)?;
    ensure_safe_branch_name(&request.branch)?;
    let commit_message = normalize_commit_message(&request.message)?;

    let commands = if request.push {
        vec![
            vec!["switch", "-c", request.branch.as_str()],
            vec!["add", "-A"],
            vec!["commit", "-m", commit_message.as_str()],
            vec!["push", "-u", "origin", request.branch.as_str()],
        ]
    } else {
        vec![
            vec!["switch", "-c", request.branch.as_str()],
            vec!["add", "-A"],
            vec!["commit", "-m", commit_message.as_str()],
        ]
    };

    let mut results = Vec::new();
    for args in commands {
        let output = Command::new("git")
            .current_dir(&request.cwd)
            .args(args.clone())
            .output()
            .map_err(|error| format!("Failed to run git {}: {error}", args.join(" ")))?;
        let result = CommandResult {
            command: format!("git {}", args.join(" ")),
            cwd: request.cwd.clone(),
            status: output.status.code(),
            stdout: bound_command_output(&output.stdout),
            stderr: bound_command_output(&output.stderr),
        };
        let success = output.status.success();
        results.push(result);
        if !success {
            return Ok(results);
        }
    }

    Ok(results)
}

fn next_available_clone_path(parent_dir: &Path, repo_name: &str) -> Result<PathBuf, String> {
    let parent = fs::canonicalize(parent_dir)
        .map_err(|error| format!("Failed to resolve clone parent folder: {error}"))?;
    for index in 0..100 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("-{index}")
        };
        let candidate = parent.join(format!("{repo_name}{suffix}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not find an available clone folder name.".to_string())
}
