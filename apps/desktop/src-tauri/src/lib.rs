mod browser;
mod codex;
mod diagnostics;
mod git;
mod keychain;
mod local_preview;
mod output;
mod process;
mod project;
mod shell;
mod terminal;
mod validation;
mod workspace;
use browser::*;
use codex::*;
use diagnostics::*;
use git::*;
use keychain::*;
use local_preview::*;
use project::*;
use shell::*;
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
        .manage(LocalPreviewState::default())
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
            device_identity_get,
            device_identity_set,
            device_identity_delete,
            run_git_workflow,
            probe_codex,
            run_codex_turn,
            set_codex_goal,
            get_codex_goal,
            clear_codex_goal,
            shutdown_codex_room
        ])
        .run(tauri::generate_context!())
        .expect("error while running multAIplayer");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::*;
    use crate::validation::*;
    use crate::workspace::ensure_existing_dir;
    use std::fs::{self, create_dir_all, write};
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn safe_project_path_allows_project_relative_files() {
        let root = test_temp_dir("safe-path-allow");
        write(root.join("README.md"), "hello").expect("write test file");

        let resolved = safe_project_path(&root, "README.md").expect("resolve project file");

        assert_eq!(
            resolved,
            fs::canonicalize(root.join("README.md")).expect("canonical test file")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn project_path_validation_rejects_unsafe_working_directories() {
        let root = test_temp_dir("project-path-validation");
        assert!(ensure_existing_dir(root.to_str().expect("utf8 temp path")).is_ok());

        for path in [
            "",
            "relative/project",
            " /tmp/project",
            "/tmp/project ",
            "/tmp/project\nsecret",
        ] {
            assert!(
                ensure_existing_dir(path).is_err(),
                "{path:?} should be rejected"
            );
        }
        assert!(
            ensure_existing_dir(&format!("/tmp/{}", "x".repeat(MAX_PROJECT_PATH_CHARS))).is_err()
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn safe_project_path_rejects_parent_and_symlink_escape() {
        let root = test_temp_dir("safe-path-reject");
        let outside = test_temp_dir("safe-path-outside");
        write(root.join("inside.txt"), "inside").expect("write inside file");
        write(outside.join("secret.txt"), "secret").expect("write outside file");

        assert!(safe_project_path(&root, "../secret.txt").is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("linked-secret.txt"))
                .expect("create symlink");
            assert!(safe_project_path(&root, "linked-secret.txt").is_err());
        }

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn collect_project_files_skips_symlinked_entries() {
        let root = test_temp_dir("collect-files");
        let outside = test_temp_dir("collect-files-outside");
        write(root.join("visible.txt"), "visible").expect("write visible file");
        write(outside.join("secret.txt"), "secret").expect("write outside file");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("linked-secret.txt"))
                .expect("create file symlink");
            create_dir_all(outside.join("linked-dir")).expect("create outside dir");
            write(outside.join("linked-dir/secret.md"), "secret").expect("write linked dir secret");
            std::os::unix::fs::symlink(outside.join("linked-dir"), root.join("linked-dir"))
                .expect("create dir symlink");
        }

        let mut files = Vec::new();
        collect_project_files(&root, &root, "", 20, &mut files).expect("collect files");
        let paths = files.into_iter().map(|file| file.path).collect::<Vec<_>>();

        assert!(paths.contains(&"visible.txt".to_string()));
        assert!(!paths.contains(&"linked-secret.txt".to_string()));
        assert!(!paths.iter().any(|path| path.contains("secret.md")));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn project_file_write_saves_inside_project_and_rejects_escape() {
        let root = test_temp_dir("project-file-write");
        let cwd = root.to_str().expect("utf8 temp path").to_string();

        let written = project_file_write(project::ProjectFileWriteRequest {
            cwd: cwd.clone(),
            path: "src/new-file.ts".to_string(),
            content: "export const saved = true;\n".to_string(),
        })
        .expect("write project file");

        assert_eq!(written.path, "src/new-file.ts");
        assert_eq!(
            fs::read_to_string(root.join("src/new-file.ts")).expect("read saved file"),
            "export const saved = true;\n"
        );
        assert!(project_file_write(project::ProjectFileWriteRequest {
            cwd,
            path: "../secret.txt".to_string(),
            content: "nope".to_string(),
        })
        .is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn git_diff_output_is_bounded_with_truncation_marker() {
        let huge_diff = format!("start\n{}\nend", "x".repeat(MAX_GIT_DIFF_CHARS + 50_000));
        let bounded = bound_git_diff(&huge_diff);

        assert!(bounded.chars().count() <= MAX_GIT_DIFF_CHARS);
        assert!(bounded.contains("multAIplayer truncated this diff"));
        assert!(bounded.starts_with("start"));
        assert!(bounded.ends_with("end"));
    }

    #[test]
    fn host_handoff_git_remote_validation_allows_github_only() {
        assert!(ensure_git_remote_url("https://github.com/maddiedreese/multAIplayer.git").is_ok());
        assert!(ensure_git_remote_url("git@github.com:maddiedreese/multAIplayer.git").is_ok());
        assert!(
            ensure_git_remote_url("ssh://git@github.com/maddiedreese/multAIplayer.git").is_ok()
        );
        assert!(
            ensure_git_remote_url("https://example.com/maddiedreese/multAIplayer.git").is_err()
        );
        assert!(
            ensure_git_remote_url(" https://github.com/maddiedreese/multAIplayer.git").is_err()
        );
    }

    #[test]
    fn host_handoff_repo_name_is_derived_from_remote() {
        assert_eq!(
            repo_name_from_remote_url("https://github.com/maddiedreese/multAIplayer.git")
                .expect("repo name"),
            "multAIplayer"
        );
        assert_eq!(
            repo_name_from_remote_url("git@github.com:maddiedreese/multAIplayer.git")
                .expect("repo name"),
            "multAIplayer"
        );
    }

    #[test]
    fn host_handoff_patch_validation_bounds_payload() {
        assert!(ensure_git_patch("diff --git a/README.md b/README.md\n").is_ok());
        assert!(ensure_git_patch("").is_err());
        assert!(ensure_git_patch(&"x".repeat(MAX_GIT_PATCH_CHARS + 1)).is_err());
        assert!(ensure_git_patch("diff\0bad").is_err());
    }

    #[test]
    fn host_handoff_patch_round_trips_tracked_changes() {
        let source =
            std::env::temp_dir().join(format!("multaiplayer-patch-source-{}", std::process::id()));
        let target =
            std::env::temp_dir().join(format!("multaiplayer-patch-target-{}", std::process::id()));
        let _ = fs::remove_dir_all(&source);
        let _ = fs::remove_dir_all(&target);
        fs::create_dir_all(&source).expect("create source repo");
        fs::create_dir_all(&target).expect("create target repo");

        for repo in [&source, &target] {
            Command::new("git")
                .args(["init"])
                .current_dir(repo)
                .output()
                .expect("git init");
            fs::write(repo.join("README.md"), "before\n").expect("seed file");
            Command::new("git")
                .args(["add", "README.md"])
                .current_dir(repo)
                .output()
                .expect("git add");
            Command::new("git")
                .args([
                    "-c",
                    "user.name=multAIplayer",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "-m",
                    "seed",
                ])
                .current_dir(repo)
                .output()
                .expect("git commit");
        }

        fs::write(source.join("README.md"), "after\n").expect("modify source file");
        let patch = git_create_patch(source.to_string_lossy().to_string()).expect("create patch");
        assert!(!patch.patch.is_empty());
        assert!(!patch.truncated);
        let applied = git_apply_patch(GitApplyPatchRequest {
            cwd: target.to_string_lossy().to_string(),
            patch: patch.patch,
        })
        .expect("apply patch");
        assert_eq!(applied.status, Some(0), "{applied:?}");
        assert_eq!(
            fs::read_to_string(target.join("README.md")).expect("read target file"),
            "after\n"
        );

        let _ = fs::remove_dir_all(source);
        let _ = fs::remove_dir_all(target);
    }

    #[test]
    fn command_output_is_bounded_with_truncation_marker() {
        let huge_output = format!(
            "first line\n{}\nlast line",
            "x".repeat(MAX_COMMAND_OUTPUT_CHARS + 50_000)
        );
        let bounded = bound_command_output(huge_output.as_bytes());

        assert!(bounded.chars().count() <= MAX_COMMAND_OUTPUT_CHARS);
        assert!(bounded.contains("multAIplayer truncated command output"));
        assert!(bounded.starts_with("first line"));
        assert!(bounded.ends_with("last line"));
    }

    #[test]
    fn untracked_file_diff_streams_and_bounds_large_files() {
        let root = test_temp_dir("untracked-diff-bounds");
        let path = root.join("generated.log");
        write(
            &path,
            format!(
                "first line\n{}\nlast line",
                "x".repeat(MAX_GIT_DIFF_CHARS + 50_000)
            ),
        )
        .expect("write generated file");

        let diff = untracked_file_diff(&path, "generated.log").expect("untracked diff");

        assert!(diff.chars().count() <= MAX_GIT_DIFF_CHARS);
        assert!(diff.starts_with("+++ b/generated.log"));
        assert!(diff.contains("+first line"));
        assert!(diff.contains("multAIplayer truncated this diff"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validate_browser_url_allows_http_and_https_with_hosts() {
        assert_eq!(
            validate_browser_url("https://github.com/maddiedreese/multAIplayer")
                .expect("valid https")
                .host_str(),
            Some("github.com")
        );
        assert_eq!(
            validate_browser_url("http://127.0.0.1:1420")
                .expect("valid local http")
                .host_str(),
            Some("127.0.0.1")
        );
    }

    #[test]
    fn validate_browser_url_rejects_non_web_schemes_and_missing_hosts() {
        assert!(validate_browser_url("file:///etc/passwd").is_err());
        assert!(validate_browser_url("javascript:alert(1)").is_err());
        assert!(validate_browser_url("http:/").is_err());
    }

    #[test]
    fn sanitize_window_label_replaces_unsupported_room_id_characters() {
        assert_eq!(
            sanitize_window_label("room:../../secret page"),
            "room-------secret-page"
        );
    }

    #[test]
    fn browser_profile_scope_is_separate_per_project() {
        let first = browser_profile_scope("room-alpha", Some("/Users/maddie/project-a"))
            .expect("first browser profile scope");
        let second = browser_profile_scope("room-alpha", Some("/Users/maddie/project-b"))
            .expect("second browser profile scope");
        let first_again = browser_profile_scope("room-alpha", Some("  /Users/maddie/project-a  "))
            .expect("stable browser profile scope");

        assert_ne!(first, second);
        assert_eq!(first, first_again);
        assert!(first.starts_with("room-alpha--project-"));
        assert!(
            browser_window_label("room-alpha", Some("/Users/maddie/project-a"))
                .expect("browser label")
                .starts_with("room-browser-room-alpha--project-")
        );
    }

    #[test]
    fn room_browser_guard_script_blocks_clipboard_and_file_inputs() {
        assert!(ROOM_BROWSER_GUARD_SCRIPT.contains("navigator.clipboard"));
        assert!(ROOM_BROWSER_GUARD_SCRIPT.contains("writeText"));
        assert!(ROOM_BROWSER_GUARD_SCRIPT.contains("input[type=file]"));
        assert!(ROOM_BROWSER_GUARD_SCRIPT.contains("dragover"));
        assert!(ROOM_BROWSER_GUARD_SCRIPT.contains("drop"));
    }

    #[test]
    fn keychain_account_rejects_room_ids_with_unsupported_characters() {
        assert!(keychain_account("room-alpha_123").is_ok());
        assert!(keychain_account("").is_err());
        assert!(keychain_account(" room-alpha").is_err());
        assert!(keychain_account("room alpha").is_err());
        assert!(keychain_account("room.alpha").is_err());
        assert!(keychain_account("room:../../secret").is_err());
        assert!(keychain_account(&"x".repeat(MAX_ROOM_ID_CHARS + 1)).is_err());
    }

    #[test]
    fn device_identity_payload_validation_bounds_native_storage() {
        assert!(ensure_device_identity_payload(r#"{"algorithm":"ECDH"}"#).is_ok());
        assert!(ensure_device_identity_payload("").is_err());
        assert!(ensure_device_identity_payload("not-json").is_err());
        assert!(
            ensure_device_identity_payload(&"{".repeat(MAX_DEVICE_IDENTITY_CHARS + 1)).is_err()
        );
    }

    #[test]
    fn terminal_validation_rejects_bad_names_and_oversized_text() {
        assert!(ensure_room_id("room-alpha_123").is_ok());
        assert!(ensure_room_id("room.alpha").is_err());
        assert!(ensure_room_id("room/alpha").is_err());
        assert!(ensure_room_id(&"x".repeat(MAX_ROOM_ID_CHARS + 1)).is_err());

        assert!(ensure_terminal_id("room-alpha_123:dev-server.1").is_ok());
        assert!(ensure_terminal_id("room-alpha_123").is_err());
        assert!(ensure_terminal_id("room-alpha_123:dev server").is_err());
        assert!(ensure_terminal_id("room-alpha_123:dev:server").is_err());

        assert!(ensure_terminal_name("dev-server.1").is_ok());
        assert!(ensure_terminal_name("").is_err());
        assert!(ensure_terminal_name("bad name").is_err());
        assert!(ensure_terminal_name("bad:name").is_err());

        assert!(ensure_terminal_command("npm test").is_ok());
        assert!(ensure_terminal_command("   ").is_err());
        assert!(ensure_terminal_command(&"x".repeat(MAX_TERMINAL_COMMAND_CHARS + 1)).is_err());

        assert!(ensure_terminal_input("rs").is_ok());
        assert!(ensure_terminal_input("\r").is_ok());
        assert!(ensure_terminal_input("\u{3}").is_ok());
        assert!(ensure_terminal_input("").is_err());
        assert!(ensure_terminal_input(&"x".repeat(MAX_TERMINAL_INPUT_CHARS + 1)).is_err());
    }

    #[test]
    fn branch_validation_rejects_unsafe_git_refs() {
        assert!(ensure_safe_branch_name("codex/ship-it").is_ok());
        for branch in [
            "",
            " codex/ship-it",
            "-bad",
            "@",
            "bad branch",
            "bad\nbranch",
            "bad..branch",
            "bad~branch",
            "bad^branch",
            "bad:branch",
            "bad?branch",
            "bad*branch",
            "bad[branch",
            "bad\\branch",
            "bad//branch",
            ".bad/branch",
            "bad/.branch",
            "bad/branch.lock",
            "bad/",
            "bad.",
            "bad@{branch",
        ] {
            assert!(
                ensure_safe_branch_name(branch).is_err(),
                "{branch} should be rejected"
            );
        }
        assert!(
            ensure_safe_branch_name(&format!("codex/{}", "x".repeat(MAX_GIT_BRANCH_CHARS)))
                .is_err()
        );
    }

    #[test]
    fn commit_message_validation_trims_normalizes_and_bounds_text() {
        assert_eq!(
            normalize_commit_message("  Ship   the thing\nnow  ").expect("valid message"),
            "Ship the thing now"
        );
        assert!(normalize_commit_message(" \n\t ").is_err());
        assert!(normalize_commit_message(&"x".repeat(MAX_COMMIT_MESSAGE_CHARS + 1)).is_err());
    }

    #[test]
    fn one_shot_shell_command_uses_terminal_command_bounds() {
        let root = test_temp_dir("shell-command-bounds");

        assert!(run_shell_command(ShellCommandRequest {
            cwd: root.to_string_lossy().to_string(),
            command: "   ".to_string(),
        })
        .is_err());
        assert!(run_shell_command(ShellCommandRequest {
            cwd: root.to_string_lossy().to_string(),
            command: "x".repeat(MAX_TERMINAL_COMMAND_CHARS + 1),
        })
        .is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_turn_validation_bounds_input_and_timeout() {
        assert!(ensure_codex_input("Summarize the room").is_ok());
        assert!(ensure_codex_input("   ").is_err());
        assert!(ensure_codex_input(&"x".repeat(MAX_CODEX_INPUT_CHARS + 1)).is_err());

        assert_eq!(
            codex_timeout(None).expect("default timeout"),
            Duration::from_secs(180)
        );
        assert_eq!(
            codex_timeout(Some(MIN_CODEX_TIMEOUT_SECONDS)).expect("minimum timeout"),
            Duration::from_secs(MIN_CODEX_TIMEOUT_SECONDS)
        );
        assert_eq!(
            codex_timeout(Some(MAX_CODEX_TIMEOUT_SECONDS)).expect("maximum timeout"),
            Duration::from_secs(MAX_CODEX_TIMEOUT_SECONDS)
        );
        assert!(codex_timeout(Some(MIN_CODEX_TIMEOUT_SECONDS - 1)).is_err());
        assert!(codex_timeout(Some(MAX_CODEX_TIMEOUT_SECONDS + 1)).is_err());
    }

    #[test]
    fn codex_thread_id_validation_bounds_resume_ids() {
        assert_eq!(
            normalize_codex_thread_id(Some("  thr_123-abc:def.456  ")).expect("valid thread id"),
            Some("thr_123-abc:def.456".to_string())
        );
        assert_eq!(normalize_codex_thread_id(Some("   ")).expect("blank"), None);
        assert!(normalize_codex_thread_id(Some("bad thread")).is_err());
        assert!(normalize_codex_thread_id(Some("bad/thread")).is_err());
        assert!(
            normalize_codex_thread_id(Some(&"x".repeat(MAX_CODEX_THREAD_ID_CHARS + 1))).is_err()
        );
    }

    #[test]
    fn codex_thread_request_starts_or_resumes_room_thread() {
        let start = codex_thread_request(2, None, "/tmp/project", "gpt-5.3-codex-spark");
        assert_eq!(start["method"], "thread/start");
        assert_eq!(start["id"], 2);
        assert_eq!(start["params"]["cwd"], "/tmp/project");
        assert_eq!(start["params"]["model"], "gpt-5.3-codex-spark");

        let resume = codex_thread_request(3, Some("thr_room_123"), "/tmp/project", "gpt-5.3-codex");
        assert_eq!(resume["method"], "thread/resume");
        assert_eq!(resume["id"], 3);
        assert_eq!(resume["params"]["threadId"], "thr_room_123");
        assert_eq!(resume["params"]["cwd"], "/tmp/project");
        assert_eq!(resume["params"]["model"], "gpt-5.3-codex");
        assert_eq!(resume["params"]["excludeTurns"], true);
    }

    #[test]
    fn codex_server_key_is_scoped_to_room_project_and_model() {
        let sandbox = codex_sandbox_config(Some("workspace_write")).expect("workspace sandbox");
        let base = codex_server_key(
            Some("room-alpha"),
            "/tmp/project",
            "gpt-5.3-codex",
            "medium",
            "default",
            &sandbox,
        )
        .expect("valid codex session key");
        let same = codex_server_key(
            Some("room-alpha"),
            "/tmp/project",
            "gpt-5.3-codex",
            "medium",
            "default",
            &sandbox,
        )
        .expect("same codex session key");
        let different_room = codex_server_key(
            Some("room-beta"),
            "/tmp/project",
            "gpt-5.3-codex",
            "medium",
            "default",
            &sandbox,
        )
        .expect("different room key");
        let different_project = codex_server_key(
            Some("room-alpha"),
            "/tmp/other",
            "gpt-5.3-codex",
            "medium",
            "default",
            &sandbox,
        )
        .expect("different project key");
        let different_model = codex_server_key(
            Some("room-alpha"),
            "/tmp/project",
            "gpt-5.3-codex-spark",
            "medium",
            "default",
            &sandbox,
        )
        .expect("different model key");
        let different_reasoning = codex_server_key(
            Some("room-alpha"),
            "/tmp/project",
            "gpt-5.3-codex",
            "high",
            "default",
            &sandbox,
        )
        .expect("different reasoning key");
        let different_speed = codex_server_key(
            Some("room-alpha"),
            "/tmp/project",
            "gpt-5.3-codex",
            "medium",
            "fast",
            &sandbox,
        )
        .expect("different speed key");
        let different_sandbox = codex_server_key(
            Some("room-alpha"),
            "/tmp/project",
            "gpt-5.3-codex",
            "medium",
            "default",
            &codex_sandbox_config(Some("read_only")).expect("read-only sandbox"),
        )
        .expect("different sandbox key");

        assert_eq!(base, same);
        assert_ne!(base, different_room);
        assert_ne!(base, different_project);
        assert_ne!(base, different_model);
        assert_ne!(base, different_reasoning);
        assert_ne!(base, different_speed);
        assert_ne!(base, different_sandbox);
        assert!(codex_server_key(
            Some("room/alpha"),
            "/tmp/project",
            "gpt-5.3-codex",
            "medium",
            "default",
            &sandbox
        )
        .is_err());
    }

    #[test]
    fn codex_room_shutdown_matches_all_sessions_for_room_only() {
        let sandbox = codex_sandbox_config(Some("workspace_write")).expect("workspace sandbox");
        let room_a_main = codex_server_key(
            Some("room-alpha"),
            "/tmp/project",
            "gpt-5.3-codex",
            "medium",
            "default",
            &sandbox,
        )
        .expect("room alpha key");
        let room_a_model = codex_server_key(
            Some("room-alpha"),
            "/tmp/project",
            "gpt-5.3-codex-spark",
            "medium",
            "default",
            &sandbox,
        )
        .expect("room alpha model key");
        let room_b = codex_server_key(
            Some("room-beta"),
            "/tmp/project",
            "gpt-5.3-codex",
            "medium",
            "default",
            &sandbox,
        )
        .expect("room beta key");

        assert!(should_shutdown_codex_session_for_room(
            &room_a_main,
            "room-alpha"
        ));
        assert!(should_shutdown_codex_session_for_room(
            &room_a_model,
            "room-alpha"
        ));
        assert!(!should_shutdown_codex_session_for_room(
            &room_b,
            "room-alpha"
        ));
    }

    #[test]
    fn terminal_output_buffer_keeps_latest_lines() {
        let output = Arc::new(Mutex::new(Vec::new()));
        for index in 0..1_005 {
            push_terminal_line(
                &output,
                TerminalLine {
                    stream: "stdout".to_string(),
                    text: format!("line {index}"),
                },
            );
        }

        let lines = output.lock().expect("terminal output lock");
        assert_eq!(lines.len(), 1_000);
        assert_eq!(lines.first().map(|line| line.text.as_str()), Some("line 5"));
        assert_eq!(
            lines.last().map(|line| line.text.as_str()),
            Some("line 1004")
        );
    }

    fn test_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("multaiplayer-{name}-{nanos}"));
        create_dir_all(&path).expect("create temp dir");
        path
    }
}
