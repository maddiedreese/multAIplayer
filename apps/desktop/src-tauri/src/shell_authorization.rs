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

use crate::command_safety::{command_review_risk, CommandReviewRisk};
use crate::validation::{ensure_room_id, ensure_terminal_command};
use crate::workspace::ensure_existing_dir;

const AUTHORIZATION_LIFETIME: Duration = Duration::from_secs(120);
const EXACT_COMMAND_GRANT_LIFETIME: Duration = Duration::from_secs(10 * 60);
const MAX_REQUESTER_LABEL_CHARS: usize = 160;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ShellExecutionKind {
    RemoteRequest,
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

    fn has_exact_command_grant(&self, request: &ShellAuthorizationRequest) -> Result<bool, String> {
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
}

#[typed_tauri_command::command]
pub(crate) async fn authorize_shell_execution(
    app: AppHandle,
    state: State<'_, ShellAuthorizationState>,
    request: ShellAuthorizationRequest,
) -> crate::command_error::CommandResult<String> {
    validate_authorization_request(&request)?;
    let canonical_cwd = canonical_workspace(&request.cwd)?;
    // State methods independently canonicalize before matching or storing authority. Keep the
    // original request here; rebuilding it with the same canonical path would be redundant.
    let request_for_issue = request.clone();
    let review_risk = command_review_risk(&request_for_issue.command);
    if review_risk.is_none() && state.has_exact_command_grant(&request_for_issue)? {
        return Ok(state.issue(&request_for_issue)?);
    }
    state.begin_confirmation()?;
    let source = format!(
        "Remote room request from {}",
        request.requester_label.trim()
    );
    let mutable_state_warning = "\n\nRemembering repeats only this command text. Workspace files, scripts, hooks, configuration, and environment may change between runs.";
    let risk_warning = match review_risk {
        Some(CommandReviewRisk::CredentialAccess) => "\n\nHIGH-RISK REVIEW SIGNAL: this command text mentions a credential or secret path. This heuristic is incomplete. The macOS filesystem sandbox confines writes to the selected workspace but permits documented system/toolchain reads, child processes, inherited environment, and network access. This approval can only be used once.",
        Some(CommandReviewRisk::NetworkAccess) => "\n\nHIGH-RISK REVIEW SIGNAL: this command text names a network-capable operation. This heuristic is incomplete. The macOS filesystem sandbox confines writes to the selected workspace but permits documented system/toolchain reads, child processes, inherited environment, and network access. This approval can only be used once.",
        None => "",
    };
    let message = format!(
        "{source}\n\nRoom: {}\nWorking directory: {}\n\nCommand:\n{}{risk_warning}{mutable_state_warning}",
        request.room_id, canonical_cwd, request.command
    );
    let dialog_kind = request.kind;
    let dialog_result = tauri::async_runtime::spawn_blocking(move || {
        let dialog = app
            .dialog()
            .message(message)
            .title(if review_risk.is_some() {
                "HIGH RISK: allow shell command?"
            } else {
                "Allow command execution?"
            })
            .kind(MessageDialogKind::Warning);
        match dialog_kind {
            ShellExecutionKind::RemoteRequest if review_risk.is_none() => dialog
                .buttons(MessageDialogButtons::YesNoCancelCustom(
                    "Run once".to_string(),
                    "Repeat this command text for 10 minutes".to_string(),
                    "Cancel".to_string(),
                ))
                .blocking_show_with_result(),
            _ => dialog
                .buttons(MessageDialogButtons::OkCancelCustom(
                    if review_risk.is_some() {
                        "Allow once".to_string()
                    } else {
                        "Run once".to_string()
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
        || matches!(decision, MessageDialogResult::Custom(ref value) if value == "Run once" || value == "Allow once")
        || (reusable && review_risk.is_none());
    if !approved {
        return Err("Command execution was denied in the native confirmation dialog".into());
    }
    if reusable {
        state.grant_exact_command(&request_for_issue)?;
    }
    Ok(state.issue(&request_for_issue)?)
}

#[typed_tauri_command::command]
pub(crate) async fn clear_shell_execution_grants(
    app: AppHandle,
    state: State<'_, ShellAuthorizationState>,
    room_id: String,
) -> crate::command_error::CommandResult<usize> {
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
        return Err("Command-grant revocation was cancelled".into());
    }
    Ok(state.clear_exact_command_grants(&room_id)?)
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

#[cfg(test)]
#[path = "shell_authorization/tests.rs"]
mod tests;
