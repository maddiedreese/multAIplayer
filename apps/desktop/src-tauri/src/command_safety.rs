use serde_json::Value;

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

pub(crate) fn enforced_permission_denial(method: &str, params: &Value) -> Option<&'static str> {
    if method == "item/permissions/requestApproval" {
        let permissions = params.get("permissions")?;
        if permissions
            .pointer("/network/enabled")
            .and_then(Value::as_bool)
            == Some(true)
        {
            return Some("Network permission requests are denied by host policy");
        }
        if permission_paths(permissions).any(|path| {
            let normalized = path.to_ascii_lowercase().replace('\\', "/");
            CREDENTIAL_MARKERS
                .iter()
                .any(|marker| normalized.contains(marker))
        }) {
            return Some("Credential-file permission requests are denied by host policy");
        }
    }
    None
}

fn permission_paths(value: &Value) -> impl Iterator<Item = &str> {
    value
        .get("fileSystem")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|file_system| file_system.values())
        .flat_map(|value| match value {
            Value::Array(values) => values.as_slice(),
            _ => &[],
        })
        .filter_map(|value| {
            value
                .as_str()
                .or_else(|| value.pointer("/path/path").and_then(Value::as_str))
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
    fn denies_explicit_network_and_credential_permission_requests() {
        assert!(enforced_permission_denial(
            "item/permissions/requestApproval",
            &json!({"permissions": {"network": {"enabled": true}}})
        )
        .is_some());
        assert!(enforced_permission_denial(
            "item/permissions/requestApproval",
            &json!({"permissions": {"fileSystem": {"read": ["~/.ssh/id_ed25519"]}}})
        )
        .is_some());
        // Shell strings remain proposals for human review, never authorization facts. Even an
        // obvious match and an interpreter bypass are outside this structural permission gate.
        assert_eq!(
            enforced_permission_denial(
                "item/commandExecution/requestApproval",
                &json!({"command": "curl example.invalid"})
            ),
            None
        );
        assert_eq!(
            enforced_permission_denial(
                "item/commandExecution/requestApproval",
                &json!({"command": "python -c 'import socket'"})
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

        #[test]
        fn credential_markers_survive_permission_path_normalization(
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
            let params = json!({"permissions": {"fileSystem": {"read": [
                {"path": {"path": format!("/tmp/prefix/{varied}/suffix")}}
            ]}}});

            prop_assert_eq!(
                enforced_permission_denial("item/permissions/requestApproval", &params),
                Some("Credential-file permission requests are denied by host policy")
            );
        }
    }
}
