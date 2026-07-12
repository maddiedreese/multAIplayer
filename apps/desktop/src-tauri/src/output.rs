use std::fs;
use std::io::Read;
use std::path::Path;

use crate::validation::{MAX_COMMAND_OUTPUT_CHARS, MAX_GIT_DIFF_CHARS};
use regex::Regex;
use std::sync::LazyLock;

const REDACTION_FAILURE: &str = "[REDACTED BY MULTAIPLAYER: redaction unavailable]";

static SECRET_PATTERNS: LazyLock<Result<Vec<Regex>, regex::Error>> = LazyLock::new(|| {
    [
        r"ghp_[A-Za-z0-9_]{20,}",
        r"github_pat_[A-Za-z0-9_]{20,}",
        r"sk-[A-Za-z0-9_-]{20,}",
        r"(?im)^([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*([^\r\n]+)",
        r"(?s)-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----.*?-----END (?:RSA |OPENSSH |EC )?PRIVATE KEY-----",
    ]
    .into_iter()
    .map(Regex::new)
    .collect()
});

pub(crate) fn redact_known_secrets(text: &str) -> String {
    redact_with_patterns(text, SECRET_PATTERNS.as_ref().map(Vec::as_slice))
}

fn redact_with_patterns(text: &str, patterns: Result<&[Regex], &regex::Error>) -> String {
    let Ok(patterns) = patterns else {
        return REDACTION_FAILURE.to_string();
    };
    patterns.iter().fold(text.to_string(), |value, pattern| {
        pattern
            .replace_all(&value, |captures: &regex::Captures<'_>| {
                if captures.len() > 2 {
                    format!("{}=[REDACTED BY MULTAIPLAYER]", &captures[1])
                } else {
                    "[REDACTED BY MULTAIPLAYER]".to_string()
                }
            })
            .into_owned()
    })
}

pub(crate) fn untracked_file_diff(path: &Path, display_path: &str) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("Failed to read untracked file: {error}"))?;
    let max_bytes = MAX_GIT_DIFF_CHARS.saturating_add(1);
    let mut buffer = Vec::with_capacity(max_bytes.min(64 * 1024));
    Read::by_ref(&mut file)
        .take(max_bytes as u64)
        .read_to_end(&mut buffer)
        .map_err(|error| format!("Failed to read untracked file: {error}"))?;
    let truncated = buffer.len() > MAX_GIT_DIFF_CHARS;
    if truncated {
        buffer.truncate(MAX_GIT_DIFF_CHARS);
    }
    let content = String::from_utf8_lossy(&buffer);
    let diff = std::iter::once(format!("+++ b/{display_path}"))
        .chain(content.lines().map(|line| format!("+{line}")))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(bound_git_diff(&diff))
}

pub(crate) fn normalize_no_index_patch(diff: &str, display_path: &str) -> String {
    diff.lines()
        .map(|line| {
            if line.starts_with("diff --git ") {
                format!("diff --git a/{display_path} b/{display_path}")
            } else if line.starts_with("+++ ") {
                format!("+++ b/{display_path}")
            } else if line.starts_with("--- ") {
                "--- /dev/null".to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn bound_git_diff(diff: &str) -> String {
    let marker = "\n\n[multAIplayer truncated this diff to fit the desktop diff viewer limit.]\n";
    bound_text_chars(diff, MAX_GIT_DIFF_CHARS, marker)
}

pub(crate) fn bound_command_output(output: &[u8]) -> String {
    let text = String::from_utf8_lossy(output);
    let marker = "\n\n[multAIplayer truncated command output to fit the desktop output limit.]\n";
    bound_text_chars(&text, MAX_COMMAND_OUTPUT_CHARS, marker)
}

pub(crate) fn bound_text_chars(text: &str, max_chars: usize, marker: &str) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let marker_chars = marker.chars().count();
    if max_chars <= marker_chars {
        return marker.chars().take(max_chars).collect();
    }
    let keep_chars = max_chars - marker_chars;
    let head_chars = keep_chars / 2;
    let tail_chars = keep_chars - head_chars;
    let head = text.chars().take(head_chars).collect::<String>();
    let tail = text
        .chars()
        .rev()
        .take(tail_chars)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("{head}{marker}{tail}")
}

pub(crate) fn git_status_label(code: &str) -> String {
    if code.contains('?') {
        "untracked".to_string()
    } else if code.contains('A') {
        "added".to_string()
    } else if code.contains('D') {
        "deleted".to_string()
    } else if code.contains('R') {
        "renamed".to_string()
    } else {
        "modified".to_string()
    }
}

#[cfg(test)]
mod redaction_failure_tests {
    use super::*;

    #[test]
    fn regex_compilation_failure_redacts_the_entire_value() {
        let invalid_pattern = String::from("(");
        let invalid = Regex::new(&invalid_pattern);
        assert_eq!(
            redact_with_patterns(
                "ghp_this-must-never-be-reflected",
                invalid.as_ref().map(|_| &[][..])
            ),
            REDACTION_FAILURE
        );
    }
}
