#![cfg_attr(not(test), deny(clippy::expect_used, clippy::unwrap_used))]

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
mod command_safety;
mod diagnostics;
mod git;
mod host_sandbox;
mod local_preview;
mod mls_native;
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
use local_preview::*;
use mls_native::*;
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
    if let Err(error) = tauri::Builder::default()
        .manage(TerminalState::default())
        .manage(ShellAuthorizationState::default())
        .manage(LocalPreviewState::default())
        .manage(CodexRpcState::default())
        .manage(CodexHostState::default())
        .manage(MlsNativeState::default())
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
            mls_identity_initialize,
            mls_device_auth_sign,
            mls_group_state,
            mls_invite_capability_issue,
            mls_invite_request_seal,
            mls_invite_request_open,
            mls_invite_approve,
            mls_invite_deny,
            mls_invite_response_accept,
            mls_join_admissions_list,
            mls_join_admission_complete,
            mls_blob_encrypt,
            mls_blob_decrypt,
            mls_blob_prepare,
            mls_history_save,
            mls_history_retention_set,
            mls_history_load,
            mls_history_delete,
            mls_history_load_latest,
            mls_history_delete_all,
            mls_generate_key_package,
            mls_create_group,
            mls_join_welcome,
            mls_encrypt_application,
            mls_process_incoming,
            mls_remove_member,
            mls_transfer_host,
            mls_host_transfer_authorization,
            mls_current_epoch,
            mls_group_open,
            mls_forget_corrupt_group,
            mls_publish_succeeded,
            mls_outbox_list,
            mls_clear_pending_commit,
            mls_retire_stale_application,
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
    {
        eprintln!("error while running multAIplayer: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod lib_tests;
