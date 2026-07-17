# Tauri IPC boundary audit

Status: manual review completed 2026-07-15 at commit
`5cb636467ca4c4508c1e06b01152f7091e28cff7` (repository tree
`0dee45c98fd4de70c5df8b60aaa4542441971747`). Registration source:
`apps/desktop/src-tauri/src/lib.rs` (`declare_registered_commands!`). This is a
review snapshot, not a claim that the command surface is automatically proven
safe. A Rust test requires the audited command rows to match that compiler-owned
registration inventory exactly; changing a command's behavior still requires
manual review of its row and an updated reviewed commit/tree pair.

## Review model

Every registered command in the exact-set inventory below was read against four questions:

1. Can the return value contain credentials, cryptographic secrets, plaintext,
   local file contents, account identity, or other sensitive material?
2. Are untrusted strings, byte payloads, URLs, identifiers, paths, and response
   shapes validated in Rust before use?
3. Does the command enforce the relevant authorization boundary (native
   confirmation, one-shot token, canonical project containment, MLS
   membership/state, or trusted remote origin) rather than trusting the
   webview?
4. Does it reject an invocation made before initialization, after expiry, for
   another room, or during an incompatible transition?

The output column uses **public**, **local** (local metadata or project data),
**plaintext**, **credential-adjacent** (codes, account identity, signatures, or
capability material, but not a stored private key/token), and **none**. “Engine”
means the native MLS engine checks group/epoch/member/transition state. “Scoped
identifier” means the value is syntactically checked and selects native state;
it is not proof of caller identity. The Tauri `main` webview is therefore part
of the trusted computing base for every custom command below.

## Findings and decisions

### Closed in this review

- **IPC-01 — filesystem permission grants were blocklist-based.**
  `item/permissions/requestApproval` previously rejected only paths containing
  known credential markers. It now fails closed unless every read/write path
  is canonically beneath the active Codex session project root. Relative paths
  resolve from that root; `..`, symlink escapes, glob grants, special-directory
  grants, malformed shapes, missing session roots, and network grants are
  denied natively before reaching the webview and rechecked after native
  approval immediately before the grant is sent. Credential markers remain
  only an explicitly incomplete approval-UI risk label.
- **IPC-02 — Codex project roots and positive approvals trusted webview
  intent.** `run_codex_turn` now canonicalizes the proposed root and requires
  an operating-system-native confirmation on first use, root change, or
  execution-profile change. Rust stores the canonical root plus sandbox/network
  profile by room, passes only that stored path to Codex, and revokes it on room
  shutdown. Positive command, file-change, and
  permission responses require a second native confirmation bound to the
  exact pending request key, room, and method; denials remain prompt-free. One
  Codex confirmation may be open at a time.

### Residual boundaries that must remain explicit

- **IPC-06 — non-Codex project roots remain local UI selections.** Project,
  Git, shell-authorization, and clone commands validate/canonicalize paths, and
  file operations contain descendants, but their initial roots are not all
  backed by the Codex room-root registry. Those local capabilities remain part
  of the trusted main-webview boundary. A future untrusted-web-content or
  plugin model must give them separate native grants keyed to window/session.
- **IPC-07 — path authorization has an operation-time boundary.** Rust stores
  and rechecks canonical roots and canonical existing ancestors when a Codex
  permission is registered and again after native confirmation. Portable path
  canonicalization cannot pin a directory inode or prevent an authorized
  process from observing a later same-path replacement. The Codex sandbox and
  operation-time filesystem checks remain necessary; this review does not
  claim that a path string eliminates every filesystem TOCTOU race.
- **IPC-03 — room IDs scope state; they do not authenticate an IPC caller.**
  Terminal reads/stops, tunnel operations, Codex request listing/response, MLS
  plaintext operations, and outbox listing rely on the single trusted main
  webview. Do not expose these commands to room browser windows or remote
  origins. Before adding multiple mutually untrusted local principals, bind
  room authority to an unforgeable native session token.
- **IPC-04 — plaintext and signing operations are intentionally present.**
  `project_file_read`, archive open/import, terminal output, Codex turn output,
  `mls_blob_decrypt`, `mls_history_load`, and `mls_process_incoming` return
  plaintext to render it. `mls_device_auth_sign` and host-transfer
  authorization are constrained signing oracles. Private signing/HPKE keys,
  wrapping keys, GitHub OAuth tokens, relay session cookies, invite capability
  verifiers, and history exporter secrets are not returned. An arbitrary-code
  compromise of the main webview can nevertheless invoke the plaintext/signing
  surface, so E2EE claims must not imply protection from that compromise.
- **IPC-05 — native confirmation is command authority, not shell-string
  analysis.** Shell and terminal execution require bounded, expiring,
  exact-parameter tokens and macOS sandboxing. `command_review_risk` is only UI
  labeling; interpreters and mutable project files prevent complete semantic
  classification.

## Command inventory

### Application, links, diagnostics, and browser

| Command                           | Output              | Rust input and authority/state result                                                                                                                                                              |
| --------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_version`                     | public              | No input or mutable state.                                                                                                                                                                         |
| `take_updater_auth_failure`       | public              | No input; atomically reads and clears only the comparator's boolean authentication-failure signal. It exposes no manifest, key, signature, URL, or release metadata.                               |
| `take_pending_native_invite`      | credential-adjacent | One-shot take from bounded native state; the OS URL parser restricts HTTPS hosts, path, ID, and fragment size. Returns the invite bearer to the trusted main webview by design.                    |
| `open_trusted_authentication_url` | none                | Provider allowlist; HTTPS, host, port, credentials, GitHub path, and URL length checked before the system opener. No ambient auth state is returned.                                               |
| `record_diagnostic`               | none                | Diagnostic fields and serialized line size are bounded/redacted; native app-log path, regular-file and private-mode checks apply. Safe before persistence initialization: returns unavailable.     |
| `save_diagnostic_bundle`          | local               | Native save dialog chooses the target; entries are bounded/redacted and output uses private, atomic regular-file writes. Cancellation and unavailable persistence are explicit.                    |
| `open_browser_view`               | none                | HTTPS/HTTP URL policy, room ID, room/project-derived child label, and bounded child-view geometry checked. Rust creates the child view with a nonpersistent data store, denies downloads, disables drag/drop handling, and installs the tested page guard. The frontend has no capability to create arbitrary webviews. |
| `position_browser_view`           | none                | Room/project-derived child label and finite, bounded geometry checked before moving only the existing room browser. The frontend has no direct webview positioning capability.                                               |
| `close_browser_view`              | none                | Room/project-derived child label checked; closes only that existing room-browser child. The frontend has no direct webview close capability.                                                                          |

### Project and Git

| Command                | Output              | Rust input and authority/state result                                                                                                                                                                               |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git_status`           | local               | Absolute existing directory checked; Git argv is structured. Initial directory is a local UI selection under IPC-06.                                                                                                |
| `git_remote_origin`    | local               | Same directory boundary; returns configured origin, which can embed credentials in unusual Git configurations. Treat as local-sensitive UI data.                                                                    |
| `git_create_patch`     | plaintext           | Existing root, bounded output, canonical containment for untracked files, structured Git argv. Patch can contain project secrets and is returned only to main webview.                                              |
| `git_clone_repository` | local               | GitHub-only remote syntax, optional branch grammar, existing parent, derived safe repository name, and collision-safe target. Parent remains a local UI selection (IPC-06); network action is explicit UI workflow. |
| `git_apply_patch`      | none/local status   | Canonical `cwd` must descend from canonical supplied `project_root`; patch size/NUL validation and stdin transport prevent option injection. Root selection remains IPC-06.                                         |
| `git_diff_file`        | plaintext           | Existing canonical root plus symlink-safe relative containment; structured path argument and bounded diff.                                                                                                          |
| `project_files`        | local               | Existing canonical root, clamped result limit and bounded traversal policy. Root selection remains IPC-06.                                                                                                          |
| `project_file_read`    | plaintext           | Relative, non-parent path; canonical/symlink containment, file type, image signature and byte limits. May intentionally return any selected-project file, including secrets (IPC-04).                               |
| `project_file_write`   | none/local metadata | Canonical contained destination, content limit, optional optimistic-content check, private atomic replacement. Parent symlinks are canonicalized. Root selection remains IPC-06.                                    |
| `run_git_workflow`     | local               | Existing directory, strict branch grammar, bounded normalized commit message, structured argv. It can stage all files and optionally push, so it remains a deliberate high-impact main-webview action under IPC-06. |

### GitHub authentication and API

| Command                      | Output              | Rust input and authority/state result                                                                                                                                                                                |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github_device_flow_start`   | credential-adjacent | Compile-time client/scopes validated; exact GitHub HTTPS endpoint, bounded response, pending-flow cap and expiry. Device code stays native; user code/flow ID are returned.                                          |
| `github_device_flow_poll`    | credential-adjacent | Flow must exist, be unexpired and respect polling interval; token response bounded, verified against the pinned relay, stored in keychain, and relay cookie installed directly. OAuth token/cookie are not returned. |
| `github_device_flow_cancel`  | none                | Removes only the opaque flow ID; missing IDs are idempotent. The ID is not separately length-checked, but lookup has no external side effect.                                                                        |
| `github_token_delete`        | none                | Deletes the fixed keychain entry; missing entry is idempotent.                                                                                                                                                       |
| `github_create_pull_request` | local               | Owner/repo/branch/title/body validation, fixed GitHub API origin, redirect-disabled HTTPS client, keychain token use, bounded validated response URL. Requires stored credential state.                              |
| `github_list_action_runs`    | local               | Owner/repo/branch validated; fixed API origin and bounded response fields. Requires stored credential state.                                                                                                         |

### Encrypted room archives

| Command               | Output         | Rust input and authority/state result                                                                                                                                                                |
| --------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `room_archive_export` | local metadata | Passphrase/archive schema and size validated; destination is a caller-selected local path, then regular-file/atomic write checks apply. Ciphertext is reopened before success.                       |
| `room_archive_import` | plaintext      | Source is caller-selected but regular-file/size checked; authenticated decryption and archive schema validation precede app-library persistence. Returns decrypted archive to main webview (IPC-04). |
| `room_archive_list`   | local          | App-owned library only; lock and recovery handle partial state. No plaintext or passphrase.                                                                                                          |
| `room_archive_open`   | plaintext      | Strict archive ID, passphrase rules, app-owned paths, authenticated decrypt and schema validation. Missing/corrupt/wrong-passphrase states fail.                                                     |
| `room_archive_delete` | none           | Strict ID and app-owned library containment; regular-file-only, metadata-first idempotent deletion.                                                                                                  |

### Shell and terminal

| Command                        | Output              | Rust input and authority/state result                                                                                                                                                                       |
| ------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_shell_command`            | plaintext           | Exact one-shot native authorization token must match room, canonical cwd, command and execution kind; command/cwd bounded; macOS sandbox confines writes to workspace; output is bounded/redacted (IPC-05). |
| `authorize_shell_execution`    | credential-adjacent | Request syntax and canonical cwd checked, then native modal confirmation. Issues bounded expiring exact-match token; low-risk exact command may be remembered briefly. Root selection caveat is IPC-06.     |
| `clear_shell_execution_grants` | local count         | Room ID validated and a native modal confirms revocation. Room ID scopes grants rather than authenticating caller.                                                                                          |
| `authorize_terminal_input`     | credential-adjacent | Room/terminal/input/requester fields bounded; native modal shows escaped exact input and issues a one-shot exact-match token.                                                                               |
| `terminal_start`               | plaintext           | Valid room/name/cwd/command plus exact interactive-terminal token; rejects duplicate running ID and uses sandboxed PTY. Snapshot contains terminal output.                                                  |
| `terminal_list`                | plaintext           | Room ID validated and filters native sessions. No caller-to-room authentication beyond trusted main webview (IPC-03).                                                                                       |
| `terminal_read`                | plaintext           | Terminal ID grammar and existence checked; snapshot may contain secrets printed by a process. It is not independently room-token authorized (IPC-03).                                                       |
| `terminal_write`               | plaintext           | ID/room/input checked; exact one-shot input token and session-room match required; rejects stopped sessions. Snapshot contains output.                                                                      |
| `terminal_stop`                | plaintext           | ID and existence checked; termination is idempotent at process layer. It is not independently room-token authorized (IPC-03).                                                                               |

### Local preview

| Command                        | Output | Rust input and authority/state result                                                                                                                                                                          |
| ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `detect_local_preview_servers` | local  | No input; probes a fixed host/port allowlist with short timeouts.                                                                                                                                              |
| `probe_cloudflared`            | local  | No input; fixed `cloudflared --version`, bounded error/version presentation.                                                                                                                                   |
| `local_preview_start`          | local  | ID grammar, loopback-only URL/port policy and reachability checked; fixed cloudflared argv; emitted public URL must match `trycloudflare.com`; replaces same-ID tunnel. Exposes a local service intentionally. |
| `local_preview_status`         | local  | ID grammar and existing native tunnel required; reports URLs and liveness. Scoped ID is not caller authentication (IPC-03).                                                                                    |
| `local_preview_stop`           | local  | ID grammar and existing tunnel required; removes then terminates the exact process. Scoped ID is not caller authentication (IPC-03).                                                                           |

### MLS identity, messages, and history

All request structs reject unknown fields. Binary strings pass the shared
base64/size decoder; identity, message, authenticated-data, capability,
key-package and transition semantics are checked again in `mls-core`. The
native engine/store must be initialized, and group operations fail when the
room/group/epoch/pending transition is absent or incompatible.

| Command                           | Output                  | Rust input and authority/state result                                                                                                                              |
| --------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mls_identity_initialize`         | credential-adjacent     | Validated MLS credential; fixed app-data database and keychain entries; refuses reinitialization for another identity. Returns public keys/fingerprints only.      |
| `mls_device_auth_sign`            | credential-adjacent     | Bounded challenge decoding and initialized signer required. Returns signature/public key, never signing secret; it remains a main-webview signing oracle (IPC-04). |
| `mls_group_state`                 | local                   | Room group must exist; returns roster, epoch and public host state, no key material.                                                                               |
| `mls_blob_encrypt`                | ciphertext              | Bounded plaintext decode, room/blob context and exporter state enforced by engine.                                                                                 |
| `mls_blob_decrypt`                | plaintext               | Authenticated exporter ciphertext plus room/blob context enforced by engine; plaintext deliberately returns to main webview (IPC-04).                              |
| `mls_blob_prepare`                | local epoch             | Room/blob context and exporter state enforced by engine.                                                                                                           |
| `mls_history_save`                | none/local epoch        | Bounded plaintext, retention validation in engine/store, encrypted-at-rest persistence. No exporter secret returned.                                               |
| `mls_history_retention_set`       | none                    | Room state and retention policy enforced consistently in engine/store.                                                                                             |
| `mls_history_load`                | plaintext               | Room/epoch lookup, expiry pruning, authenticated decrypt; plaintext deliberately returned (IPC-04).                                                                |
| `mls_history_delete`              | none                    | Room/epoch state checked; forgets exporter material before deleting ciphertext.                                                                                    |
| `mls_history_load_latest`         | plaintext               | Room retention/pruning and newest authenticated ciphertext selection; returns plaintext under IPC-04.                                                              |
| `mls_history_delete_all`          | none                    | Requires room engine state; deletes history secrets/ciphertexts for that room. Room ID is not caller authentication (IPC-03).                                      |
| `mls_room_local_data_delete`      | none                    | Removes local room material/ciphertext with initialized native state; destructive main-webview operation scoped by room ID (IPC-03).                               |
| `mls_generate_key_package`        | public                  | Initialized engine required; returns one publishable key package and hash, no private key.                                                                         |
| `mls_create_group`                | local epoch             | Initialized identity; engine rejects duplicate/incompatible group state.                                                                                           |
| `mls_join_welcome`                | local epoch             | Bounded welcome decode and engine credential/group validation; incompatible existing state fails.                                                                  |
| `mls_encrypt_application`         | ciphertext              | Bounded payload and authenticated-data schema; room-config payload/epoch checked and persisted before encryption; engine enforces active group state.              |
| `mls_room_config_load`            | plaintext configuration | App-owned encrypted store only; validates stored room-config schema before returning it. Room ID scopes access under IPC-03.                                       |
| `mls_process_incoming`            | plaintext               | Bounded MLS message; engine authenticates and enforces epoch/transition, then returns authenticated plaintext to main webview (IPC-04).                            |
| `mls_remove_member`               | ciphertext commit       | Engine enforces group state, host authority, target membership and pending-commit rules.                                                                           |
| `mls_transfer_host`               | ciphertext commit       | Engine validates next host leaf/device/transfer ID and current-host/pending state.                                                                                 |
| `mls_host_transfer_authorization` | credential-adjacent     | Engine derives authorization only for the recorded commit; initialized signer signs canonical payload. Constrained signing oracle under IPC-04.                    |
| `mls_current_epoch`               | public/local            | Existing room group required; no secret output.                                                                                                                    |
| `mls_group_open`                  | local epoch             | Opens persisted group; corrupt/unrecoverable state is marked `requires_rejoin` rather than silently reset.                                                         |
| `mls_forget_corrupt_group`        | none                    | Allowed only after native `requires_rejoin` state was set; removes flagged room state/history.                                                                     |
| `mls_publish_succeeded`           | local epoch             | Message must match native outbox/pending state; consumes invite keychain capability receipt only after engine success.                                             |
| `mls_outbox_list`                 | ciphertext              | Returns all pending encrypted payloads plus bounded metadata; no plaintext, but global list relies on main-webview trust (IPC-03).                                 |
| `mls_clear_pending_commit`        | local epoch             | Expected message ID must match native pending commit for the room.                                                                                                 |
| `mls_retire_stale_application`    | local epoch             | Message ID must identify a stale native outbox application record for the room.                                                                                    |

### MLS invite admission

| Command                              | Output                          | Rust input and authority/state result                                                                                                                                     |
| ------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mls_invite_capability_issue`        | credential-adjacent             | Initialized HPKE/identity state; issues bounded bearer URL value while persisting only verifier/keychain material. The bearer intentionally returns once to main webview. |
| `mls_invite_request_seal`            | ciphertext                      | Recipient HPKE key, capability binding/MAC inputs and key package are decoded/validated; returns sealed request/hash only.                                                |
| `mls_invite_request_open`            | credential-adjacent             | Initialized HPKE key; authenticated seal, binding, MAC and key package validation before returning admission fields to host UI.                                           |
| `mls_invite_approve`                 | ciphertext commit/welcome       | Serialized by native approval lock; verifies stored capability verifier, binding, MAC, key package and group host state; consumes/records transition state.               |
| `mls_invite_deny`                    | credential-adjacent             | Same capability/binding/MAC verification; produces authenticated denial response and records outbox state.                                                                |
| `mls_invite_response_accept`         | credential-adjacent/local epoch | Capability bearer, original/response binding and MAC verified; optional welcome validated/joined; replay/incompatible state rejected.                                     |
| `mls_pending_invite_requests_list`   | ciphertext/local metadata       | Reads bounded pending admission records from encrypted store. Global local list relies on main-webview trust (IPC-03).                                                    |
| `mls_pending_invite_response_accept` | credential-adjacent/local epoch | Request ID must identify stored pending request; response MAC/binding and optional welcome validated before state transition.                                             |
| `mls_pending_invite_complete`        | none                            | Request ID and room must match stored pending join state before completion/removal.                                                                                       |
| `mls_join_admissions_list`           | local metadata                  | Reads bounded pending join admissions from encrypted store; global list relies on main-webview trust (IPC-03).                                                            |
| `mls_join_admission_complete`        | none                            | Room/request pair must match native pending admission state before completion.                                                                                            |

### Codex host, turns, requests, goals, and threads

| Command                        | Output                 | Rust input and authority/state result                                                                                                                                                                                                       |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe_codex`                  | local                  | No webview input; fixed version/app-server commands, timeout and bounded model projection. Permission requests in probe state have no project root and now fail closed.                                                                     |
| `run_codex_turn`               | plaintext              | Room/input/model/reasoning/tier/sandbox/thread/timeout fields validated; a lifecycle lease and native room-root/profile authorization are required. First use or root/profile change prompts; only the stored canonical root reaches Codex. |
| `steer_codex_turn`             | plaintext              | Room and bounded steering input validated; requires a matching active native turn and rejects stale/completed/cancelled lifecycle state.                                                                                                    |
| `set_codex_goal`               | local                  | Room/thread/status/token-budget shapes validated; fixed app-server method. Ephemeral goal session has no project root, so filesystem permission requests fail closed.                                                                       |
| `get_codex_goal`               | local                  | Room/thread validated; bounded parsed response; absent goal returns `None`.                                                                                                                                                                 |
| `clear_codex_goal`             | none                   | Room/thread validated; fixed app-server method; absent/incompatible server state fails.                                                                                                                                                     |
| `shutdown_codex_room`          | local count            | Room ID validated; revokes its authorized Codex root and cancels pending requests, active turns and cached sessions. Room ID is scoping, not caller authentication (IPC-03).                                                                |
| `list_codex_server_requests`   | local/project proposal | Native store expires requests and returns bounded projected fields, not raw unsupported params. It lists all rooms to the trusted main webview (IPC-03).                                                                                    |
| `respond_codex_server_request` | none                   | Opaque request key must be pending/unexpired; response shape is validated against the original request. Positive command/file/permission decisions require one exact native prompt; permission paths are then rechecked under IPC-01/07.    |
| `codex_host_snapshot`          | credential-adjacent    | Fixed app-server methods; bounded allowlisted account/app/MCP projection. Returns email/account status but no auth token.                                                                                                                   |
| `codex_account_login_start`    | credential-adjacent    | Flow/capability/app-brand choices validated; returned URL/login ID/user code bounded and HTTPS-validated. Requires compatible host state.                                                                                                   |
| `codex_account_login_cancel`   | none                   | Login ID nonempty/bounded; fixed method. Unknown/expired ID is rejected by app-server.                                                                                                                                                      |
| `codex_account_logout`         | none                   | No input; fixed method and running host capability state. Credentials remain inside Codex host.                                                                                                                                             |
| `codex_mcp_login_start`        | credential-adjacent    | Server name and timeout bounded/validated; fixed method and safe URL projection. Requires declared MCP capability/state.                                                                                                                    |
| `codex_app_approval_mode_set`  | none/local             | App ID and finite approval-mode enum validated; fixed method and declared app capability required.                                                                                                                                          |
| `list_codex_threads`           | local                  | Cwd/filter/sort/cursor/limit validated and bounded; fixed app-server method. This separate discovery path remains a local UI selection under IPC-06.                                                                                        |
| `fork_codex_thread`            | local                  | Thread ID and cwd validated/bounded; fixed method and bounded response. This separate thread operation remains a local UI selection under IPC-06.                                                                                           |

## Maintenance rule

When adding or changing a registered command, update its row with the concrete
native validator, authority source, state prerequisite, and sensitive output.
The exact-set test prevents a registration from landing without a row, but it
cannot judge whether the row or implementation is safe. Any new plaintext,
private-key operation, arbitrary path, URL opener, process launch, network
origin, or cross-room list requires a fresh threat-model decision, not just an
entry in this inventory.
