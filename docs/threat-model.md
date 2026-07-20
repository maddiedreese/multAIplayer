# Threat Model

This document describes the security model for multAIplayer. The product goal is that the relay never stores plaintext transcripts, plaintext attachments, Codex credentials, OpenAI credentials, repo contents, host-local project paths, Codex model configuration, or GitHub access tokens.

Protocol v2 uses RFC 9420 MLS through `mls-rs`, with residual application-defined policy and storage integration described below. This integration has not received an independent professional security audit. End-to-end encryption is a design intent supported by implementation review and automated tests, not a verified guarantee.

Initial trust boundaries:

- Desktop app: trusted by the local user and open source for inspection.
- Relay: trusted for routing and metadata, not trusted with plaintext.
- Codex app-server: local agent harness using the host's local Codex auth.
- GitHub: identity provider and PR API.
- Other room members: trusted only with content intentionally shared in the room.

## Terminal CLI Boundary

The Apple-silicon macOS CLI is a second native client of the same relay and MLS
rooms. It keeps the GitHub token, relay session, device private keys, MLS
wrapping key, invitation capability material, and host-local room association in
the macOS credential store. Its MLS database contains encrypted group state,
outbox records, replay state, and bounded encrypted history. Missing,
cross-identity, malformed, truncated, or incompatible state fails with an
explicit recovery error; the CLI does not silently replace or delete that state.
The destructive `room forget` path is separate from logout and leave and removes
only the exact selected room after a durable tombstone is written.

Invite codes are accepted only from bounded standard input, never a CLI
argument. Hosted Codex context and privileged responses travel over the child
process's JSON-RPC standard input; the child command line contains only fixed,
non-secret model, service-tier, sandbox, approval-policy, and network settings.
The normal CLI has no persistent diagnostic or crash-report sink and maps
network, keychain, MLS, and app-server failures to fixed error variants rather
than reflecting upstream prose. Official releases use an entitlement-backed,
app-private macOS Data Protection Keychain group with a non-interactive
`WhenUnlocked` policy; they do not use legacy per-binary ACL prompts or a
plaintext fallback. Upgrade migration attempts legacy credential reads only
while Keychain UI is disabled. An ACL denial, locked store, or other access
failure remains an explicit storage error and cannot be reclassified as a
missing key that permits identity or wrapping-key regeneration. The file-backed
credential adapter and interoperability client exist only in test or debug
builds.

Every relay-originating terminal field is rendered as one bounded line. C0/C1
controls, ANSI escapes, line separators, bidirectional overrides and isolates,
zero-width format controls, interlinear controls, BOM, and Unicode
noncharacters are replaced before display. The same sanitizer covers chat,
presence, room names, Codex previews, privileged requests, and the native
admission prompt. Renderer-owned fixed prefixes and delimiters distinguish
untrusted room content from trusted human decisions even without color. There
is no global `--yes`; admission, Codex turns, and privileged requests require an
exact explicit response bound to the current room, host, proposal or request,
native Codex session, method, parameters, and expiry. Canonical project
containment and active-host authority are rechecked immediately before use.

Maintained executable evidence includes the following tests and journeys:

- `chat::tests::every_unicode_terminal_control_property_is_neutralized`,
  `room::tests::room_output_neutralizes_directional_and_zero_width_spoofing`,
  `tests::trusted_host_prompt_requires_an_exact_explicit_decision`, and
  `codex::tests::trusted_prompt_neutralizes_terminal_spoofing_and_bounds_display`;
- `auth::tests::every_public_error_and_debug_path_is_secret_free`, the invite
  capability mutation/redaction tests, the MLS corrupt-state and exact-forget
  tests, and the Codex context/shared-activity redaction tests;
- the three-process encrypted-chat journey, headless production admission and
  binary-command journey, and the desktop/CLI cross-client matrix, all executed
  by `node tools/ci/run-cli-checks.mjs`;
- the native KeyPackage and Codex projection fuzz targets, relay parser fuzz and
  process-security journeys, Gitleaks history scan, dependency audits, license
  policy, changed-path classification, and protected-release isolation gates.

These controls do not make the host operating-system account or native process
untrusted. Another local process with the user's authority may inspect memory,
credential-store access, standard input, or the project working tree. A user can
also defeat stdin-only invite handling by placing a literal invite in an outer
shell command, script, clipboard manager, or terminal recorder. Redaction is a
bounded defense against known credential and path shapes, not a proof that
arbitrary user text contains no novel secret. Room members receive content the
host intentionally shares, and an approved Codex turn can read or modify data
allowed by its effective sandbox and can use the network when the host selected
that setting. Unicode neutralization blocks terminal state changes and the
maintained spoofing classes, but it cannot guarantee identical glyph rendering
across every terminal, font, locale, or accessibility tool. As elsewhere in
this document, the CLI and its MLS integration have not received an independent
professional security audit.

## Relay Metadata Authorization

Relay authentication is enabled by default in every environment. Self-hosters can explicitly set `MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH=true` for a private local/LAN development relay, but that is an unsafe opt-out from the hosted privacy posture.

When relay auth is enabled, team and room metadata reads are scoped to signed-in GitHub users who are known team members. Room mutations, attachment blob reads, and WebSocket room joins require membership, except that a valid room invite id can be presented once to admit an authenticated joiner. The invite id is server-visible metadata. Its lookup projects only the exact active-host user/device identifiers and signature/HPKE public keys and fingerprints needed to verify the protected fragment. The active-host-only, device-authenticated request lookup projects only the exact requester's registered signature identity needed to verify the HPKE payload. Neither enumerates the membership-scoped team device directory or discloses device labels/activity. Invite links contain no room secret; they carry a private single-use bearer capability plus the active host's public device binding.

The process security journey runs in the required relay test suite. It drives a native fixture through relay lifecycle transitions, verifies post-removal epoch exclusion, and scans SQLite pages, WAL/SHM sidecars, and observed WebSocket frames for generated plaintext, private-material, legacy project-path, and model sentinels. Those absence scans are narrow regression checks, not proof over every possible value or deployment. GitHub token discard has separate focused HTTP and persistence tests.

Team member removal closes that user's live relay sockets, blocks future room/backlog/blob reads, and invalidates outstanding invites before the active host publishes an MLS Remove commit for each affected room. Removed leaves do not receive the new epoch secret. Removal cannot erase content, ciphertext, exports, screenshots, or history secrets already retained by the removed device.

The relay bounds stored and live routing metadata such as team names, room names, WebSocket user/device identities, presence labels, avatar URLs, host labels, and public device keys. Oversized or control-character-bearing metadata is rejected at request boundaries. Critical current SQLite rows are decoded strictly; the relay does not synthesize names, policies, modes, membership roles, or session identifiers. Active project paths and Codex model/tuning configuration are rejected at room HTTP boundaries and received only inside opaque MLS messages.

Opaque MLS messages, KeyPackages, Welcomes, HPKE-sealed invite requests, and encrypted blobs have serialized size and count ceilings before fanout or storage. The relay rejects oversized identifiers, control characters, malformed public metadata, and noncanonical encodings without decrypting room content. KeyPackages are public but single-use; the relay validates their signature, pinned suite, lifetime, and credential/uploader binding through the native Rust validator before storing them.

GitHub Device Flow and GitHub API operations terminate in native Rust. Initial sign-in requests only `read:user` for workspace identity verification. Optional pull-request and Actions API workflows request the broader `repo` scope in a separate, explicit device flow and can reach private repositories available to the account. Native code verifies both grants resolve to the same GitHub user and stores them under separate versioned operating-system credential keys; no command returns either token to the webview. Git push uses the host's ordinary Git credential path and consumes neither token. At initial sign-in, and when a missing or expired CLI relay session is re-established from the stored identity credential, native code sends the identity token over TLS to the pinned relay. The relay calls GitHub's `/user`, creates a token-free relay session, and immediately discards the token; the repository token is never sent to the relay. Relay persistence contains identity metadata, expiry, and only a SHA-256 digest of the high-entropy session cookie; malformed, expired, or legacy-shaped session rows are discarded rather than granted authority. GitHub identity, avatar, device labels, and public fingerprints remain visible to authorized teammates. Signing out deletes both local tokens and the relay session; revoking OAuth grants remains separate in GitHub settings.

The hosted service has no separate password account: the account boundary is the signed-in GitHub identity plus relay sessions, registered devices, and team memberships. An authenticated deletion request requires the exact confirmation phrase and is blocked while the user owns a team or actively hosts a room; ownership or host authority must first be transferred or the workspace deleted through its normal lifecycle. Successful deletion removes all of that user's relay auth and device sessions, registered devices and KeyPackages, memberships, and pending invite/admission artifacts, then clears the current app's signed-in workspace state. Deletion is committed only to the primary SQLite database; an operator must not restore a backup that predates a deletion. Shared team/room records, opaque MLS ciphertext and routing records, encrypted attachment blobs, and accepted receipts remain because other members rely on them and removing one user's account cannot retract records already delivered. Device-local encrypted room data is a separate boundary: **Clear history** removes retained history while preserving the current room configuration, and **Forget on this device** removes both history and that durable configuration record.

The hosted operator can separately restrict an abusive GitHub identity without offering a network administration endpoint. The durable restriction denies GitHub verification and stored sessions across restart. Applying it through the in-process operator control deletes auth and device sessions/challenges, removes presence and subscriptions, and closes live sockets. The stopped-relay CLI is the supported operational interface and requires explicit confirmation that the sole writer is fenced. Restrictions retain only identity, a bounded reason code, creation time, and optional expiry. They deny future service but do not delete membership or shared ciphertext, revoke already delivered MLS secrets, or erase another device.

SQLite is the relay's only runtime store. If it is unreadable, has an unsupported version, or contains malformed authorization-critical rows, startup fails rather than replacing or reinterpreting durable state. Runtime entity writes are synchronous before a successful response or broadcast. If one fails, the process permanently marks persistence unavailable, fails readiness, closes room sockets, and refuses later product traffic until restart reloads committed SQLite state. Capacity rejection remains separate from database failure and rolls back only the rejected request's contributions.

The relay is deliberately single-node: one process owns process-local presence and WebSocket fanout and one writer owns each SQLite database. It does not claim active-active failover or horizontal scaling. Hosted and internet-facing instances must sit behind a trusted TLS reverse proxy or edge that cannot be bypassed, strips untrusted forwarding headers, supplies the client address, and applies coarse IP and volumetric controls. Relay-side token buckets remain process-local defense in depth: they smooth window-boundary bursts but reset on restart and are not a distributed abuse boundary.

Tests exercise production client encryption across two relay clients and scan SQLite plus live WAL/SHM sidecars for known plaintext content markers.

Known high-risk areas:

- MLS credential, state, exporter, and storage integration;
- host handoff;
- signed-in browser pages;
- terminal output containing secrets;
- terminal command approval and project-directory confinement;
- `.env` and credential file access;
- git push and PR creation;
- attachment previews and downloads.

Host handoff is a future-authority transition, not retroactive erasure. A malicious outgoing host can retain every plaintext, credential, key, export, or external capability it previously observed. Desktop and CLI handoff bind the request and outgoing-host approval to the incoming host's exact user, device, and MLS leaf. The incoming host must re-verify room membership and device keys, select and validate its own local project, use its own credentials and sessions, and reconsider all pending actions under its own approval policy before it accepts authority. Encrypted room context does not grant local filesystem authority, and no credentials, Codex or relay sessions, browser or terminal sessions, processes, approvals, or project directory transfer. Any included Git patch is inert until the incoming host separately reviews and explicitly confirms its application after the authority change. The CLI has no trusted patch-application adapter in this alpha and keeps a received patch inert; applying one requires a separate trusted local workflow. Authority loss cancels outgoing host-local work, but cannot erase previously retained content or external capabilities. The complete trust decision is recorded in the [host-handoff ADR](decisions/host-handoff.md).

## Local Secret Storage

The native desktop generates and uses the MLS signature key, dedicated HPKE key, group state, exporter output, and retained history keys entirely in Rust. Versioned identity and store-wrapping keys are held in the operating-system credential store. MLS state, exact durable outbox records, per-epoch history secrets, per-blob keys, and the latest validated member-only room configuration are stored in SQLCipher. The configuration record contains the project path, Codex model/tuning values, revision, and emitting epoch so a host can retry a post-Add snapshot after a webview or process restart without consulting relay metadata. Native validation and current-epoch checks happen before this record is written and before its MLS PrivateMessage is produced; the relay receives only ciphertext. Every group mutation and its exact outbound record commit transactionally before send. A corrupt database and its WAL/SHM sidecars are quarantined and the UI requires a clean rejoin rather than attempting partial recovery.

No TypeScript or webview command returns group secrets, signature private keys, HPKE private keys, exporter output, or history secrets. The webview receives public identity data, opaque handles, ciphertext, and bounded group/roster state. A compromised native process or operating-system account remains inside the trust boundary; this design does not claim Secure Enclave isolation.

Browser builds are a static native-app notice. They do not create a workspace, create or join E2EE rooms, connect to the relay, establish an identity, access projects, or implement MLS in JavaScript or WASM. Production encryption and key-at-rest claims apply only to the native app.

On every epoch, the native core derives a history secret with the MLS exporter and retains it in encrypted storage according to local retention policy. This deliberately preserves device-local readability across epochs. New members receive no pre-join history, and a device that loses its MLS store can rejoin but cannot recover old backlog or history secrets.

Room export is a separate, user-authorized data-exit boundary rather than an MLS backup. Native Rust creates a bounded versioned display-history document, places its digest inside authenticated ciphertext, and encrypts it with a user-supplied passphrase using the pinned age implementation. Owner-only atomic writes reject symlinks and special files; reads fail closed on authentication, version, size, structure, timestamp, and digest errors. Imports remain passphrase-encrypted in an owner-only local library and open only as a read-only projection after the ordinary history normalizers run. The plaintext sidecar contains only a random id, import time, ciphertext size, and format version. Archives exclude group/device secrets, KeyPackages, Welcomes, invite capabilities, live authority, pending actions, Codex session identifiers, process/browser state, relay sessions, and attachment-blob ciphertext, so an import cannot join, host, send to, or execute work in a room. See [Encrypted room archives](room-archives.md).

The onboarding workflow has a smaller, non-secret localStorage boundary. Its versioned allowlist contains coarse presentation state, bounded team/room identifiers, and boolean milestones. It excludes invite links and capabilities, project paths, form drafts, starter prompts, account details, credentials, raw readiness errors, and project/room content. Unknown versions and inconsistent scoped markers are removed and treated as fresh setup. A compromised webview can still tamper with or read this coarse local state, so it is never used as proof of authentication, membership, host authority, project access, or MLS progress.

Readiness copy reduces upstream failures to fixed explanations before display. Onboarding does not add tutorial telemetry. Normal bounded diagnostics may still record an application warning/error under the diagnostics policy, but onboarding fields and payloads are not a telemetry stream. Sensitive invite, project, authentication, and room operations continue through their existing native/relay boundaries; the guide only orchestrates those operations and presents recovery.

GitHub and ChatGPT authorization remain separate trust boundaries. Join readiness blocks only on relay access and authenticated GitHub identity; Codex, ChatGPT authorization, and project access can be completed later before that device hosts Codex. GitHub's device code and polling state stay in a bounded native in-memory controller and the eventual token moves directly into the operating-system credential store. Codex's login id and credentials stay with the native app-server path. The assistant receives only an opaque flow id, bounded user-facing code, validated provider URL, expiry, and completion state. None is serialized into onboarding state, room history, diagnostics, or room events.

Current member-only room configuration is delivered as a host-authorized MLS `room.config` snapshot containing a monotonically increasing revision and emitting epoch. The active host publishes after room creation, settings changes, every Add commit, reconnect/startup recovery, and host handoff. Receivers authenticate the active host through MLS sender binding and accept only the highest epoch/revision tuple. A new member has no pre-join backlog and therefore shows a bounded configuration-pending state until it decrypts a post-Add snapshot; it never falls back to relay metadata. Removed members cannot decrypt snapshots in later epochs. Snapshot contents are bounded again at the native boundary before encryption; the relay sees only the ordinary MLS envelope and size/routing fields.

Authentication URLs are hostile until checked. TypeScript allows only HTTPS GitHub Device Flow or the enumerated OpenAI hosts, with provider-specific authority/path restrictions. A separate Rust command repeats the validation and bound checks before using the operating system's default-browser opener. Native errors are fixed and do not reflect the URL; opener failure becomes an explicit copy-link fallback.

## HTTPS Invitation Delivery Boundary

Official invites have the canonical shape `https://open.multaiplayer.com/invite#invite=…&multaiplayerJoin=…&approval=request`. All fields are in the fragment, so compliant browsers do not send them in HTTP requests. A complete link remains a bearer secret wherever it is copied, previewed, synced, or inspected. The project intentionally defines no custom URL scheme, avoiding a second parser and scheme-hijack surface.

The apex and `open` hosts publish no-redirect Apple App Site Association files for the exact `/invite` and `/invite/` paths. The landing page's synchronous pre-hydration script scrubs every fragment, including invalid and oversized inputs. It retains only a bounded candidate in a page-global memory slot, then hydration performs full validation and deletes the slot. Valid values are never rendered, logged, persisted to local/session storage or cookies, sent to analytics, or copied automatically. A user-initiated fallback navigates to the alternate associated host; refresh, navigation, or process exit deliberately loses the value.

The native associated-domain handler accepts a single URL only. It requires HTTPS, one of the two exact hosts, the invite path, no credentials/port/query, exactly one bounded base64url invite id and capability plus `approval=request`, and rejects extra, duplicate, legacy, or ambiguous data. A one-shot, replacement-only memory slot holds the parsed payload. The emitted event contains no URL; the frontend subscribes before draining, and React clears the payload after delegation, error, denial, cancellation, or supersession. These controls reduce accidental exposure but do not protect a link already leaked outside the app.

AASA generation, static-page headers/scrubbing, parser rules, one-shot cold/warm intake, and packaged entitlement presence are automated evidence. Whether macOS actually dispatches a clicked link depends on the live AASA response, Apple Team ID, Developer ID-signed entitlement, installation location/state, and OS/browser behavior. Release operations therefore require a manual signed-app cold-start and already-running click test; the ad-hoc-signed CI inspection package uses no Apple account or Developer ID certificate and is not that evidence.

## Codex App-server Boundary

Codex account/login, app inventory, MCP authentication, login refreshes, and the persistent `auto`/`prompt`/`writes` app approval default remain host-local. They are not published into MLS room events or local room history. The global approval default can affect other Codex clients on the host and is labelled accordingly.

Server-initiated app-server requests are bound to their native session and originating room. Positive command, file-change, and permission responses require an operating-system-native confirmation bound to the exact pending request key, room, and method; arbitrary webview invocation can reject but cannot silently grant those capabilities. Only one Codex confirmation is allowed in flight. Unknown privileged methods, expanded permission responses, malformed ids/payloads, expiry after the 15-minute human deadline, shutdown, and version/capability mismatches fail closed. The exact tested range lives in the maintained [Codex hosting compatibility policy](codex-hosting.md); newer versions are visibly unverified rather than assumed safe for new contract-sensitive features.

Room-visible `codex.activity` data is projected through a bounded discriminated allowlist. The accepted schema can expose commands, output, file changes and diffs, tool input/results, web actions, image prompts, subagent details, and provider-supplied reasoning summaries to every room member. Provider-supplied raw reasoning is excluded by default and can enter only when the active host enables the per-room sharing setting; availability is not guaranteed. Once included, it is encrypted in transit but visible to and retainable by room members, and disabling sharing cannot revoke delivered copies. The projector discards the raw upstream object, unknown fields, environment/account/auth/token-refresh data, token deltas, and streaming output deltas. Bounds and encryption do not make accepted content secret-free. Thread discovery also fails closed until the active thread's session identity is resolved, preventing unrelated cwd-matching thread titles from entering room state.

Draft message text and attachments are kept in memory per room. Large encrypted blob uploads append back to the originating room draft, so a delayed upload cannot attach project content to a different room after navigation.

## Tauri IPC And Permission Authority

The [Tauri IPC boundary notes](tauri-ipc-boundary.md) record the maintained trust assumptions, authorization constraints, and residual risks. They are not an audit report or a substitute for implementation and test review. Fallible commands use a compile-time attribute that accepts only the native `CommandResult` error contract.

Codex project access is deny-by-default until the local user accepts an operating-system-native prompt for the room, canonical root, sandbox mode, and network setting. Rust stores that root/execution profile per room, passes the canonical path rather than the webview's raw string to the app-server, requires another prompt on root or profile change, and revokes the grant on room shutdown. Structured permission grants then deny network and every filesystem path outside that root. Rust canonicalizes the root and existing ancestors when the request arrives and rechecks them after the native approval immediately before sending the grant; missing roots, parent traversal, tilde expansion, malformed arrays, globs/special entries, outside-root paths, and symlink escapes fail closed. The credential/path substring markers remain UI risk labels only and carry no authority. No outside-root exception is currently exposed.

Canonical path checks reduce alias and symlink escapes but do not pin directory inodes portably. A same-path filesystem replacement after the final grant-time check remains an operation-time TOCTOU boundary; the Codex sandbox and filesystem checks at actual use are still required. Native confirmation is exact authority for the displayed request, not a guarantee that mutable project files, hooks, interpreters, or processes remain unchanged afterward.

Residual IPC trust is explicit. Non-Codex local project/Git commands still receive their initial project selection from the main UI, room ids scope native state but are not caller authentication tokens, and selected commands intentionally return project files, terminal output, decrypted history/messages, or constrained signatures to that trusted main webview. A compromise of the main Tauri webview can therefore exercise those registered capabilities within their Rust checks and can cause denial/cancellation, but it cannot silently authorize a Codex root or positive privileged response. CSP, native confirmations, canonical confinement, state validation, and the absence of raw cryptographic-key export reduce the surface without making the webview untrusted.

## Desktop App Shell CSP

The packaged Tauri app sets a Content Security Policy for the main multAIplayer window. It allows the app bundle itself, Tauri IPC, local development relay endpoints, and the official hosted relay origin. It does not allow the website or updater channel as webview connection origins: update checks run in the native signed-updater plugin, and ordinary product links open externally. It does not allow arbitrary HTTPS/WSS egress from the app shell; self-hosted packaged builds must include their relay origin in the build-time CSP. App-shell image loading is limited to bundled/data/blob images and GitHub-hosted avatars, and presence avatar URLs are filtered before render. This policy applies to the multAIplayer app shell; each approved room browser page opens in a separate nonpersistent WebView with download blocking.

## Diagnostics And Updates

The alpha does not send telemetry automatically. The native desktop keeps a small in-memory diagnostics ring for the UI and appends the same capture-redacted warning/error summaries and global crash events as JSONL in the platform app log directory. On macOS that is `~/Library/Logs/com.multaiplayer.desktop/diagnostics.jsonl`. The file is created with owner-only `0600` permissions, retains at most seven days, 256 KiB, and 500 entries, and is pruned or compacted without truncating the live file in place. The browser install notice has no diagnostics capture or export path.

Diagnostic entries cross a strict Rust IPC boundary: only `warn` or `error`, a message of at most 240 characters, optional detail of at most 800 characters, and a timestamp are accepted. Capture-time formatting omits `body` and `plaintext` values plus values under normalized keys ending in `key`, `token`, `secret`, or `passphrase`; it also redacts URL query data and token-like text. Contributors must still log stable error codes and bounded ids, never payload objects; redaction is defense in depth rather than a guarantee that arbitrary input is safe to log.

There is no diagnostic read command exposed to the webview. For native export, Rust parses and validates stored lines independently, discards malformed records, re-redacts entries, assembles the JSON bundle, opens the system save dialog, and writes the selected file directly. The command returns only `saved` or `cancelled`; it never returns prior-session entries, bundle contents, or the selected path to JavaScript. The bundle includes app version, runtime/platform metadata, relay origins, and redacted recent error entries; it is designed to exclude transcripts, room secrets, terminal output, browser contents, file contents, invite fragments, and GitHub tokens. The diagnostics file is not encrypted at rest: owner-only permissions and bounded, already-redacted metadata are proportionate for the current alpha, and encryption can be revisited if collection becomes richer.

Keeping diagnostics out of localStorage and IndexedDB reduces exposure to ordinary web-content access and makes the persisted file unavailable through a general-purpose diagnostic API. It is not a claim that a compromised desktop shell is harmless: the Tauri application has other powerful native command surfaces. Users should review every exported bundle before sharing it.

The alpha checks Tauri's updater metadata when the app shell mounts, but it downloads and installs an update only after an explicit user action. The endpoint is pinned to `releases/latest.json` on this repository's HTTPS `update-channel` branch, which advances only after release assets publish, and the app embeds the updater public key. A signed canonical metadata payload binds the claimed version, exact archive URL, archive signature, and displayed notes. Rust verifies that signature and every binding and requires a strict version increase before Tauri exposes the update; Tauri then independently verifies the downloaded archive signature before installation. A comparator rejection for a newer manifest leaves a native one-shot signal, so the webview presents **Update check could not be verified** rather than conflating failed authentication with an authenticated no-update result. GitHub/TLS can suppress or replay a valid release but cannot relabel an older signed archive as a newer version without the updater private key. The release workflow or signing key can still authorize malicious bytes if compromised, while Apple Developer ID/notarization remains a separate macOS execution-trust dependency. In the current solo-maintainer setup those credentials can share one GitHub release environment, so compromise of the account or workflow can defeat both controls; Apple signing and updater signing are not independent account-compromise defenses. Manual GitHub Release downloads, checksums, and Apple signature verification remain an independent inspection path. The pre-committed updater key is anchored by its exact-file SHA-256 fingerprint on the separately hosted project website. Routine key rotation requires an old-key-signed bridge release; suspected compromise requires stopping the manifest and a manual verified recovery announced through that out-of-band anchor rather than trusting an old-key-signed updater.

## Room Browser Capability Guards

Approved room browser pages run in a nonpersistent native WebView data store. Each open starts a private browser session, and closing the view discards its cookies and website storage; the alpha deliberately does not support persistent sign-in state. Downloads are denied by the native download handler. A guard script is injected into every frame to reject page Clipboard API calls and block file inputs, file-selection input/change events, and file drag/drop. This keeps the alpha on the conservative side until a host-approved browser upload flow exists.

## Sensitive Attachment Review

Project file previews that look like `.env` files, credential files, environment dumps, tokens, or private keys require an explicit review click before they can be attached to the next encrypted room message. The second click is labelled as an intentional override so the host can still share a needed file while seeing that it will be visible to the room and may enter Codex context.

Terminal output and received terminal command requests are scanned before sharing or host approval. Content that appears to dump environment variables, read `.env` or credential files, use a recognizable network operation, or include token-like text shows a warning. These text classifiers are review aids, not denylists or complete capability/secret detectors. Interpreters, scripts, aliases, hooks, configuration, and arbitrary executables can access files or the network without recognizable command text. A classifier match makes native approval one-shot; absence of a match does not make a command safe. Codex app-server command approvals always show the same incomplete-analysis warning, including when no recognizable marker is present. Structured Codex network permissions and every filesystem permission outside the canonical active project root are denied; in-root filesystem permissions are decided structurally, not by credential-name substring. Codex/model output, webpages, attachments, pasted text, rendered content, relay peers, and the webview are all untrusted command sources. Shell authority is enforced outside the webview: a native operating-system dialog must approve the exact room, canonical working directory, command, and execution kind before a spawn, and must approve the exact room, terminal session, and visibly escaped input before every PTY write. Rust consumes each resulting short-lived authorization once. Room or workspace substitution, command or input substitution, replay, expiry, cancellation, concurrent prompt attempts, and calls without native authorization fail closed. Executable-name allowlists are not a security boundary because tools such as Git and npm can execute hooks, configuration, and scripts. Approved commands run as the host account under a macOS profile that confines filesystem writes to the canonical project and limits reads to that project plus named system/toolchain locations. Child processes, inherited environment, project hooks and configuration, and network access remain available, so this is project-filesystem confinement rather than complete host isolation.

Approval fatigue and prompt injection are primary product-security risks. Repeated dialogs are not treated as proof that content is safe, so each dialog displays the exact native operation and untrusted control characters are escaped. The direct local **New terminal** action authorizes only creation of its room- and canonical-workspace-bound interactive PTY without a redundant second native dialog; remote commands and subsequent interactive input retain their exact native confirmations. For repeated one-shot room commands only, the native dialog offers “Repeat this command text for 10 minutes” and warns that workspace files, scripts, hooks, configuration, and environment may change between runs. The in-memory grant binds the exact room, canonical workspace, and command bytes. Rust alone stores, matches, expires, and revokes these grants; app restart clears them, the terminal-panel revoke action requires a separate native confirmation, and they never authorize PTY creation or input. There is no executable-name or command-family allowlist. This reduces identical-command prompts without giving a compromised webview broader command authority.

## MLS Identity And Invite Enrollment

Desktop devices use an MLS P-256 signature credential and a separate P-256 HPKE key. The relay receives only public keys, signed KeyPackages, canonical BasicCredentials, and full SHA-256 fingerprints. Private keys never cross the native IPC boundary.

The MLS credential binds the authenticated GitHub user id and device id. KeyPackage publication additionally uses a short-lived device session obtained by signing a one-use relay challenge with the MLS credential key. The relay validates the KeyPackage signature, lifetime, pinned ciphersuite, and embedded credential/uploader match before storage. Packages are bounded and consumed once for one exact approved request.

Invite links carry room metadata, an independent random single-use capability, and the exact active host's HPKE public key and full fingerprint; they never carry a group secret. The capability remains in the URL fragment, is scrubbed on import, and is persisted by the issuer only as a domain-separated verifier. Compromise of an endpoint or any channel used to share the complete link can reveal it, so host review remains required.

The joiner's native core binds the request id and nonce, requester and host identities, room and epoch, and exact KeyPackage hash, then seals the request with RFC 9180 HPKE to the pinned host device. It durably records the native-only bearer capability, authoritative original binding, and exact relay-visible request before publication. The public binding is present in that request envelope, but response acceptance reloads the authoritative copy and capability inside Rust. A killed requester can therefore replay identical bytes without returning the bearer capability through IPC. Approval rechecks those bindings, consumes the verifier once, and atomically creates a durable MLS Add commit and Welcome. The relay sees only the opaque request and public KeyPackage. The Welcome is encrypted to the intended KeyPackage init key and is delivered once to the authenticated requester.

## Host Authority, Forward Secrecy, And Recovery

Protocol v2 pins `MLS_128_DHKEMP256_AES128GCM_SHA256_P256` and rejects every other suite. MLS PrivateMessages provide sender authentication, epoch binding, confidentiality, and the MLS key schedule. The active host is identified by a mandatory authenticated GroupContext extension. Native policy rejects a commit not authored by that leaf, while the relay independently rejects a commit not sent by the active host device or not matching the room's expected epoch.

MLS provides forward secrecy for live traffic as old key-schedule secrets are erased, and later honest commits provide post-compromise recovery for future live traffic once a compromised member or host has been removed. These properties do not erase content already observed. They also do not extend to locally retained history: the app deliberately retains an exporter-derived secret for each epoch in its encrypted native store so history remains readable. Compromise of that device's encrypted store and wrapping key can therefore expose retained history. The exact tradeoff is documented in [Cryptography architecture](cryptography.md).

Loss or corruption of native MLS state forces a clean rejoin. The device can recover current membership through a new KeyPackage and Welcome but cannot recover pre-rejoin backlog or old history secrets from the relay. This is expected behavior, not an availability promise.

## Member Removal And MLS Epochs

Member removal uses the following enforced sequence:

- the relay closes the removed user's live sockets, blocks room/backlog/blob reads, and revokes outstanding invites;
- the active host creates an MLS Remove commit for every affected room and persists the exact state/outbox mutation before send;
- the relay accepts only the expected epoch from the authenticated active host and persists it before fanout;
- remaining native clients verify the authenticated host leaf before applying the commit;
- the removed leaf receives no new epoch secret and cannot decrypt later application messages;
- retained old history remains readable only on devices that already stored the corresponding history secrets.

This cannot erase plaintext or ciphertext a removed member already received, screenshots they took, copied Markdown, terminal output they saw, browser pages they viewed, or local history retained on their own device. The security goal is exclusion from future MLS epochs, not retroactive erasure.
