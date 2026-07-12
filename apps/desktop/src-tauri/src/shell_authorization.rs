use serde::Deserialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use uuid::Uuid;

use crate::command_safety::blocked_command_reason;
use crate::validation::{
    ensure_room_id, ensure_terminal_command, ensure_terminal_id, ensure_terminal_input,
};
use crate::workspace::ensure_existing_dir;

const AUTHORIZATION_LIFETIME: Duration = Duration::from_secs(120);
const EXACT_COMMAND_GRANT_LIFETIME: Duration = Duration::from_secs(10 * 60);
const MAX_REQUESTER_LABEL_CHARS: usize = 160;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ShellExecutionKind {
    RemoteRequest,
    InteractiveTerminal,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ShellAuthorizationRequest {
    pub(crate) room_id: String,
    pub(crate) cwd: String,
    pub(crate) command: String,
    pub(crate) kind: ShellExecutionKind,
    pub(crate) requester_label: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AuthorizedShellExecution {
    room_id: String,
    cwd: String,
    command: String,
    kind: ShellExecutionKind,
    expires_at: Instant,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TerminalInputAuthorizationRequest {
    pub(crate) room_id: String,
    pub(crate) terminal_id: String,
    pub(crate) input: String,
    pub(crate) requester_label: String,
}

#[derive(Clone, Debug)]
struct AuthorizedTerminalInput {
    room_id: String,
    terminal_id: String,
    input: String,
    expires_at: Instant,
}

#[derive(Clone, Debug)]
struct ExactCommandGrant {
    room_id: String,
    cwd: String,
    command: String,
    expires_at: Instant,
}

#[derive(Default)]
pub(crate) struct ShellAuthorizationState {
    authorizations: Mutex<HashMap<String, AuthorizedShellExecution>>,
    terminal_input_authorizations: Mutex<HashMap<String, AuthorizedTerminalInput>>,
    exact_command_grants: Mutex<Vec<ExactCommandGrant>>,
    confirmation_in_flight: AtomicBool,
}

impl ShellAuthorizationState {
    fn issue(&self, request: &ShellAuthorizationRequest) -> Result<String, String> {
        validate_authorization_request(request)?;
        let token = Uuid::new_v4().to_string();
        let authorization = AuthorizedShellExecution {
            room_id: request.room_id.clone(),
            cwd: canonical_workspace(&request.cwd)?,
            command: request.command.clone(),
            kind: request.kind,
            expires_at: Instant::now() + AUTHORIZATION_LIFETIME,
        };
        let mut authorizations = self
            .authorizations
            .lock()
            .map_err(|_| "Native shell authorization state is unavailable".to_string())?;
        authorizations.retain(|_, value| value.expires_at > Instant::now());
        authorizations.insert(token.clone(), authorization);
        Ok(token)
    }

    fn begin_confirmation(&self) -> Result<(), String> {
        self.confirmation_in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| "A native shell confirmation is already open".to_string())
    }

    fn finish_confirmation(&self) {
        self.confirmation_in_flight.store(false, Ordering::Release);
    }

    pub(crate) fn consume(
        &self,
        token: &str,
        room_id: &str,
        cwd: &str,
        command: &str,
        kind: ShellExecutionKind,
    ) -> Result<String, String> {
        let mut authorizations = self
            .authorizations
            .lock()
            .map_err(|_| "Native shell authorization state is unavailable".to_string())?;
        let authorization = authorizations.remove(token).ok_or_else(|| {
            "Native confirmation is required before running this command".to_string()
        })?;
        if authorization.expires_at <= Instant::now() {
            return Err("Native shell confirmation expired; approve the command again".to_string());
        }
        let canonical_cwd = canonical_workspace(cwd)?;
        if authorization.room_id != room_id
            || authorization.cwd != canonical_cwd
            || authorization.command != command
            || authorization.kind != kind
        {
            return Err("Native shell confirmation does not match this command".to_string());
        }
        Ok(authorization.cwd)
    }

    fn issue_terminal_input(
        &self,
        request: &TerminalInputAuthorizationRequest,
    ) -> Result<String, String> {
        validate_terminal_input_authorization_request(request)?;
        let token = Uuid::new_v4().to_string();
        let authorization = AuthorizedTerminalInput {
            room_id: request.room_id.clone(),
            terminal_id: request.terminal_id.clone(),
            input: request.input.clone(),
            expires_at: Instant::now() + AUTHORIZATION_LIFETIME,
        };
        let mut authorizations = self
            .terminal_input_authorizations
            .lock()
            .map_err(|_| "Native terminal input authorization state is unavailable".to_string())?;
        authorizations.retain(|_, value| value.expires_at > Instant::now());
        authorizations.insert(token.clone(), authorization);
        Ok(token)
    }

    fn has_exact_command_grant(&self, request: &ShellAuthorizationRequest) -> Result<bool, String> {
        if request.kind != ShellExecutionKind::RemoteRequest {
            return Ok(false);
        }
        let canonical_cwd = canonical_workspace(&request.cwd)?;
        let now = Instant::now();
        let mut grants = self
            .exact_command_grants
            .lock()
            .map_err(|_| "Native exact-command grant state is unavailable".to_string())?;
        grants.retain(|grant| grant.expires_at > now);
        Ok(grants.iter().any(|grant| {
            grant.room_id == request.room_id
                && grant.cwd == canonical_cwd
                && grant.command == request.command
        }))
    }

    fn grant_exact_command(&self, request: &ShellAuthorizationRequest) -> Result<(), String> {
        if request.kind != ShellExecutionKind::RemoteRequest {
            return Err("Reusable grants are limited to one-shot room commands".to_string());
        }
        let grant = ExactCommandGrant {
            room_id: request.room_id.clone(),
            cwd: canonical_workspace(&request.cwd)?,
            command: request.command.clone(),
            expires_at: Instant::now() + EXACT_COMMAND_GRANT_LIFETIME,
        };
        let mut grants = self
            .exact_command_grants
            .lock()
            .map_err(|_| "Native exact-command grant state is unavailable".to_string())?;
        grants.retain(|existing| {
            existing.expires_at > Instant::now()
                && !(existing.room_id == grant.room_id
                    && existing.cwd == grant.cwd
                    && existing.command == grant.command)
        });
        grants.push(grant);
        Ok(())
    }

    fn clear_exact_command_grants(&self, room_id: &str) -> Result<usize, String> {
        let mut grants = self
            .exact_command_grants
            .lock()
            .map_err(|_| "Native exact-command grant state is unavailable".to_string())?;
        let before = grants.len();
        grants.retain(|grant| grant.room_id != room_id);
        Ok(before - grants.len())
    }

    pub(crate) fn consume_terminal_input(
        &self,
        token: &str,
        room_id: &str,
        terminal_id: &str,
        input: &str,
    ) -> Result<(), String> {
        let mut authorizations = self
            .terminal_input_authorizations
            .lock()
            .map_err(|_| "Native terminal input authorization state is unavailable".to_string())?;
        let authorization = authorizations.remove(token).ok_or_else(|| {
            "Native confirmation is required before sending terminal input".to_string()
        })?;
        if authorization.expires_at <= Instant::now() {
            return Err(
                "Native terminal input confirmation expired; approve the input again".to_string(),
            );
        }
        if authorization.room_id != room_id
            || authorization.terminal_id != terminal_id
            || authorization.input != input
        {
            return Err("Native terminal input confirmation does not match this input".to_string());
        }
        Ok(())
    }
}

#[tauri::command]
pub(crate) async fn authorize_shell_execution(
    app: AppHandle,
    state: State<'_, ShellAuthorizationState>,
    request: ShellAuthorizationRequest,
) -> Result<String, String> {
    validate_authorization_request(&request)?;
    if request.kind == ShellExecutionKind::RemoteRequest {
        if let Some(reason) = blocked_command_reason(&request.command) {
            return Err(reason.to_string());
        }
    }
    let canonical_cwd = canonical_workspace(&request.cwd)?;
    // State methods independently canonicalize before matching or storing authority. Keep the
    // original request here; rebuilding it with the same canonical path would be redundant.
    let request_for_issue = request.clone();
    let credential_access = requests_credential_access(&request_for_issue.command);
    if !credential_access && state.has_exact_command_grant(&request_for_issue)? {
        return state.issue(&request_for_issue);
    }
    state.begin_confirmation()?;
    let source = match request.kind {
        ShellExecutionKind::RemoteRequest => format!(
            "Remote room request from {}",
            request.requester_label.trim()
        ),
        ShellExecutionKind::InteractiveTerminal => "Local interactive terminal".to_string(),
    };
    let mutable_state_warning = match request.kind {
        ShellExecutionKind::RemoteRequest => "\n\nRemembering repeats only this command text. Workspace files, scripts, hooks, configuration, and environment may change between runs.",
        ShellExecutionKind::InteractiveTerminal => "",
    };
    let credential_warning = if credential_access {
        "\n\nHIGH-RISK CREDENTIAL ACCESS: this command appears to read a .env or credential file. It can only be approved once and may expose host secrets."
    } else {
        ""
    };
    let message = format!(
        "{source}\n\nRoom: {}\nWorking directory: {}\n\nCommand:\n{}{credential_warning}{mutable_state_warning}",
        request.room_id, canonical_cwd, request.command
    );
    let dialog_kind = request.kind;
    let dialog_result = tauri::async_runtime::spawn_blocking(move || {
        let dialog = app
            .dialog()
            .message(message)
            .title(if credential_access {
                "HIGH RISK: allow credential-file access?"
            } else {
                "Allow command execution?"
            })
            .kind(MessageDialogKind::Warning);
        match dialog_kind {
            ShellExecutionKind::RemoteRequest if !credential_access => dialog
                .buttons(MessageDialogButtons::YesNoCancelCustom(
                    "Run once".to_string(),
                    "Repeat this command text for 10 minutes".to_string(),
                    "Cancel".to_string(),
                ))
                .blocking_show_with_result(),
            _ => dialog
                .buttons(MessageDialogButtons::OkCancelCustom(
                    if credential_access {
                        "Allow once".to_string()
                    } else {
                        "Start terminal".to_string()
                    },
                    "Cancel".to_string(),
                ))
                .blocking_show_with_result(),
        }
    })
    .await;
    state.finish_confirmation();
    let decision =
        dialog_result.map_err(|error| format!("Native shell confirmation failed: {error}"))?;
    let reusable = match &decision {
        MessageDialogResult::No => true,
        MessageDialogResult::Custom(value) => value == "Repeat this command text for 10 minutes",
        _ => false,
    };
    let approved = matches!(decision, MessageDialogResult::Yes | MessageDialogResult::Ok)
        || matches!(decision, MessageDialogResult::Custom(ref value) if value == "Run once" || value == "Start terminal" || value == "Allow once")
        || (reusable && !credential_access);
    if !approved {
        return Err("Command execution was denied in the native confirmation dialog".to_string());
    }
    if reusable {
        state.grant_exact_command(&request_for_issue)?;
    }
    state.issue(&request_for_issue)
}

pub(crate) fn requests_credential_access(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    let references_sensitive_path = [
        ".env",
        "id_rsa",
        "id_ed25519",
        ".npmrc",
        ".pypirc",
        "/credentials",
        "credentials",
        "secrets",
    ]
    .iter()
    .any(|name| lower.contains(name));
    if !references_sensitive_path {
        return false;
    }

    // Explicitly write/delete-only commands do not disclose the existing file. Everything
    // else (including cp, interpreters, and scripts) receives the louder approval because
    // reliably proving that arbitrary command text cannot read an operand is not possible.
    let first = lower.split_whitespace().next().unwrap_or("");
    !matches!(first, "touch" | "mkdir" | "rm" | "unlink" | "truncate")
}

#[tauri::command]
pub(crate) async fn clear_shell_execution_grants(
    app: AppHandle,
    state: State<'_, ShellAuthorizationState>,
    room_id: String,
) -> Result<usize, String> {
    ensure_room_id(&room_id)?;
    state.begin_confirmation()?;
    let room_for_dialog = room_id.clone();
    let dialog_result = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(format!(
                "Room: {room_for_dialog}\n\nClear every active exact-command grant for this room?"
            ))
            .title("Revoke command grants?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Revoke grants".to_string(),
                "Cancel".to_string(),
            ))
            .blocking_show()
    })
    .await;
    state.finish_confirmation();
    let approved =
        dialog_result.map_err(|error| format!("Native grant revocation failed: {error}"))?;
    if !approved {
        return Err("Command-grant revocation was cancelled".to_string());
    }
    state.clear_exact_command_grants(&room_id)
}

#[tauri::command]
pub(crate) async fn authorize_terminal_input(
    app: AppHandle,
    state: State<'_, ShellAuthorizationState>,
    request: TerminalInputAuthorizationRequest,
) -> Result<String, String> {
    validate_terminal_input_authorization_request(&request)?;
    state.begin_confirmation()?;
    let message = format!(
        "Interactive terminal input from {}\n\nRoom: {}\nTerminal: {}\n\nExact input (control characters are escaped):\n{}",
        request.requester_label.trim(),
        request.room_id,
        request.terminal_id,
        visible_terminal_input(&request.input)
    );
    let dialog_result = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(message)
            .title("Allow terminal input?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Send input".to_string(),
                "Cancel".to_string(),
            ))
            .blocking_show()
    })
    .await;
    state.finish_confirmation();
    let approved = dialog_result
        .map_err(|error| format!("Native terminal input confirmation failed: {error}"))?;
    if !approved {
        return Err("Terminal input was denied in the native confirmation dialog".to_string());
    }
    state.issue_terminal_input(&request)
}

fn validate_authorization_request(request: &ShellAuthorizationRequest) -> Result<(), String> {
    ensure_room_id(&request.room_id)?;
    ensure_existing_dir(&request.cwd)?;
    ensure_terminal_command(&request.command)?;
    validate_requester_label(&request.requester_label)
}

fn canonical_workspace(cwd: &str) -> Result<String, String> {
    ensure_existing_dir(cwd)?;
    std::fs::canonicalize(cwd)
        .map_err(|error| format!("Failed to resolve the working directory: {error}"))?
        .into_os_string()
        .into_string()
        .map_err(|_| "Working directory must be valid UTF-8".to_string())
}

fn validate_terminal_input_authorization_request(
    request: &TerminalInputAuthorizationRequest,
) -> Result<(), String> {
    ensure_room_id(&request.room_id)?;
    ensure_terminal_id(&request.terminal_id)?;
    ensure_terminal_input(&request.input)?;
    validate_requester_label(&request.requester_label)
}

fn validate_requester_label(requester_label: &str) -> Result<(), String> {
    let requester = requester_label.trim();
    if requester.is_empty()
        || requester.chars().count() > MAX_REQUESTER_LABEL_CHARS
        || requester.chars().any(char::is_control)
    {
        return Err("Shell requester label is invalid".to_string());
    }
    Ok(())
}

fn visible_terminal_input(input: &str) -> String {
    input.chars().flat_map(char::escape_default).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::env;

    fn request(command: &str) -> ShellAuthorizationRequest {
        ShellAuthorizationRequest {
            room_id: "room-native-auth".to_string(),
            cwd: env::temp_dir().to_string_lossy().to_string(),
            command: command.to_string(),
            kind: ShellExecutionKind::RemoteRequest,
            requester_label: "Remote member".to_string(),
        }
    }

    #[test]
    fn authorization_is_exact_and_one_use() {
        let state = ShellAuthorizationState::default();
        let request = request("printf approved");
        let token = state.issue(&request).expect("issue authorization");
        assert!(state
            .consume(
                &token,
                &request.room_id,
                &request.cwd,
                "printf substituted",
                request.kind,
            )
            .is_err());
        assert!(state
            .consume(
                &token,
                &request.room_id,
                &request.cwd,
                &request.command,
                request.kind
            )
            .is_err());

        let token = state.issue(&request).expect("issue second authorization");
        assert!(state
            .consume(
                &token,
                &request.room_id,
                &request.cwd,
                &request.command,
                request.kind
            )
            .is_ok());
        assert!(state
            .consume(
                &token,
                &request.room_id,
                &request.cwd,
                &request.command,
                request.kind
            )
            .is_err());
    }

    #[test]
    fn authorization_constants_keep_the_intended_security_windows() {
        assert_eq!(AUTHORIZATION_LIFETIME, Duration::from_secs(120));
        assert_eq!(EXACT_COMMAND_GRANT_LIFETIME, Duration::from_secs(600));
    }

    #[test]
    fn issuing_authorization_prunes_expired_capabilities() {
        let state = ShellAuthorizationState::default();
        let approved = request("printf approved");
        let active = AuthorizedShellExecution {
            room_id: approved.room_id.clone(),
            cwd: canonical_workspace(&approved.cwd).expect("canonical cwd"),
            command: approved.command.clone(),
            kind: approved.kind,
            expires_at: Instant::now() + Duration::from_secs(60),
        };
        let mut authorizations = state.authorizations.lock().expect("authorization state");
        authorizations.insert("active".to_string(), active);
        authorizations.insert(
            "expired".to_string(),
            AuthorizedShellExecution {
                room_id: approved.room_id.clone(),
                cwd: canonical_workspace(&approved.cwd).expect("canonical cwd"),
                command: approved.command.clone(),
                kind: approved.kind,
                expires_at: Instant::now(),
            },
        );
        drop(authorizations);
        state.issue(&approved).expect("issue authorization");
        let authorizations = state.authorizations.lock().expect("authorization state");
        assert!(!authorizations.contains_key("expired"));
        assert!(authorizations.contains_key("active"));
    }

    #[test]
    fn every_shell_authorization_binding_is_independently_enforced() {
        let approved = request("printf approved");
        let other_cwd = env::current_dir()
            .expect("current dir")
            .to_string_lossy()
            .to_string();
        let cases = [
            (
                "room-other",
                approved.cwd.as_str(),
                approved.command.as_str(),
                approved.kind,
            ),
            (
                approved.room_id.as_str(),
                other_cwd.as_str(),
                approved.command.as_str(),
                approved.kind,
            ),
            (
                approved.room_id.as_str(),
                approved.cwd.as_str(),
                "printf substituted",
                approved.kind,
            ),
            (
                approved.room_id.as_str(),
                approved.cwd.as_str(),
                approved.command.as_str(),
                ShellExecutionKind::InteractiveTerminal,
            ),
        ];
        for (room_id, cwd, command, kind) in cases {
            if canonical_workspace(cwd).expect("canonical test cwd")
                == canonical_workspace(&approved.cwd).expect("canonical approved cwd")
                && cwd != approved.cwd
            {
                continue;
            }
            let state = ShellAuthorizationState::default();
            let token = state.issue(&approved).expect("issue authorization");
            assert!(state.consume(&token, room_id, cwd, command, kind).is_err());
        }
    }

    #[test]
    fn only_one_native_confirmation_can_be_open() {
        let state = ShellAuthorizationState::default();
        assert!(state.begin_confirmation().is_ok());
        assert!(state.begin_confirmation().is_err());
        state.finish_confirmation();
        assert!(state.begin_confirmation().is_ok());
    }

    #[test]
    fn terminal_input_authorization_is_exact_and_one_use() {
        let state = ShellAuthorizationState::default();
        let request = TerminalInputAuthorizationRequest {
            room_id: "room-native-auth".to_string(),
            terminal_id: "room-native-auth:shell".to_string(),
            input: "rm -rf ./build\r".to_string(),
            requester_label: "Local host".to_string(),
        };
        let token = state
            .issue_terminal_input(&request)
            .expect("issue input authorization");
        assert!(state
            .consume_terminal_input(
                &token,
                &request.room_id,
                &request.terminal_id,
                "rm -rf ./\r"
            )
            .is_err());
        assert!(state
            .consume_terminal_input(
                &token,
                &request.room_id,
                &request.terminal_id,
                &request.input
            )
            .is_err());

        let token = state
            .issue_terminal_input(&request)
            .expect("issue second input authorization");
        assert!(state
            .consume_terminal_input(
                &token,
                &request.room_id,
                &request.terminal_id,
                &request.input
            )
            .is_ok());
        assert!(state
            .consume_terminal_input(
                &token,
                &request.room_id,
                &request.terminal_id,
                &request.input
            )
            .is_err());
    }

    #[test]
    fn issuing_terminal_input_prunes_expired_capabilities() {
        let state = ShellAuthorizationState::default();
        let approved = TerminalInputAuthorizationRequest {
            room_id: "room-native-auth".to_string(),
            terminal_id: "room-native-auth:shell".to_string(),
            input: "printf approved".to_string(),
            requester_label: "Local host".to_string(),
        };
        let mut authorizations = state
            .terminal_input_authorizations
            .lock()
            .expect("terminal input state");
        authorizations.insert(
            "active".to_string(),
            AuthorizedTerminalInput {
                room_id: approved.room_id.clone(),
                terminal_id: approved.terminal_id.clone(),
                input: approved.input.clone(),
                expires_at: Instant::now() + Duration::from_secs(60),
            },
        );
        authorizations.insert(
            "expired".to_string(),
            AuthorizedTerminalInput {
                room_id: approved.room_id.clone(),
                terminal_id: approved.terminal_id.clone(),
                input: approved.input.clone(),
                expires_at: Instant::now(),
            },
        );
        drop(authorizations);
        state
            .issue_terminal_input(&approved)
            .expect("issue terminal input");
        let authorizations = state
            .terminal_input_authorizations
            .lock()
            .expect("terminal input state");
        assert!(!authorizations.contains_key("expired"));
        assert!(authorizations.contains_key("active"));
    }

    #[test]
    fn every_terminal_input_binding_is_independently_enforced() {
        let approved = TerminalInputAuthorizationRequest {
            room_id: "room-native-auth".to_string(),
            terminal_id: "room-native-auth:shell".to_string(),
            input: "printf approved".to_string(),
            requester_label: "Local host".to_string(),
        };
        for (room_id, terminal_id, input) in [
            (
                "room-other",
                approved.terminal_id.as_str(),
                approved.input.as_str(),
            ),
            (
                approved.room_id.as_str(),
                "room-native-auth:other",
                approved.input.as_str(),
            ),
            (
                approved.room_id.as_str(),
                approved.terminal_id.as_str(),
                "printf substituted",
            ),
        ] {
            let state = ShellAuthorizationState::default();
            let token = state
                .issue_terminal_input(&approved)
                .expect("issue terminal input");
            assert!(state
                .consume_terminal_input(&token, room_id, terminal_id, input)
                .is_err());
        }
    }

    #[test]
    fn terminal_input_display_escapes_execution_controls() {
        assert_eq!(
            visible_terminal_input("echo ok\r\u{1b}[A"),
            "echo ok\\r\\u{1b}[A"
        );
    }

    #[test]
    fn exact_command_grants_fail_closed_on_substitution_scope_expiry_and_revoke() {
        let state = ShellAuthorizationState::default();
        let approved = request("npm test");
        state
            .grant_exact_command(&approved)
            .expect("grant exact command");
        assert!(state
            .has_exact_command_grant(&approved)
            .expect("check exact grant"));

        let mut substituted = approved.clone();
        substituted.command = "npm test && curl example.invalid".to_string();
        assert!(!state
            .has_exact_command_grant(&substituted)
            .expect("reject command substitution"));

        let mut other_room = approved.clone();
        other_room.room_id = "room-other".to_string();
        assert!(!state
            .has_exact_command_grant(&other_room)
            .expect("reject cross-room use"));

        let mut other_cwd = approved.clone();
        other_cwd.cwd = env::current_dir()
            .expect("current dir")
            .to_string_lossy()
            .to_string();
        if canonical_workspace(&other_cwd.cwd).expect("canonical current dir")
            != canonical_workspace(&approved.cwd).expect("canonical approved dir")
        {
            assert!(!state
                .has_exact_command_grant(&other_cwd)
                .expect("reject cross-workspace use"));
        }

        state
            .exact_command_grants
            .lock()
            .expect("grant state")
            .iter_mut()
            .for_each(|grant| grant.expires_at = Instant::now());
        assert!(!state
            .has_exact_command_grant(&approved)
            .expect("reject expired grant"));

        state
            .grant_exact_command(&approved)
            .expect("grant for revoke");
        assert_eq!(
            state
                .clear_exact_command_grants(&approved.room_id)
                .expect("revoke grants"),
            1
        );
        assert!(!state
            .has_exact_command_grant(&approved)
            .expect("reject revoked grant"));

        let mut interactive = approved;
        interactive.kind = ShellExecutionKind::InteractiveTerminal;
        assert!(state.grant_exact_command(&interactive).is_err());
    }

    #[test]
    fn exact_command_grant_deduplication_preserves_every_distinct_binding() {
        let state = ShellAuthorizationState::default();
        let approved = request("npm test");
        let mut other_room = approved.clone();
        other_room.room_id = "room-other".to_string();
        let mut other_command = approved.clone();
        other_command.command = "npm run lint".to_string();
        for grant in [&approved, &other_room, &other_command, &approved] {
            state.grant_exact_command(grant).expect("grant command");
        }
        let grants = state.exact_command_grants.lock().expect("grant state");
        assert_eq!(grants.len(), 3);
        assert!(grants
            .iter()
            .any(|grant| grant.room_id == other_room.room_id));
        assert!(grants
            .iter()
            .any(|grant| grant.command == other_command.command));
    }

    #[test]
    fn clearing_grants_returns_only_the_removed_count() {
        let state = ShellAuthorizationState::default();
        let approved = request("npm test");
        let mut other_room = approved.clone();
        other_room.room_id = "room-other".to_string();
        state.grant_exact_command(&approved).expect("grant command");
        state
            .grant_exact_command(&other_room)
            .expect("grant other room");
        assert_eq!(state.clear_exact_command_grants(&approved.room_id), Ok(1));
        assert_eq!(
            state
                .exact_command_grants
                .lock()
                .expect("grant state")
                .len(),
            1
        );
    }

    #[test]
    fn authorization_request_validation_checks_each_boundary() {
        let valid = request("printf approved");
        assert!(validate_authorization_request(&valid).is_ok());
        for invalid in [
            ShellAuthorizationRequest {
                room_id: "".to_string(),
                ..valid.clone()
            },
            ShellAuthorizationRequest {
                cwd: "/path/that/does/not/exist".to_string(),
                ..valid.clone()
            },
            ShellAuthorizationRequest {
                command: "".to_string(),
                ..valid.clone()
            },
            ShellAuthorizationRequest {
                requester_label: "\n".to_string(),
                ..valid.clone()
            },
        ] {
            assert!(validate_authorization_request(&invalid).is_err());
        }
    }

    #[test]
    fn requester_label_validation_rejects_empty_long_and_control_text() {
        assert!(validate_requester_label("Remote member").is_ok());
        assert!(validate_requester_label(&"x".repeat(MAX_REQUESTER_LABEL_CHARS)).is_ok());
        assert!(validate_requester_label(" ").is_err());
        assert!(validate_requester_label(&"x".repeat(MAX_REQUESTER_LABEL_CHARS + 1)).is_err());
        assert!(validate_requester_label("member\nlabel").is_err());
    }

    #[test]
    fn terminal_input_request_validation_checks_each_boundary() {
        let valid = TerminalInputAuthorizationRequest {
            room_id: "room-native-auth".to_string(),
            terminal_id: "room-native-auth:shell".to_string(),
            input: "printf approved".to_string(),
            requester_label: "Local host".to_string(),
        };
        assert!(validate_terminal_input_authorization_request(&valid).is_ok());
        for invalid in [
            TerminalInputAuthorizationRequest {
                room_id: "".to_string(),
                ..valid.clone()
            },
            TerminalInputAuthorizationRequest {
                terminal_id: "".to_string(),
                ..valid.clone()
            },
            TerminalInputAuthorizationRequest {
                input: "".to_string(),
                ..valid.clone()
            },
            TerminalInputAuthorizationRequest {
                requester_label: "\n".to_string(),
                ..valid.clone()
            },
        ] {
            assert!(validate_terminal_input_authorization_request(&invalid).is_err());
        }
    }

    #[test]
    fn authorization_returns_the_canonical_workspace() {
        let state = ShellAuthorizationState::default();
        let mut request = request("printf approved");
        request.cwd = env::temp_dir().to_string_lossy().to_string();
        let token = state.issue(&request).expect("issue authorization");
        let authorized_cwd = state
            .consume(
                &token,
                &request.room_id,
                &request.cwd,
                &request.command,
                request.kind,
            )
            .expect("consume authorization");
        assert_eq!(
            authorized_cwd,
            std::fs::canonicalize(&request.cwd)
                .expect("canonical temporary directory")
                .to_string_lossy()
        );
    }

    proptest! {
        #[test]
        fn encoded_or_quoted_command_variants_cannot_reuse_authorization(
            payload in "[A-Za-z0-9_./ -]{1,80}",
            encoding in 0usize..4,
        ) {
            let approved_command = format!("printf -- '{payload}'");
            let attempted_command = match encoding {
                0 => format!("{approved_command} # %2f%2e%2e"),
                1 => format!("{approved_command}\\x20"),
                2 => format!("sh -c {}", serde_json::to_string(&approved_command).expect("encode command")),
                _ => format!("{approved_command}\u{a0}"),
            };
            prop_assert_ne!(&attempted_command, &approved_command);

            let state = ShellAuthorizationState::default();
            let approved = request(&approved_command);
            let token = state.issue(&approved).expect("issue authorization");
            prop_assert!(state.consume(
                &token,
                &approved.room_id,
                &approved.cwd,
                &attempted_command,
                approved.kind,
            ).is_err());

            // A mismatch consumes the capability, so retrying the originally approved bytes
            // cannot turn a rejected encoding attempt into execution.
            prop_assert!(state.consume(
                &token,
                &approved.room_id,
                &approved.cwd,
                &approved.command,
                approved.kind,
            ).is_err());
        }
    }
}
