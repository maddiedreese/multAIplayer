use serde::{Deserialize, Serialize};
use std::process::Command;

use crate::ensure_existing_dir;
use crate::output::bound_command_output;
use crate::validation::ensure_terminal_command;

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
    pub(crate) cwd: String,
    pub(crate) command: String,
}

#[tauri::command]
pub(crate) fn run_shell_command(request: ShellCommandRequest) -> Result<CommandResult, String> {
    ensure_existing_dir(&request.cwd)?;
    ensure_terminal_command(&request.command)?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(shell)
        .current_dir(&request.cwd)
        .args(["-lc", &request.command])
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
