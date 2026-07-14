use crate::host_sandbox::sandboxed_shell_command;
use crate::output::{bound_command_output, redact_known_secrets};
use crate::shell_authorization::{ShellAuthorizationState, ShellExecutionKind};
use crate::validation::ensure_terminal_command;
use crate::workspace::ensure_existing_dir;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandResult {
    pub(crate) command: String,
    pub(crate) cwd: String,
    pub(crate) status: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellCommandRequest {
    pub(crate) room_id: String,
    pub(crate) cwd: String,
    pub(crate) command: String,
    pub(crate) authorization_token: String,
}

#[tauri::command]
pub(crate) fn run_shell_command(
    state: State<'_, ShellAuthorizationState>,
    request: ShellCommandRequest,
) -> crate::command_error::CommandResult<CommandResult> {
    ensure_existing_dir(&request.cwd)?;
    ensure_terminal_command(&request.command)?;
    let canonical_cwd = state
        .consume(
            &request.authorization_token,
            &request.room_id,
            &request.cwd,
            &request.command,
            ShellExecutionKind::RemoteRequest,
        )
        .map_err(crate::command_error::CommandError::unauthorized)?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = sandboxed_shell_command(&shell, &canonical_cwd, &request.command)?
        .output()
        .map_err(|error| {
            crate::command_error::CommandError::process(format!("Failed to run command: {error}"))
        })?;

    Ok(CommandResult {
        command: request.command,
        cwd: canonical_cwd,
        status: output.status.code(),
        stdout: redact_known_secrets(&bound_command_output(&output.stdout)),
        stderr: redact_known_secrets(&bound_command_output(&output.stderr)),
    })
}
