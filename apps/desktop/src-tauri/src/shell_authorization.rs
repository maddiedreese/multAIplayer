use serde::Deserialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use uuid::Uuid;

use crate::validation::{
    ensure_room_id, ensure_terminal_command, ensure_terminal_id, ensure_terminal_input,
};
use crate::workspace::ensure_existing_dir;

const AUTHORIZATION_LIFETIME: Duration = Duration::from_secs(120);
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

#[derive(Default)]
pub(crate) struct ShellAuthorizationState {
    authorizations: Mutex<HashMap<String, AuthorizedShellExecution>>,
    terminal_input_authorizations: Mutex<HashMap<String, AuthorizedTerminalInput>>,
    confirmation_in_flight: AtomicBool,
}

impl ShellAuthorizationState {
    fn issue(&self, request: &ShellAuthorizationRequest) -> Result<String, String> {
        validate_authorization_request(request)?;
        let token = Uuid::new_v4().to_string();
        let authorization = AuthorizedShellExecution {
            room_id: request.room_id.clone(),
            cwd: request.cwd.clone(),
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
    ) -> Result<(), String> {
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
        if authorization.room_id != room_id
            || authorization.cwd != cwd
            || authorization.command != command
            || authorization.kind != kind
        {
            return Err("Native shell confirmation does not match this command".to_string());
        }
        Ok(())
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
    state.begin_confirmation()?;
    let source = match request.kind {
        ShellExecutionKind::RemoteRequest => format!(
            "Remote room request from {}",
            request.requester_label.trim()
        ),
        ShellExecutionKind::InteractiveTerminal => "Local interactive terminal".to_string(),
    };
    let message = format!(
        "{source}\n\nRoom: {}\nWorking directory: {}\n\nCommand:\n{}",
        request.room_id, request.cwd, request.command
    );
    let dialog_result = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(message)
            .title("Allow command execution?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Run command".to_string(),
                "Cancel".to_string(),
            ))
            .blocking_show()
    })
    .await;
    state.finish_confirmation();
    let approved =
        dialog_result.map_err(|error| format!("Native shell confirmation failed: {error}"))?;
    if !approved {
        return Err("Command execution was denied in the native confirmation dialog".to_string());
    }
    state.issue(&request)
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
    fn terminal_input_display_escapes_execution_controls() {
        assert_eq!(
            visible_terminal_input("echo ok\r\u{1b}[A"),
            "echo ok\\r\\u{1b}[A"
        );
    }
}
