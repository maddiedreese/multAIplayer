use serde::{Deserialize, Serialize};
use std::process::Command;

use crate::output::bound_command_output;
use crate::shell_authorization::{ShellAuthorizationState, ShellExecutionKind};
use crate::validation::ensure_terminal_command;
use crate::workspace::ensure_existing_dir;
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
) -> Result<CommandResult, String> {
    ensure_existing_dir(&request.cwd)?;
    ensure_terminal_command(&request.command)?;
    state.consume(
        &request.authorization_token,
        &request.room_id,
        &request.cwd,
        &request.command,
        ShellExecutionKind::RemoteRequest,
    )?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(shell)
        .current_dir(&request.cwd)
        .args(["-c", &request.command])
        .output()
        .map_err(|error| format!("Failed to run command: {error}"))?;

    Ok(CommandResult {
        command: request.command,
        cwd: request.cwd,
        status: output.status.code(),
        stdout: bound_command_output(&output.stdout),
        stderr: bound_command_output(&output.stderr),
    })
}
