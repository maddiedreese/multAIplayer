#![cfg_attr(not(test), deny(clippy::expect_used, clippy::unwrap_used))]

mod atomic_file;
mod browser;
mod codex;
mod codex_account;
mod codex_authorization;
mod codex_catalog;
mod codex_goal;
mod codex_request_projection;
mod codex_request_validation;
mod codex_requests;
mod codex_rpc;
mod codex_steering;
mod codex_threads;
mod codex_turn_lifecycle;
mod command_error;
mod command_safety;
mod credential_store;
mod diagnostics;
mod git;
mod github;
mod host_sandbox;
mod invite_link;
mod local_preview;
mod mls_native;
mod output;
mod process;
mod project;
mod room_archive;
mod shell;
mod shell_authorization;
mod terminal;
mod trusted_auth;
pub mod updater_auth;
mod user_shell;
mod validation;
mod workspace;
use browser::*;
use codex::*;
use codex_account::*;
use codex_authorization::*;
use codex_catalog::*;
use codex_goal::*;
use codex_requests::CodexRpcState;
use codex_steering::*;
use codex_threads::*;
use diagnostics::*;
use git::*;
use github::*;
use invite_link::*;
use local_preview::*;
use mls_native::*;
use project::*;
use room_archive::*;
use shell::*;
use shell_authorization::*;
use tauri::{Emitter, Manager};
use terminal::*;
use trusted_auth::*;
use updater_auth::take_updater_auth_failure;

include!("registered_commands.rs");

macro_rules! declare_registered_commands {
    (
        infallible: [$($infallible:ident),+ $(,)?],
        fallible: [$($fallible:ident),+ $(,)?],
    ) => {
        #[cfg(test)]
        const REGISTERED_COMMAND_NAMES: &[&str] = &[
            $(stringify!($infallible)),+,
            $(stringify!($fallible)),+
        ];

        fn attach_registered_commands(
            builder: tauri::Builder<tauri::Wry>,
        ) -> tauri::Builder<tauri::Wry> {
            // Each marker is emitted only by `typed_tauri_command::command`.
            // A fallible registration using Tauri's untyped attribute cannot
            // satisfy these compiler-resolved references.
            $(let () = $fallible::PRESENT;)+
            builder.invoke_handler(tauri::generate_handler![
                $($infallible),+,
                $($fallible),+
            ])
        }
    };
}

with_registered_commands!(declare_registered_commands);

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn app_context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(TerminalState::default())
        .manage(ShellAuthorizationState::default())
        .manage(LocalPreviewState::default())
        .manage(BrowserState::default())
        .manage(CodexRpcState::default())
        .manage(CodexAuthorizationState::default())
        .manage(CodexHostState::default())
        .manage(GitHubState::default())
        .manage(MlsNativeState::default())
        .manage(NativeInviteState::default())
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
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .default_version_comparator(updater_auth::authenticated_update_is_newer)
                .build(),
        );
    #[cfg(feature = "native-e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    let app = match attach_registered_commands(builder).build(app_context()) {
        Ok(app) => app,
        Err(error) => {
            eprintln!("error while building multAIplayer: {error}");
            std::process::exit(1);
        }
    };
    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            let state = app_handle.state::<LocalPreviewState>();
            if let Err(error) = stop_all_local_previews_with_retry(
                &state,
                3,
                std::time::Duration::from_millis(100),
            ) {
                api.prevent_exit();
                eprintln!("Failed to stop all local previews during shutdown: {error}");
                if let Err(emit_error) = app_handle.emit_to(
                    "main",
                    "local-preview://shutdown-blocked",
                    "The app stayed open because a public local-preview tunnel could not be confirmed stopped. Try closing again.",
                ) {
                    eprintln!("Failed to report blocked local-preview shutdown: {emit_error}");
                }
            }
        }
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            handle_opened_invite_urls(app_handle, &urls);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}

#[cfg(test)]
mod lib_tests;
