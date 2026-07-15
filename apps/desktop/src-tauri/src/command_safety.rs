use serde_json::Value;
use std::path::{Component, Path};

const NETWORK_TOOLS: &[&str] = &[
    "curl", "wget", "ssh", "scp", "sftp", "ftp", "nc", "ncat", "netcat", "telnet", "ping", "dig",
    "nslookup", "host", "gh", "npx", "docker", "podman", "kubectl", "aws", "gcloud", "az",
];

const CREDENTIAL_MARKERS: &[&str] = &[
    ".env",
    ".npmrc",
    ".pypirc",
    ".netrc",
    ".git-credentials",
    ".gitconfig",
    "id_rsa",
    "id_ed25519",
    ".ssh/",
    ".aws/credentials",
    ".config/gcloud/",
    ".kube/config",
    "credentials.json",
    "service-account",
    "keychain",
    "login.keychain",
    "secrets.",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CommandReviewRisk {
    CredentialAccess,
    NetworkAccess,
}

/// Classifies command text for the approval UI. This is deliberately not an
/// authorization decision: arbitrary programs and interpreters make it
/// impossible to prove capabilities from a shell string.
pub(crate) fn command_review_risk(command: &str) -> Option<CommandReviewRisk> {
    let normalized = command.to_ascii_lowercase().replace('\\', "/");
    if CREDENTIAL_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some(CommandReviewRisk::CredentialAccess);
    }
    let words = normalized
        .split(|character: char| {
            !(character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.'))
        })
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    let explicit_network_tool = words.iter().any(|word| NETWORK_TOOLS.contains(word));
    let network_subcommand = words.windows(2).any(|pair| match pair {
        ["git", action] => matches!(
            *action,
            "clone" | "fetch" | "pull" | "push" | "ls-remote" | "submodule"
        ),
        [tool @ ("npm" | "pnpm" | "yarn"), action] => {
            let _ = tool;
            matches!(
                *action,
                "install" | "add" | "publish" | "login" | "whoami" | "audit" | "update"
            )
        }
        [tool @ ("pip" | "pip3"), action] => {
            let _ = tool;
            matches!(*action, "install" | "download" | "index")
        }
        ["cargo", action] => matches!(*action, "install" | "publish" | "search" | "login"),
        ["go", action] => matches!(*action, "get" | "install"),
        _ => false,
    });
    if explicit_network_tool || network_subcommand {
        return Some(CommandReviewRisk::NetworkAccess);
    }
    None
}

pub(crate) fn enforced_permission_denial(
    method: &str,
    params: &Value,
    approved_project_root: Option<&Path>,
) -> Option<&'static str> {
    if method == "item/permissions/requestApproval" {
        let permissions = params.get("permissions")?;
        if permissions
            .pointer("/network/enabled")
            .and_then(Value::as_bool)
            == Some(true)
        {
            return Some("Network permission requests are denied by host policy");
        }
        if !filesystem_permissions_within_project(permissions, approved_project_root) {
            return Some("File permission requests outside the approved project root are denied by host policy");
        }
    }
    None
}

fn permission_path_is_within_project(path: &str, approved_project_root: Option<&Path>) -> bool {
    let Some(approved_project_root) = approved_project_root else {
        return false;
    };
    let Ok(canonical_root) = approved_project_root.canonicalize() else {
        return false;
    };
    let requested = Path::new(path);
    if path.trim().is_empty()
        || path == "~"
        || path.starts_with("~/")
        || path.starts_with("~\\")
        || requested
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return false;
    }
    let requested = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        canonical_root.join(requested)
    };

    // A permission may name a file that does not exist yet. Canonicalize its
    // nearest existing ancestor so symlink aliases cannot escape the root,
    // while still allowing creation beneath a real in-project directory.
    let mut existing_ancestor = requested.as_path();
    while !existing_ancestor.exists() {
        let Some(parent) = existing_ancestor.parent() else {
            return false;
        };
        existing_ancestor = parent;
    }
    let Ok(canonical_ancestor) = existing_ancestor.canonicalize() else {
        return false;
    };
    canonical_ancestor.starts_with(&canonical_root)
}

fn filesystem_permissions_within_project(
    permissions: &Value,
    approved_project_root: Option<&Path>,
) -> bool {
    let Some(file_system) = permissions.get("fileSystem") else {
        return true;
    };
    let Some(file_system) = file_system.as_object() else {
        return false;
    };
    for key in ["read", "write"] {
        let Some(value) = file_system.get(key) else {
            continue;
        };
        let Some(paths) = value.as_array() else {
            return false;
        };
        if !paths.iter().all(|value| {
            value
                .as_str()
                .is_some_and(|path| permission_path_is_within_project(path, approved_project_root))
        }) {
            return false;
        }
    }
    let Some(value) = file_system.get("entries") else {
        return true;
    };
    let Some(entries) = value.as_array() else {
        return false;
    };
    entries.iter().all(|entry| {
        if entry.get("access").and_then(Value::as_str) == Some("deny") {
            return true;
        }
        entry
            .pointer("/path/type")
            .and_then(Value::as_str)
            .filter(|kind| *kind == "path")
            .and_then(|_| entry.pointer("/path/path").and_then(Value::as_str))
            .is_some_and(|path| permission_path_is_within_project(path, approved_project_root))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use serde_json::json;

    fn vary_ascii_case(value: &str, uppercase: &[bool]) -> String {
        value
            .chars()
            .enumerate()
            .map(|(index, character)| {
                if uppercase[index % uppercase.len()] {
                    character.to_ascii_uppercase()
                } else {
                    character
                }
            })
            .collect()
    }

    #[test]
    fn classifies_command_text_as_review_signals_not_authority() {
        assert_eq!(
            command_review_risk("curl https://example.com"),
            Some(CommandReviewRisk::NetworkAccess)
        );
        assert_eq!(
            command_review_risk("git push origin main"),
            Some(CommandReviewRisk::NetworkAccess)
        );
        assert_eq!(
            command_review_risk("cat ~/.aws/credentials"),
            Some(CommandReviewRisk::CredentialAccess)
        );
        assert_eq!(
            command_review_risk("npm install"),
            Some(CommandReviewRisk::NetworkAccess)
        );
        assert_eq!(command_review_risk("npm test"), None);
        assert_eq!(command_review_risk("cargo fmt --check"), None);
        assert_eq!(command_review_risk("rg TODO src"), None);
        // No completeness claim: interpreters and arbitrary programs can acquire capabilities
        // without naming them in command text.
        assert_eq!(command_review_risk("python -c 'import socket'"), None);
        assert_eq!(command_review_risk("./opaque-script"), None);
        for command in [
            "pip install unsafe-package",
            "pip3 download unsafe-package",
            "cargo search unsafe-package",
            "go get example.invalid/package",
        ] {
            assert!(
                command_review_risk(command).is_some(),
                "did not flag {command}"
            );
        }
    }

    #[test]
    fn denies_explicit_network_and_unscoped_file_permission_requests() {
        assert!(enforced_permission_denial(
            "item/permissions/requestApproval",
            &json!({"permissions": {"network": {"enabled": true}}}),
            None,
        )
        .is_some());
        assert!(enforced_permission_denial(
            "item/permissions/requestApproval",
            &json!({"permissions": {"fileSystem": {"read": ["~/.ssh/id_ed25519"]}}}),
            None,
        )
        .is_some());
        // Shell strings remain proposals for human review, never authorization facts. Even an
        // obvious match and an interpreter bypass are outside this structural permission gate.
        assert_eq!(
            enforced_permission_denial(
                "item/commandExecution/requestApproval",
                &json!({"command": "curl example.invalid"}),
                None,
            ),
            None
        );
        assert_eq!(
            enforced_permission_denial(
                "item/commandExecution/requestApproval",
                &json!({"command": "python -c 'import socket'"}),
                None,
            ),
            None
        );
    }

    proptest! {
        #[test]
        fn credential_markers_survive_command_normalization(
            marker_index in 0usize..CREDENTIAL_MARKERS.len(),
            uppercase in prop::collection::vec(any::<bool>(), 1..32),
            use_windows_separator in any::<bool>(),
        ) {
            let marker = CREDENTIAL_MARKERS[marker_index];
            let varied = vary_ascii_case(marker, &uppercase);
            let varied = if use_windows_separator {
                varied.replace('/', "\\")
            } else {
                varied
            };
            let command = format!("cat /tmp/prefix/{varied}/suffix");

            prop_assert_eq!(
                command_review_risk(&command),
                Some(CommandReviewRisk::CredentialAccess)
            );
        }
    }

    #[test]
    fn file_permission_grants_are_confined_to_the_canonical_project_root() {
        let temp = tempfile::tempdir().expect("temp directory");
        let root = temp.path().join("project");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(root.join("src")).expect("project directory");
        std::fs::create_dir_all(&outside).expect("outside directory");

        for allowed in [
            root.join("src").display().to_string(),
            root.join("src/new-file.rs").display().to_string(),
            "src/new-file.rs".to_string(),
        ] {
            let params = json!({"permissions": {"fileSystem": {"read": [allowed]}}});
            assert_eq!(
                enforced_permission_denial(
                    "item/permissions/requestApproval",
                    &params,
                    Some(&root),
                ),
                None
            );
        }

        for denied in [
            outside.display().to_string(),
            root.join("../outside").display().to_string(),
            "../outside".to_string(),
            "~/.docker/config.json".to_string(),
        ] {
            let params = json!({"permissions": {"fileSystem": {"write": [denied]}}});
            assert_eq!(
                enforced_permission_denial(
                    "item/permissions/requestApproval",
                    &params,
                    Some(&root),
                ),
                Some("File permission requests outside the approved project root are denied by host policy")
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn file_permission_grants_reject_symlink_escapes() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("temp directory");
        let root = temp.path().join("project");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(&root).expect("project directory");
        std::fs::create_dir_all(&outside).expect("outside directory");
        symlink(&outside, root.join("escape")).expect("escape symlink");
        let params = json!({"permissions": {"fileSystem": {"read": [
            root.join("escape/secret.txt").display().to_string()
        ]}}});

        assert_eq!(
            enforced_permission_denial(
                "item/permissions/requestApproval",
                &params,
                Some(&root),
            ),
            Some("File permission requests outside the approved project root are denied by host policy")
        );
    }

    #[cfg(unix)]
    #[test]
    fn file_permission_recheck_detects_a_symlink_retargeted_after_request() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("temp directory");
        let root = temp.path().join("project");
        let inside = root.join("inside");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(&inside).expect("inside directory");
        std::fs::create_dir_all(&outside).expect("outside directory");
        let link = root.join("grant-target");
        symlink(&inside, &link).expect("inside symlink");
        let params = json!({"permissions": {"fileSystem": {"read": [
            link.join("future.txt").display().to_string()
        ]}}});

        assert_eq!(
            enforced_permission_denial("item/permissions/requestApproval", &params, Some(&root),),
            None
        );
        std::fs::remove_file(&link).expect("remove inside symlink");
        symlink(&outside, &link).expect("outside symlink");
        assert!(enforced_permission_denial(
            "item/permissions/requestApproval",
            &params,
            Some(&root),
        )
        .is_some());
    }

    #[test]
    fn filesystem_permissions_are_denied_when_no_project_root_is_active() {
        let params = json!({"permissions": {"fileSystem": {"read": ["src"]}}});
        assert!(
            enforced_permission_denial("item/permissions/requestApproval", &params, None,)
                .is_some()
        );
    }

    #[test]
    fn noncanonical_permission_shapes_fail_closed() {
        let temp = tempfile::tempdir().expect("temp directory");
        let root = temp.path().join("project");
        std::fs::create_dir_all(&root).expect("project directory");
        for file_system in [
            json!({"read": "src"}),
            json!({"entries": [{"access": "read", "path": {"type": "glob_pattern", "pattern": "**/*"}}]}),
            json!({"entries": [{"access": "write", "path": {"type": "special", "value": {"kind": "tmpdir"}}}]}),
        ] {
            let params = json!({"permissions": {"fileSystem": file_system}});
            assert!(enforced_permission_denial(
                "item/permissions/requestApproval",
                &params,
                Some(&root),
            )
            .is_some());
        }
    }
}
