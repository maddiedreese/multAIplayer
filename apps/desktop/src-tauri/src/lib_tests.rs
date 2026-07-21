use super::*;
use crate::output::*;
use crate::validation::*;
use crate::workspace::{ensure_existing_dir, ensure_within_project_root};
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
    assert!(ensure_existing_dir(&format!("/tmp/{}", "x".repeat(MAX_PROJECT_PATH_CHARS))).is_err());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn approved_project_root_rejects_outside_and_symlinked_working_directories() {
    let root = test_temp_dir("approved-project-root");
    let nested = root.join("nested");
    let outside = test_temp_dir("approved-project-outside");
    create_dir_all(&nested).expect("create nested directory");

    assert_eq!(
        ensure_within_project_root(&root.to_string_lossy(), &nested.to_string_lossy())
            .expect("nested working directory"),
        fs::canonicalize(&nested).expect("canonical nested directory")
    );
    assert!(
        ensure_within_project_root(&root.to_string_lossy(), &outside.to_string_lossy()).is_err()
    );

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&outside, root.join("outside-link")).expect("create symlink");
        assert!(ensure_within_project_root(
            &root.to_string_lossy(),
            &root.join("outside-link").to_string_lossy()
        )
        .is_err());
    }

    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside);
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

    let written =
        tauri::async_runtime::block_on(project_file_write(project::ProjectFileWriteRequest {
            cwd: cwd.clone(),
            path: "src/new-file.ts".to_string(),
            content: "export const saved = true;\n".to_string(),
            expected_content: None,
        }))
        .expect("write project file");

    assert_eq!(written.path, "src/new-file.ts");
    assert_eq!(
        fs::read_to_string(root.join("src/new-file.ts")).expect("read saved file"),
        "export const saved = true;\n"
    );
    let error =
        tauri::async_runtime::block_on(project_file_write(project::ProjectFileWriteRequest {
            cwd,
            path: "../secret.txt".to_string(),
            content: "nope".to_string(),
            expected_content: None,
        }))
        .expect_err("path escape should fail");
    assert_eq!(error.code, command_error::CommandErrorCode::InvalidArgument);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn project_file_write_rejects_stale_content_and_symlink_parent_escape() {
    let root = test_temp_dir("project-file-cas");
    let outside = test_temp_dir("project-file-cas-outside");
    fs::write(root.join("tracked.txt"), "newer\n").expect("seed current file");
    let stale =
        tauri::async_runtime::block_on(project_file_write(project::ProjectFileWriteRequest {
            cwd: root.to_string_lossy().to_string(),
            path: "tracked.txt".to_string(),
            content: "overwrite\n".to_string(),
            expected_content: Some("older\n".to_string()),
        }))
        .expect_err("stale editor content must not overwrite disk");
    assert_eq!(stale.code, command_error::CommandErrorCode::InvalidArgument);
    assert_eq!(
        fs::read_to_string(root.join("tracked.txt")).unwrap(),
        "newer\n"
    );

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&outside, root.join("linked"))
            .expect("create directory symlink");
        let escaped =
            tauri::async_runtime::block_on(project_file_write(project::ProjectFileWriteRequest {
                cwd: root.to_string_lossy().to_string(),
                path: "linked/secret.txt".to_string(),
                content: "escape".to_string(),
                expected_content: None,
            }))
            .expect_err("symlink parent must not escape the project");
        assert_eq!(
            escaped.code,
            command_error::CommandErrorCode::InvalidArgument
        );
        assert!(!outside.join("secret.txt").exists());
    }
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside);
}

#[test]
fn project_file_read_returns_allowlisted_raster_images_as_bounded_data_urls() {
    let root = test_temp_dir("project-image-read");
    let cwd = root.to_str().expect("utf8 temp path").to_string();
    let fixtures = [
        (
            "image.png",
            vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
            "image/png",
        ),
        ("image.jpg", vec![0xff, 0xd8, 0xff, 0xe0], "image/jpeg"),
        ("image.gif", b"GIF89a".to_vec(), "image/gif"),
        ("image.webp", b"RIFF\0\0\0\0WEBP".to_vec(), "image/webp"),
    ];
    for (path, bytes, expected_media_type) in fixtures {
        write(root.join(path), bytes).expect("write image fixture");
        let read =
            tauri::async_runtime::block_on(project_file_read(project::ProjectFileReadRequest {
                cwd: cwd.clone(),
                path: path.to_string(),
                max_bytes: Some(1_024),
            }))
            .expect("read image fixture");
        assert_eq!(read.media_type.as_deref(), Some(expected_media_type));
        assert!(read
            .content
            .starts_with(&format!("data:{expected_media_type};base64,")));
        assert!(!read.truncated);
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn project_file_read_rejects_mislabeled_and_oversized_raster_images() {
    let root = test_temp_dir("project-image-reject");
    let cwd = root.to_str().expect("utf8 temp path").to_string();
    write(root.join("not-really.png"), b"<svg onload='bad'></svg>")
        .expect("write mismatched image");
    assert!(
        tauri::async_runtime::block_on(project_file_read(project::ProjectFileReadRequest {
            cwd: cwd.clone(),
            path: "not-really.png".to_string(),
            max_bytes: None,
        }))
        .is_err()
    );

    let oversized = fs::File::create(root.join("oversized.webp")).expect("create oversized image");
    oversized
        .set_len(2_500_001)
        .expect("size oversized image fixture");
    assert!(
        tauri::async_runtime::block_on(project_file_read(project::ProjectFileReadRequest {
            cwd,
            path: "oversized.webp".to_string(),
            max_bytes: None,
        }))
        .is_err()
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn project_file_read_emits_stable_not_found_and_invalid_argument_codes() {
    let root = test_temp_dir("project-file-error-codes");
    let cwd = root.to_str().expect("utf8 temp path").to_string();

    let missing =
        tauri::async_runtime::block_on(project_file_read(project::ProjectFileReadRequest {
            cwd: cwd.clone(),
            path: "missing.txt".to_string(),
            max_bytes: None,
        }))
        .expect_err("missing file should fail");
    assert_eq!(missing.code, command_error::CommandErrorCode::NotFound);

    let escape =
        tauri::async_runtime::block_on(project_file_read(project::ProjectFileReadRequest {
            cwd,
            path: "../secret.txt".to_string(),
            max_bytes: None,
        }))
        .expect_err("path escape should fail");
    assert_eq!(
        escape.code,
        command_error::CommandErrorCode::InvalidArgument
    );

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
    assert!(ensure_git_remote_url("ssh://git@github.com/maddiedreese/multAIplayer.git").is_ok());
    assert!(ensure_git_remote_url("https://example.com/maddiedreese/multAIplayer.git").is_err());
    assert!(ensure_git_remote_url(" https://github.com/maddiedreese/multAIplayer.git").is_err());
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
    let patch =
        tauri::async_runtime::block_on(git_create_patch(source.to_string_lossy().to_string()))
            .expect("create patch");
    assert!(!patch.patch.is_empty());
    assert!(!patch.truncated);
    let applied = tauri::async_runtime::block_on(git_apply_patch(GitApplyPatchRequest {
        cwd: target.to_string_lossy().to_string(),
        project_root: target.to_string_lossy().to_string(),
        patch: patch.patch,
    }))
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
fn process_output_redacts_secrets_before_truncation() {
    let token = format!("ghp_{}", "a".repeat(40));
    let output = format!(
        "{}{}{}",
        "x".repeat(MAX_COMMAND_OUTPUT_CHARS),
        token,
        "y".repeat(50_000)
    );
    let safe = redact_and_bound_command_output(output.as_bytes());
    assert!(safe.chars().count() <= MAX_COMMAND_OUTPUT_CHARS);
    assert!(!safe.contains(&token));
    assert!(safe.contains("REDACTED BY MULTAIPLAYER"));
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
fn browser_view_scope_is_separate_per_project() {
    let first = browser_view_scope("room-alpha", Some("/Users/maddie/project-a"))
        .expect("first browser view scope");
    let second = browser_view_scope("room-alpha", Some("/Users/maddie/project-b"))
        .expect("second browser view scope");
    let first_again = browser_view_scope("room-alpha", Some("  /Users/maddie/project-a  "))
        .expect("stable browser view scope");

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
fn main_webview_capability_covers_every_registered_command() {
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("parse default capability");
    assert!(capability.get("windows").is_none());
    assert_eq!(capability["webviews"], serde_json::json!(["main"]));
    assert!(capability.get("remote").is_none());

    let permissions = capability["permissions"]
        .as_array()
        .expect("capability permissions");
    for command in REGISTERED_COMMAND_NAMES {
        let permission = format!("allow-{}", command.replace('_', "-"));
        assert!(
            permissions.iter().any(|entry| entry == &permission),
            "missing permission for {command}"
        );
    }
}

#[test]
fn app_command_acl_allows_only_the_local_main_webview() {
    use tauri::ipc::CallbackFn;
    use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    fn request(url: &str) -> InvokeRequest {
        InvokeRequest {
            cmd: "app_version".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: url.parse().expect("valid request URL"),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        }
    }

    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![app_version])
        .build(app_context())
        .expect("build ACL test app");
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build main webview");
    let local_url = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };

    let allowed = get_ipc_response(&main, request(local_url)).expect("main command allowed");
    assert_eq!(
        allowed
            .deserialize::<String>()
            .expect("deserialize app version"),
        env!("CARGO_PKG_VERSION")
    );
    assert!(get_ipc_response(&main, request("https://example.com")).is_err());

    let child = main
        .as_ref()
        .window()
        .add_child(
            tauri::webview::WebviewBuilder::new(
                "embedded",
                tauri::WebviewUrl::App("index.html".into()),
            ),
            tauri::LogicalPosition::new(0.0, 0.0),
            tauri::LogicalSize::new(100.0, 100.0),
        )
        .expect("build unprivileged child webview");
    let (response_tx, response_rx) = std::sync::mpsc::sync_channel(1);
    child.clone().on_message(
        request(local_url),
        Box::new(move |_webview, _command, response, _callback, _error| {
            response_tx.send(response).expect("return IPC response");
        }),
    );
    assert!(matches!(
        response_rx.recv().expect("receive child IPC response"),
        tauri::ipc::InvokeResponse::Err(_)
    ));

    let other = tauri::WebviewWindowBuilder::new(&app, "other", Default::default())
        .build()
        .expect("build unprivileged webview");
    assert!(get_ipc_response(&other, request(local_url)).is_err());
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
        ensure_safe_branch_name(&format!("codex/{}", "x".repeat(MAX_GIT_BRANCH_CHARS))).is_err()
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
fn one_shot_shell_command_validation_uses_terminal_command_bounds() {
    let root = test_temp_dir("shell-command-bounds");

    assert!(ensure_existing_dir(&root.to_string_lossy()).is_ok());
    assert!(ensure_terminal_command("   ").is_err());
    assert!(ensure_terminal_command(&"x".repeat(MAX_TERMINAL_COMMAND_CHARS + 1)).is_err());

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
    assert!(normalize_codex_thread_id(Some(&"x".repeat(MAX_CODEX_THREAD_ID_CHARS + 1))).is_err());
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
        "room-alpha",
        "/tmp/project",
        "gpt-5.3-codex",
        "medium",
        "default",
        &sandbox,
    )
    .expect("valid codex session key");
    let same = codex_server_key(
        "room-alpha",
        "/tmp/project",
        "gpt-5.3-codex",
        "medium",
        "default",
        &sandbox,
    )
    .expect("same codex session key");
    let different_room = codex_server_key(
        "room-beta",
        "/tmp/project",
        "gpt-5.3-codex",
        "medium",
        "default",
        &sandbox,
    )
    .expect("different room key");
    let different_project = codex_server_key(
        "room-alpha",
        "/tmp/other",
        "gpt-5.3-codex",
        "medium",
        "default",
        &sandbox,
    )
    .expect("different project key");
    let different_model = codex_server_key(
        "room-alpha",
        "/tmp/project",
        "gpt-5.3-codex-spark",
        "medium",
        "default",
        &sandbox,
    )
    .expect("different model key");
    let different_reasoning = codex_server_key(
        "room-alpha",
        "/tmp/project",
        "gpt-5.3-codex",
        "high",
        "default",
        &sandbox,
    )
    .expect("different reasoning key");
    let different_speed = codex_server_key(
        "room-alpha",
        "/tmp/project",
        "gpt-5.3-codex",
        "medium",
        "fast",
        &sandbox,
    )
    .expect("different speed key");
    let different_sandbox = codex_server_key(
        "room-alpha",
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
        "room/alpha",
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
        "room-alpha",
        "/tmp/project",
        "gpt-5.3-codex",
        "medium",
        "default",
        &sandbox,
    )
    .expect("room alpha key");
    let room_a_model = codex_server_key(
        "room-alpha",
        "/tmp/project",
        "gpt-5.3-codex-spark",
        "medium",
        "default",
        &sandbox,
    )
    .expect("room alpha model key");
    let room_b = codex_server_key(
        "room-beta",
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

#[test]
fn terminal_output_buffer_never_retains_interactive_input() {
    let output = Arc::new(Mutex::new(vec![TerminalLine {
        stream: "stdout".to_string(),
        text: "Password: ".to_string(),
    }]));

    push_terminal_line(
        &output,
        TerminalLine {
            stream: "stdin".to_string(),
            text: "ghp_attacker_shaped_secret".to_string(),
        },
    );

    let lines = output.lock().expect("terminal output lock");
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].text, "Password: ");
}

#[test]
fn terminal_secret_redaction_covers_tokens_env_and_private_keys() {
    let raw = "ghp_abcdefghijklmnopqrstuvwxyz\nOPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
    let redacted = redact_known_secrets(raw);
    assert!(!redacted.contains("ghp_"));
    assert!(!redacted.contains("sk-"));
    assert!(!redacted.contains("abc"));
    assert!(redacted.contains("[REDACTED BY MULTAIPLAYER]"));
}

#[test]
fn terminal_redaction_carries_partial_lines_across_pty_reads() {
    let mut redactor = TerminalStreamRedactor::default();
    assert!(redactor.push("token=ghp_abcdefghij", false).is_empty());
    let output = redactor.push("klmnopqrstuvwxyz\n", false);
    assert_eq!(output.len(), 1);
    assert!(!output[0].contains("ghp_"));
    assert!(output[0].contains("[REDACTED BY MULTAIPLAYER]"));
}

#[test]
fn terminal_redaction_suppresses_split_multiline_private_keys() {
    let mut redactor = TerminalStreamRedactor::default();
    assert!(redactor.push("before\n-----BEGIN OPENSSH PRI", false)[0].contains("before"));
    let mut output = redactor.push(
        "VATE KEY-----\nsuper-secret-body\n-----END OPENSSH PRIVATE",
        false,
    );
    output.extend(redactor.push(" KEY-----\nafter\n", true));
    let joined = output.join("");
    assert!(joined.contains("[REDACTED BY MULTAIPLAYER]"));
    assert!(joined.contains("after"));
    assert!(!joined.contains("super-secret-body"));
    assert!(!joined.contains("BEGIN OPENSSH"));
    assert!(!joined.contains("END OPENSSH"));
}

#[test]
fn terminal_redaction_bounds_newline_free_output_and_flushes_safely() {
    let mut redactor = TerminalStreamRedactor::default();
    let output = redactor.push(&"x".repeat(20_000), false);
    assert_eq!(output, vec!["[REDACTED BY MULTAIPLAYER]\n"]);
    assert!(redactor.pending_bytes() <= 8 * 1024);
    assert!(redactor.push("continued-secret", false).is_empty());
    let resumed = redactor.push("\nsafe\n", true).join("");
    assert_eq!(resumed, "safe\n");
    assert_eq!(redactor.pending_bytes(), 0);
}

#[cfg(target_os = "macos")]
#[test]
fn interactive_terminal_uses_the_users_shell_directly() {
    let (program, args) = crate::host_sandbox::interactive_terminal_program(
        "/bin/zsh",
        "/tmp/room-project",
        "interactive-login-shell",
    )
    .expect("interactive terminal program");

    assert_eq!(program, "/bin/zsh");
    assert_eq!(args, vec!["-l"]);
}

#[cfg(target_os = "macos")]
#[test]
fn host_sandbox_allows_project_work_and_blocks_outside_project_files() {
    let workspace = test_temp_dir("sandbox-workspace");
    let outside = test_temp_dir("sandbox-outside");
    write(outside.join("secret.txt"), "outside").expect("write outside fixture");
    let canonical_workspace = fs::canonicalize(&workspace).expect("canonical workspace");
    let canonical_outside = fs::canonicalize(&outside).expect("canonical outside");
    let workspace_path = canonical_workspace.to_str().expect("utf8 workspace");
    let outside_path = canonical_outside.to_str().expect("utf8 outside");

    let inside = crate::host_sandbox::sandboxed_shell_command(
        "/bin/zsh",
        workspace_path,
        "printf inside > result.txt && /usr/bin/wc -c result.txt",
    )
    .expect("sandbox command")
    .output()
    .expect("run inside command");
    assert!(
        inside.status.success(),
        "inside command failed: {}",
        String::from_utf8_lossy(&inside.stderr)
    );
    assert_eq!(
        fs::read_to_string(workspace.join("result.txt")).unwrap(),
        "inside"
    );

    let escape = crate::host_sandbox::sandboxed_shell_command(
        "/bin/zsh",
        workspace_path,
        &format!("cat '{outside_path}/secret.txt'; printf escaped > '{outside_path}/written.txt'"),
    )
    .expect("sandbox escape command")
    .output()
    .expect("run escape command");
    assert!(!escape.status.success());
    assert!(!String::from_utf8_lossy(&escape.stdout).contains("outside"));
    assert!(!outside.join("written.txt").exists());

    let profile = crate::host_sandbox::macos_profile(workspace_path);
    assert!(profile.contains("/opt/homebrew"));
    assert!(profile.contains("/Library/Developer"));
    assert!(!profile.contains(&std::env::var("HOME").unwrap_or_default()));
    let _ = fs::remove_dir_all(workspace);
    let _ = fs::remove_dir_all(outside);
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
