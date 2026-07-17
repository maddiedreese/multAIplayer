# Tauri IPC boundary review

Status: manually reviewed on 2026-07-16 through the repository revision that
contains this document. The review does not automatically apply to later
implementations with the same command names; Git history identifies the exact
reviewed source.

The generated list at the end is only a registration inventory. Its freshness
check catches command additions and removals; it does not inspect behavior,
validate this review, or provide security evidence by itself.

## Review method

For each registered command, the review traced:

1. sensitive inputs and outputs;
2. Rust-side validation of untrusted values;
3. the native authorization or state prerequisite; and
4. behavior before initialization, after expiry, across rooms, and during
   incompatible transitions.

The Tauri main webview remains part of the trusted computing base. Commands that
return project plaintext or perform constrained signing are intentional parts of
that boundary; the native layer does not make a compromised main webview safe.

## Findings closed in the reviewed tree

- **IPC-01 — filesystem permission grants were blocklist-based.** Codex
  filesystem grants now fail closed unless every path is canonically beneath the
  active room's natively approved project root. Relative paths, parent and
  symlink escapes, globs, special-directory grants, malformed shapes, missing
  roots, and network grants are denied before approval and rechecked immediately
  before the response is sent.
- **IPC-02 — Codex roots and positive approvals trusted webview intent.** The
  native layer now confirms and stores the canonical project root plus execution
  profile. Root/profile changes prompt again. Positive command, file-change, and
  permission responses require a native confirmation bound to the exact pending
  room, request, and method; denials remain prompt-free.

## Residual boundaries

- **IPC-03 — room IDs scope native state; they do not authenticate callers.**
  Several terminal, Codex, MLS, and outbox commands rely on the single trusted
  main webview. Before introducing mutually untrusted local principals, bind
  room authority to an unforgeable native session.
- **IPC-04 — plaintext and constrained signing deliberately cross IPC.** File,
  archive, terminal, Codex, MLS-processing, and history commands return content
  needed by the UI. Device-auth and host-transfer commands expose constrained
  signing operations. Private keys, OAuth tokens, relay cookies, invite
  verifiers, and exporter secrets are not returned, but a compromised main
  webview can still invoke the allowed surface.
- **IPC-05 — native confirmation authorizes exact commands, not their semantic
  safety.** Shell and terminal execution use bounded, expiring, exact-parameter
  grants and the macOS sandbox. Text risk labels are review aids only.
- **IPC-06 — non-Codex project roots are still local UI selections.** Project,
  Git, shell, and clone commands validate paths and containment, but their
  initial roots are not all native room grants. A future plugin or untrusted-web
  model needs separate native grants.
- **IPC-07 — path authorization cannot eliminate filesystem TOCTOU.** Roots and
  existing ancestors are canonicalized when a grant is registered and rechecked
  after confirmation, but portable path checks cannot pin directory inodes
  against later replacement. Operation-time checks and sandboxing remain
  necessary.

## Maintenance

Changing a command's inputs, outputs, authority, process or network behavior,
path reach, or cross-room visibility requires a fresh manual review and an
updated reviewed commit/tree pair above. Adding or removing a registration also
requires regenerating the list with `npm run docs:sync-ipc-inventory`.

<!-- BEGIN GENERATED IPC COMMANDS -->

Generated from `declare_registered_commands!` in `apps/desktop/src-tauri/src/lib.rs`: 107 commands.

```text
app_version
authorize_shell_execution
authorize_terminal_input
browser_view_state
clear_codex_goal
clear_shell_execution_grants
close_browser_view
codex_account_login_cancel
codex_account_login_start
codex_account_logout
codex_app_approval_mode_set
codex_host_snapshot
codex_mcp_login_start
detect_local_preview_servers
fork_codex_thread
get_codex_goal
git_apply_patch
git_clone_repository
git_create_patch
git_diff_file
git_remote_origin
git_status
github_create_pull_request
github_device_flow_cancel
github_device_flow_poll
github_device_flow_start
github_list_action_runs
github_repository_access_status
github_repository_device_flow_poll
github_repository_device_flow_start
github_token_delete
list_codex_server_requests
list_codex_threads
local_preview_start
local_preview_status
local_preview_stop
local_preview_stop_all
mls_blob_decrypt
mls_blob_encrypt
mls_blob_prepare
mls_clear_pending_commit
mls_create_group
mls_current_epoch
mls_device_auth_sign
mls_encrypt_application
mls_forget_corrupt_group
mls_generate_key_package
mls_group_open
mls_group_state
mls_history_delete
mls_history_delete_all
mls_history_load
mls_history_load_latest
mls_history_retention_set
mls_history_save
mls_host_transfer_authorization
mls_identity_initialize
mls_invite_approve
mls_invite_capability_issue
mls_invite_deny
mls_invite_request_open
mls_invite_request_seal
mls_invite_response_accept
mls_join_admission_complete
mls_join_admissions_list
mls_join_welcome
mls_outbox_list
mls_pending_invite_complete
mls_pending_invite_requests_list
mls_pending_invite_response_accept
mls_process_incoming
mls_publish_succeeded
mls_remove_member
mls_retire_stale_application
mls_room_config_load
mls_room_local_data_delete
mls_transfer_host
navigate_browser_view
open_browser_view
open_trusted_authentication_url
position_browser_view
probe_cloudflared
probe_codex
project_file_read
project_file_write
project_files
record_diagnostic
respond_codex_server_request
room_archive_delete
room_archive_export
room_archive_import
room_archive_list
room_archive_open
run_codex_turn
run_git_workflow
run_shell_command
save_diagnostic_bundle
set_codex_goal
shutdown_codex_room
steer_codex_turn
take_pending_native_invite
take_updater_auth_failure
terminal_list
terminal_read
terminal_start
terminal_stop
terminal_write
```

<!-- END GENERATED IPC COMMANDS -->
