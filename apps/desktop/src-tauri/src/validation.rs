use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(crate) const MAX_TERMINAL_COMMAND_CHARS: usize = 4_000;
pub(crate) const MAX_TERMINAL_INPUT_CHARS: usize = 4_000;
pub(crate) const MAX_CODEX_INPUT_CHARS: usize = 240_000;
pub(crate) const MAX_CODEX_THREAD_ID_CHARS: usize = 200;
pub(crate) const MAX_GIT_DIFF_CHARS: usize = 200_000;
pub(crate) const MAX_GIT_PATCH_CHARS: usize = 120_000;
pub(crate) const MAX_COMMAND_OUTPUT_CHARS: usize = 120_000;
pub(crate) const MAX_GIT_BRANCH_CHARS: usize = 200;
pub(crate) const MAX_COMMIT_MESSAGE_CHARS: usize = 500;
pub(crate) const MAX_PROJECT_PATH_CHARS: usize = 2_048;
pub(crate) const MAX_ROOM_ID_CHARS: usize = 160;
pub(crate) const MAX_PREVIEW_ID_CHARS: usize = 160;
pub(crate) const MAX_PREVIEW_URL_CHARS: usize = 2_048;
pub(crate) const MIN_CODEX_TIMEOUT_SECONDS: u64 = 10;
pub(crate) const MAX_CODEX_TIMEOUT_SECONDS: u64 = 900;

pub(crate) fn ensure_project_path(cwd: &str) -> Result<(), String> {
    if cwd.trim().is_empty() {
        return Err("Project path is required".to_string());
    }
    if cwd != cwd.trim() {
        return Err("Project path cannot have leading or trailing whitespace".to_string());
    }
    if cwd.chars().count() > MAX_PROJECT_PATH_CHARS {
        return Err(format!(
            "Project path must be {MAX_PROJECT_PATH_CHARS} characters or fewer"
        ));
    }
    if cwd.chars().any(char::is_control) {
        return Err("Project path cannot contain control characters".to_string());
    }
    if !Path::new(cwd).is_absolute() {
        return Err("Project path must be absolute".to_string());
    }
    Ok(())
}

pub(crate) fn ensure_git_remote_url(remote_url: &str) -> Result<(), String> {
    let trimmed = remote_url.trim();
    if trimmed.is_empty()
        || trimmed != remote_url
        || trimmed.chars().count() > MAX_PROJECT_PATH_CHARS
    {
        return Err("Git remote URL is invalid".to_string());
    }
    if trimmed.chars().any(char::is_control) {
        return Err("Git remote URL cannot contain control characters".to_string());
    }
    if trimmed.starts_with("https://github.com/")
        || trimmed.starts_with("git@github.com:")
        || trimmed.starts_with("ssh://git@github.com/")
    {
        Ok(())
    } else {
        Err("Only GitHub remotes can be cloned from a host handoff.".to_string())
    }
}

pub(crate) fn ensure_git_patch(patch: &str) -> Result<(), String> {
    if patch.trim().is_empty() {
        return Err("Handoff patch is empty".to_string());
    }
    if patch.chars().count() > MAX_GIT_PATCH_CHARS {
        return Err(format!(
            "Handoff patch must be {MAX_GIT_PATCH_CHARS} characters or fewer"
        ));
    }
    if patch.chars().any(|character| character == '\0') {
        return Err("Handoff patch cannot contain null bytes".to_string());
    }
    Ok(())
}

pub(crate) fn repo_name_from_remote_url(remote_url: &str) -> Result<String, String> {
    ensure_git_remote_url(remote_url)?;
    let trimmed = remote_url.trim_end_matches('/');
    let name = trimmed
        .rsplit(['/', ':'])
        .next()
        .unwrap_or("")
        .trim_end_matches(".git");
    if name.is_empty()
        || name.starts_with('.')
        || name.chars().count() > 100
        || !name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err("Git remote repository name is invalid".to_string());
    }
    Ok(name.to_string())
}

pub(crate) fn safe_project_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("File path must stay inside the project".to_string());
    }
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("Failed to resolve project path: {error}"))?;
    let joined = root.join(relative);
    let canonical = fs::canonicalize(&joined)
        .map_err(|error| format!("Failed to resolve file path: {error}"))?;
    if canonical.starts_with(&canonical_root) {
        Ok(canonical)
    } else {
        Err("File path must stay inside the project".to_string())
    }
}

pub(crate) fn ensure_safe_branch_name(branch: &str) -> Result<(), String> {
    let normalized = branch.trim();
    if normalized.is_empty() {
        return Err("Branch name is required".to_string());
    }
    if normalized != branch
        || normalized.chars().count() > MAX_GIT_BRANCH_CHARS
        || normalized.starts_with('-')
        || normalized == "@"
        || normalized.contains("..")
        || normalized.chars().any(char::is_whitespace)
        || normalized.contains('~')
        || normalized.contains('^')
        || normalized.contains(':')
        || normalized.contains('?')
        || normalized.contains('*')
        || normalized.contains('[')
        || normalized.contains('\\')
        || normalized.contains("//")
        || normalized.ends_with('/')
        || normalized.ends_with('.')
        || normalized.contains("@{")
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part.starts_with('.') || part.ends_with(".lock"))
    {
        return Err(format!("Unsafe branch name: {branch}"));
    }
    Ok(())
}

pub(crate) fn normalize_commit_message(message: &str) -> Result<String, String> {
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err("Commit message is required".to_string());
    }
    if normalized.chars().count() > MAX_COMMIT_MESSAGE_CHARS {
        return Err(format!(
            "Commit message must be {MAX_COMMIT_MESSAGE_CHARS} characters or fewer"
        ));
    }
    Ok(normalized)
}

pub(crate) fn ensure_terminal_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Terminal name is required".to_string());
    }
    if name.len() > 48
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(
            "Terminal name can contain letters, numbers, dash, underscore, and period".to_string(),
        );
    }
    Ok(())
}

pub(crate) fn ensure_terminal_command(command: &str) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("Terminal command is required".to_string());
    }
    if command.chars().count() > MAX_TERMINAL_COMMAND_CHARS {
        return Err(format!(
            "Terminal command is too long; limit is {MAX_TERMINAL_COMMAND_CHARS} characters"
        ));
    }
    Ok(())
}

pub(crate) fn ensure_terminal_input(input: &str) -> Result<(), String> {
    if input.is_empty() {
        return Err("Terminal input is required".to_string());
    }
    if input.chars().count() > MAX_TERMINAL_INPUT_CHARS {
        return Err(format!(
            "Terminal input is too long; limit is {MAX_TERMINAL_INPUT_CHARS} characters"
        ));
    }
    Ok(())
}

pub(crate) fn ensure_codex_input(input: &str) -> Result<(), String> {
    if input.trim().is_empty() {
        return Err("Codex input is required".to_string());
    }
    if input.chars().count() > MAX_CODEX_INPUT_CHARS {
        return Err(format!(
            "Codex input is too long; limit is {MAX_CODEX_INPUT_CHARS} characters"
        ));
    }
    Ok(())
}

pub(crate) fn normalize_codex_thread_id(thread_id: Option<&str>) -> Result<Option<String>, String> {
    let Some(thread_id) = thread_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if thread_id.chars().count() > MAX_CODEX_THREAD_ID_CHARS
        || !thread_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
    {
        return Err("Codex thread id contains unsupported characters".to_string());
    }
    Ok(Some(thread_id.to_string()))
}

pub(crate) fn codex_timeout(timeout_seconds: Option<u64>) -> Result<Duration, String> {
    let seconds = timeout_seconds.unwrap_or(180);
    if !(MIN_CODEX_TIMEOUT_SECONDS..=MAX_CODEX_TIMEOUT_SECONDS).contains(&seconds) {
        return Err(format!(
            "Codex timeout must be between {MIN_CODEX_TIMEOUT_SECONDS} and {MAX_CODEX_TIMEOUT_SECONDS} seconds"
        ));
    }
    Ok(Duration::from_secs(seconds))
}

pub(crate) fn validate_browser_url(value: &str) -> Result<tauri::Url, String> {
    let url: tauri::Url = value
        .parse()
        .map_err(|error| format!("Invalid browser URL: {error}"))?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Browser URL scheme is not allowed: {scheme}")),
    }
    if url.host_str().is_none() {
        return Err("Browser URL must include a host".to_string());
    }
    Ok(url)
}

pub(crate) fn validate_local_preview_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_PREVIEW_URL_CHARS {
        return Err("Local preview URL is invalid".to_string());
    }
    let url: tauri::Url = trimmed
        .parse()
        .map_err(|error| format!("Invalid local preview URL: {error}"))?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Local preview URL scheme is not allowed: {scheme}")),
    }
    match url.host_str() {
        Some("localhost") | Some("127.0.0.1") => {}
        _ => return Err("Local previews can only share localhost or 127.0.0.1 URLs.".to_string()),
    }
    if url.port().is_none() {
        return Err("Local preview URL must include a port.".to_string());
    }
    Ok(url.to_string())
}

pub(crate) fn ensure_local_preview_reachable(value: &str) -> Result<(), String> {
    if local_preview_reachable(value) {
        Ok(())
    } else {
        let url: tauri::Url = value
            .parse()
            .map_err(|error| format!("Invalid local preview URL: {error}"))?;
        let host = url
            .host_str()
            .ok_or_else(|| "Local preview URL must include a host.".to_string())?;
        let port = url
            .port()
            .ok_or_else(|| "Local preview URL must include a port.".to_string())?;
        Err(format!("No local web server responded at {host}:{port}."))
    }
}

pub(crate) fn local_preview_reachable(value: &str) -> bool {
    let endpoint = value
        .parse()
        .ok()
        .and_then(|url: tauri::Url| Some((url.host_str()?.to_string(), url.port()?)));
    let Some((host, port)) = endpoint else {
        return false;
    };
    local_port_reachable(&host, port, Duration::from_millis(450))
}

pub(crate) fn local_port_reachable(host: &str, port: u16, timeout: Duration) -> bool {
    match (host, port).to_socket_addrs() {
        Ok(mut addresses) => {
            addresses.any(|address| TcpStream::connect_timeout(&address, timeout).is_ok())
        }
        Err(_) => false,
    }
}

pub(crate) fn ensure_preview_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_PREVIEW_ID_CHARS {
        return Err("Local preview id is invalid".to_string());
    }
    if !id.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || character == '-'
            || character == '_'
            || character == ':'
    }) {
        return Err("Local preview id contains unsupported characters".to_string());
    }
    Ok(())
}

pub(crate) fn ensure_room_id(room_id: &str) -> Result<(), String> {
    if room_id.is_empty() || room_id.len() > MAX_ROOM_ID_CHARS {
        return Err("room id is invalid".to_string());
    }
    if !room_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("room id contains unsupported characters".to_string());
    }
    Ok(())
}

pub(crate) fn ensure_terminal_id(id: &str) -> Result<(), String> {
    let Some((room_id, terminal_name)) = id.split_once(':') else {
        return Err("terminal id is invalid".to_string());
    };
    if terminal_name.contains(':') {
        return Err("terminal id is invalid".to_string());
    }
    ensure_room_id(room_id)?;
    ensure_terminal_name(terminal_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    type StringValidator = fn(&str) -> Result<(), String>;

    #[test]
    fn project_path_rejects_empty_whitespace_relative_and_control_characters() {
        for invalid in ["", "   ", " /tmp/project", "/tmp/project ", "project"] {
            assert!(
                ensure_project_path(invalid).is_err(),
                "accepted {invalid:?}"
            );
        }
        for control in ['\0', '\t', '\n', '\r'] {
            let path = format!("/tmp/pro{control}ject");
            assert!(ensure_project_path(&path).is_err(), "accepted {path:?}");
        }
    }

    #[test]
    fn project_path_length_counts_characters_not_bytes() {
        let at_limit = format!("/{}", "é".repeat(MAX_PROJECT_PATH_CHARS - 1));
        assert_eq!(at_limit.chars().count(), MAX_PROJECT_PATH_CHARS);
        assert!(at_limit.len() > MAX_PROJECT_PATH_CHARS);
        assert!(ensure_project_path(&at_limit).is_ok());

        let over_limit = format!("{at_limit}é");
        assert!(ensure_project_path(&over_limit).is_err());
    }

    #[test]
    fn project_path_allows_parent_segments_for_later_filesystem_resolution() {
        assert!(ensure_project_path("/tmp/project/../other").is_ok());
    }

    #[test]
    fn character_count_limits_accept_boundary_and_reject_next_character() {
        let cases: &[(usize, StringValidator, &str)] = &[
            (MAX_TERMINAL_COMMAND_CHARS, ensure_terminal_command, "x"),
            (MAX_TERMINAL_INPUT_CHARS, ensure_terminal_input, "x"),
            (MAX_CODEX_INPUT_CHARS, ensure_codex_input, "x"),
            (MAX_GIT_PATCH_CHARS, ensure_git_patch, "x"),
        ];

        for &(limit, validator, prefix) in cases {
            let at_limit = prefix.repeat(limit);
            assert!(validator(&at_limit).is_ok(), "rejected limit {limit}");
            let over_limit = format!("{at_limit}x");
            assert!(
                validator(&over_limit).is_err(),
                "accepted limit + 1 ({limit})"
            );
        }
    }

    #[test]
    fn specialized_length_limits_accept_boundary_and_reject_next_character() {
        let thread_at_limit = "a".repeat(MAX_CODEX_THREAD_ID_CHARS);
        assert!(normalize_codex_thread_id(Some(&thread_at_limit)).is_ok());
        assert!(normalize_codex_thread_id(Some(&format!("{thread_at_limit}a"))).is_err());

        let branch_at_limit = "a".repeat(MAX_GIT_BRANCH_CHARS);
        assert!(ensure_safe_branch_name(&branch_at_limit).is_ok());
        assert!(ensure_safe_branch_name(&format!("{branch_at_limit}a")).is_err());

        let commit_at_limit = "a".repeat(MAX_COMMIT_MESSAGE_CHARS);
        assert!(normalize_commit_message(&commit_at_limit).is_ok());
        assert!(normalize_commit_message(&format!("{commit_at_limit}a")).is_err());

        let preview_id_at_limit = "a".repeat(MAX_PREVIEW_ID_CHARS);
        assert!(ensure_preview_id(&preview_id_at_limit).is_ok());
        assert!(ensure_preview_id(&format!("{preview_id_at_limit}a")).is_err());

        let room_id_at_limit = "a".repeat(MAX_ROOM_ID_CHARS);
        assert!(ensure_room_id(&room_id_at_limit).is_ok());
        assert!(ensure_room_id(&format!("{room_id_at_limit}a")).is_err());
    }

    #[test]
    fn byte_count_limits_accept_boundary_and_reject_next_byte() {
        let preview_at_limit = format!(
            "http://localhost:8000/{}",
            "a".repeat(MAX_PREVIEW_URL_CHARS - "http://localhost:8000/".len())
        );
        assert_eq!(preview_at_limit.len(), MAX_PREVIEW_URL_CHARS);
        assert!(validate_local_preview_url(&preview_at_limit).is_ok());
        assert!(validate_local_preview_url(&format!("{preview_at_limit}a")).is_err());
    }

    #[test]
    fn project_path_and_remote_url_share_their_documented_limit() {
        let project_at_limit = format!("/{}", "a".repeat(MAX_PROJECT_PATH_CHARS - 1));
        assert!(ensure_project_path(&project_at_limit).is_ok());
        assert!(ensure_project_path(&format!("{project_at_limit}a")).is_err());

        let prefix = "https://github.com/";
        let remote_at_limit = format!(
            "{prefix}{}",
            "a".repeat(MAX_PROJECT_PATH_CHARS - prefix.len())
        );
        assert!(ensure_git_remote_url(&remote_at_limit).is_ok());
        assert!(ensure_git_remote_url(&format!("{remote_at_limit}a")).is_err());
    }

    #[test]
    fn codex_timeout_accepts_bounds_and_rejects_values_outside_them() {
        assert_eq!(codex_timeout(None).unwrap(), Duration::from_secs(180));
        assert_eq!(
            codex_timeout(Some(MIN_CODEX_TIMEOUT_SECONDS)).unwrap(),
            Duration::from_secs(MIN_CODEX_TIMEOUT_SECONDS)
        );
        assert_eq!(
            codex_timeout(Some(MAX_CODEX_TIMEOUT_SECONDS)).unwrap(),
            Duration::from_secs(MAX_CODEX_TIMEOUT_SECONDS)
        );
        assert!(codex_timeout(Some(MIN_CODEX_TIMEOUT_SECONDS - 1)).is_err());
        assert!(codex_timeout(Some(MAX_CODEX_TIMEOUT_SECONDS + 1)).is_err());
    }
}
