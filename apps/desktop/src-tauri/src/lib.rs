mod browser;
mod codex;
mod codex_account;
mod codex_activity;
mod codex_catalog;
mod codex_goal;
mod codex_request_projection;
mod codex_request_validation;
mod codex_requests;
mod codex_rpc;
mod codex_threads;
mod codex_turn_lifecycle;
mod diagnostics;
mod git;
mod keychain;
mod local_preview;
mod output;
mod process;
mod project;
mod shell;
mod shell_authorization;
mod terminal;
mod validation;
mod workspace;
use browser::*;
use codex::*;
use codex_account::*;
use codex_catalog::*;
use codex_goal::*;
use codex_requests::CodexRpcState;
use codex_threads::*;
use diagnostics::*;
use git::*;
use keychain::*;
use local_preview::*;
use project::*;
use shell::*;
use shell_authorization::*;
use tauri::Manager;
use terminal::*;

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .manage(ShellAuthorizationState::default())
        .manage(LocalPreviewState::default())
        .manage(CodexRpcState::default())
        .manage(CodexHostState::default())
        .setup(|app| {
            let state = match app.path().app_log_dir() {
                Ok(log_dir) => DiagnosticState::initialize(log_dir.join("diagnostics.jsonl")),
                Err(error) => DiagnosticState::unavailable(format!(
                    "Failed to resolve the app log directory: {error}"
                )),
            };
            if let Some(error) = state.initialization_error() {
                eprintln!("Native diagnostic persistence is unavailable: {error}");
            }
            app.manage(state);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(DeviceIdentityAccessState::default())
        .invoke_handler(tauri::generate_handler![
            app_version,
            record_diagnostic,
            save_diagnostic_bundle,
            git_status,
            git_remote_origin,
            git_create_patch,
            git_clone_repository,
            git_apply_patch,
            git_diff_file,
            project_files,
            project_file_read,
            project_file_write,
            run_shell_command,
            authorize_shell_execution,
            clear_shell_execution_grants,
            authorize_terminal_input,
            terminal_start,
            terminal_list,
            terminal_read,
            terminal_write,
            terminal_stop,
            detect_local_preview_servers,
            probe_cloudflared,
            local_preview_start,
            local_preview_status,
            local_preview_stop,
            open_browser_view,
            reset_browser_profile,
            room_secret_get,
            room_secret_set,
            room_secret_delete,
            device_identity_take_for_startup,
            device_identity_set,
            device_identity_delete,
            run_git_workflow,
            probe_codex,
            run_codex_turn,
            set_codex_goal,
            get_codex_goal,
            clear_codex_goal,
            shutdown_codex_room,
            list_codex_server_requests,
            respond_codex_server_request,
            codex_host_snapshot,
            codex_account_login_start,
            codex_account_login_cancel,
            codex_account_logout,
            codex_mcp_login_start,
            codex_app_approval_mode_set,
            list_codex_threads,
            fork_codex_thread
        ])
        .run(tauri::generate_context!())
        .expect("error while running multAIplayer");
}

#[cfg(test)]
mod lib_tests;
