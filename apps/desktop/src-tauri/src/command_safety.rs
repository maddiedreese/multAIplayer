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

pub(crate) fn blocked_command_reason(command: &str) -> Option<&'static str> {
    let normalized = command.to_ascii_lowercase().replace('\\', "/");
    if CREDENTIAL_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some("Commands that touch credential or secret files are denied by host policy");
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
        return Some("Commands that may touch the network are denied by host policy");
    }
    None
}

pub(crate) fn blocked_server_request_reason(method: &str, params: &Value) -> Option<&'static str> {
    if matches!(
        method,
        "item/commandExecution/requestApproval" | "execCommandApproval"
    ) {
        let command = match params.get("command") {
            Some(Value::String(command)) => command.clone(),
            Some(Value::Array(parts)) => parts
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
            _ => String::new(),
        };
        return blocked_command_reason(&command);
    }
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
    fn blocks_network_tools_and_credential_files() {
        assert!(blocked_command_reason("curl https://example.com").is_some());
        assert!(blocked_command_reason("git push origin main").is_some());
        assert!(blocked_command_reason("cat ~/.aws/credentials").is_some());
        assert!(blocked_command_reason("npm install").is_some());
        assert!(blocked_command_reason("npm test").is_none());
        assert!(blocked_command_reason("cargo fmt --check").is_none());
        assert!(blocked_command_reason("rg TODO src").is_none());
        for command in [
            "pip install unsafe-package",
            "pip3 download unsafe-package",
            "cargo search unsafe-package",
            "go get example.invalid/package",
        ] {
            assert!(
                blocked_command_reason(command).is_some(),
                "allowed {command}"
            );
        }
    }

    #[test]
    fn blocks_network_and_credential_permission_requests() {
        assert!(blocked_server_request_reason(
            "item/permissions/requestApproval",
            &json!({"permissions": {"network": {"enabled": true}}})
        )
        .is_some());
        assert!(blocked_server_request_reason(
            "item/commandExecution/requestApproval",
            &json!({"command": "curl example.invalid"})
        )
        .is_some());
        assert!(blocked_server_request_reason(
            "execCommandApproval",
            &json!({"command": ["git", "push", "origin", "main"]})
        )
        .is_some());
        assert!(blocked_server_request_reason(
            "item/permissions/requestApproval",
            &json!({"permissions": {"fileSystem": {"read": ["~/.ssh/id_ed25519"]}}})
        )
        .is_some());
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
                blocked_command_reason(&command),
                Some("Commands that touch credential or secret files are denied by host policy")
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
                blocked_server_request_reason("item/permissions/requestApproval", &params),
                Some("Credential-file permission requests are denied by host policy")
            );
        }
    }
}
