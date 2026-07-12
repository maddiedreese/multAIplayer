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
#[path = "shell_authorization/tests.rs"]
mod tests;
