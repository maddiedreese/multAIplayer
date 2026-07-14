# Threat Model

This document describes the security model for multAIplayer. The product goal is that the relay never stores plaintext transcripts, plaintext attachments, Codex credentials, OpenAI credentials, repo contents, or plaintext GitHub access tokens.

Protocol v2 uses RFC 9420 MLS through `mls-rs`, with residual application-defined policy and storage integration described below. This integration has not received an independent professional security audit. End-to-end encryption is a design intent supported by implementation review and automated tests, not a verified guarantee. Material changes to the assumptions and claims below are recorded in the public [threat-model changelog](threat-model-changelog.md).

Initial trust boundaries:

- Desktop app: trusted by the local user and open source for inspection.
- Relay: trusted for routing and metadata, not trusted with plaintext.
- Codex app-server: local agent harness using the host's local Codex auth.
- GitHub: identity provider and PR API.
- Other room members: trusted only with content intentionally shared in the room.

## Relay Metadata Authorization

Production relays require auth by default. Self-hosters can explicitly set `MULTAIPLAYER_RELAY_REQUIRE_AUTH=false` for a private local/LAN relay, but that is an opt-out from the hosted privacy posture.

When relay auth is enabled, team and room metadata reads are scoped to signed-in GitHub users who are known team members. Room mutations, attachment blob reads, and WebSocket room joins require membership, except that a valid room invite id can be presented once to admit an authenticated joiner. The invite id is server-visible metadata. Invite links contain no room secret; they carry a private single-use bearer capability plus the active host's public device binding.

Team member removal closes that user's live relay sockets, blocks future room/backlog/blob reads, and invalidates outstanding invites before the active host publishes an MLS Remove commit for each affected room. Removed leaves do not receive the new epoch secret. Removal cannot erase content, ciphertext, exports, screenshots, or history secrets already retained by the removed device.

The relay also bounds stored and live routing metadata such as team names, room names, WebSocket user/device identities, live presence labels, avatar URLs, host labels, device identity fields, public key fingerprints, public key JWK blobs, project paths, and model ids. Oversized or control-character-bearing user-visible metadata is rejected at HTTP/WebSocket boundaries, and persisted records are normalized or discarded on startup.

Opaque MLS messages, KeyPackages, Welcomes, HPKE-sealed invite requests, and encrypted blobs have serialized size and count ceilings before fanout or storage. The relay rejects oversized identifiers, control characters, malformed public metadata, and noncanonical encodings without decrypting room content. KeyPackages are public but single-use; the relay validates their signature, pinned suite, lifetime, and credential/uploader binding through the native Rust validator before storing them.

GitHub OAuth access tokens are used only by the relay-side GitHub proxy for identity, pull requests, and Actions reads. Relay sessions are memory-only unless a `MULTAIPLAYER_RELAY_SESSION_SECRET` of at least 32 characters is configured. With that secret set, GitHub access tokens are AES-GCM encrypted in the relay store and expired sessions are pruned on load and save. Plaintext access-token records are ignored if encountered on disk.

SQLite is the default relay store. JSON snapshots are an explicit local-development or migration option only. If the configured relay store is unreadable or has an unsupported version, the relay renames it with a `.corrupt-...` suffix before starting from clean state. This avoids repeatedly loading untrusted state while preserving the file for operator recovery.

The implicit-default upgrade path transactionally imports a valid legacy `.multaiplayer/relay-store.json` into SQLite and preserves the source under a `.migrated-to-sqlite` name. Invalid legacy input fails startup rather than silently creating an empty relay. Tests exercise production client encryption across two relay clients and scan the SQLite database plus live WAL/SHM sidecars for known plaintext content markers.

Known high-risk areas:

- MLS credential, state, exporter, and storage integration;
- host handoff;
- signed-in browser pages;
- terminal output containing secrets;
- terminal command approval and project-directory confinement;
- `.env` and credential file access;
- git push and PR creation;
- attachment previews and downloads.

Host handoff is a future-authority transition, not retroactive erasure. A malicious outgoing host can retain every plaintext, credential, key, export, or external capability it previously observed. The incoming host must re-verify room membership and device keys, its local project and credential context, all pending actions, and its approval policy before it creates a fresh epoch and accepts authority. The complete trust decision is recorded in the [host-handoff ADR](decisions/host-handoff.md).

## Local Secret Storage

The native desktop generates and uses the MLS signature key, dedicated HPKE key, group state, exporter output, and retained history keys entirely in Rust. Versioned identity and store-wrapping keys are held in the operating-system credential store. MLS state, exact durable outbox records, per-epoch history secrets, and per-blob keys are stored in SQLCipher. Every group mutation and its exact outbound record commit transactionally before send. A corrupt database and its WAL/SHM sidecars are quarantined and the UI requires a clean rejoin rather than attempting partial recovery.

No TypeScript or webview command returns group secrets, signature private keys, HPKE private keys, exporter output, or history secrets. The webview receives public identity data, opaque handles, ciphertext, and bounded group/roster state. A compromised native process or operating-system account remains inside the trust boundary; this design does not claim Secure Enclave isolation.

The browser/web preview is a seeded local demonstration only. It does not create or join E2EE rooms, connect to the relay, or implement MLS in JavaScript or WASM. Production encryption and key-at-rest claims apply only to the native app.

On every epoch, the native core derives a history secret with the MLS exporter and retains it in encrypted storage according to local retention policy. This deliberately preserves device-local readability across epochs. New members receive no pre-join history, and a device that loses its MLS store can rejoin but cannot recover old backlog or history secrets.

The onboarding workflow has a smaller, non-secret localStorage boundary. Its versioned allowlist contains coarse presentation state, bounded team/room identifiers, and boolean milestones. It excludes invite links and capabilities, project paths, form drafts, starter prompts, account details, credentials, raw readiness errors, and project/room content. Unknown versions and inconsistent scoped markers are removed and treated as fresh setup. A compromised webview can still tamper with or read this coarse local state, so it is never used as proof of authentication, membership, host authority, project access, or MLS progress.

Readiness copy reduces upstream failures to fixed explanations before display. Onboarding does not add tutorial telemetry. Normal bounded diagnostics may still record an application warning/error under the diagnostics policy, but onboarding fields and payloads are not a telemetry stream. Sensitive invite, project, authentication, and room operations continue through their existing native/relay boundaries; the guide only orchestrates those operations and presents recovery.

## Codex App-server Boundary

Codex account/login, app inventory, MCP authentication, login refreshes, and the persistent `auto`/`prompt`/`writes` app approval default remain host-local. They are not published into MLS room events or local room history. The global approval default can affect other Codex clients on the host and is labelled accordingly.

Server-initiated app-server requests are bound to their native session and originating room. Only the active host can answer them. Unknown privileged methods, expanded permission responses, malformed ids/payloads, expiry after the 15-minute human deadline, shutdown, and version/capability mismatches fail closed. The supported compatibility range is 0.133.0–0.144.0, with generated-schema fixtures at 0.133.0, 0.143.0, and 0.144.0; newer versions are visibly unverified rather than assumed safe for new contract-sensitive features.

Room-visible `codex.activity` data is projected through a bounded discriminated allowlist. The accepted schema can expose commands, output, file changes and diffs, tool input/results, web actions, image prompts, subagent details, and provider-supplied reasoning summaries to every room member. Provider-supplied raw reasoning is excluded by default and can enter only when the active host enables the per-room sharing setting; availability is not guaranteed. Once included, it is encrypted in transit but visible to and retainable by room members, and disabling sharing cannot revoke delivered copies. The projector discards the raw upstream object, unknown fields, environment/account/auth/token-refresh data, token deltas, and streaming output deltas. Bounds and encryption do not make accepted content secret-free. Thread discovery also fails closed until the active thread's session identity is resolved, preventing unrelated cwd-matching thread titles from entering room state.

Draft message text and attachments are kept in memory per room. Large encrypted blob uploads append back to the originating room draft, so a delayed upload cannot attach project content to a different room after navigation.

## Desktop App Shell CSP

The packaged Tauri app sets a Content Security Policy for the main multAIplayer window. It allows the app bundle itself, Tauri IPC, local development relay endpoints, the official hosted relay origin, and the public `multaiplayer.com` release-manifest endpoint used for update notices. It does not allow arbitrary HTTPS/WSS egress from the app shell; self-hosted packaged builds must include their relay origin in the build-time CSP. App-shell image loading is limited to bundled/data/blob images and GitHub-hosted avatars, and presence avatar URLs are filtered before render. This policy applies to the multAIplayer app shell; approved room browser pages open in separate room/project-scoped WebViews with their own profile and download blocking.

## Diagnostics And Updates

The alpha does not send telemetry automatically. The native desktop keeps a small in-memory diagnostics ring for the UI and appends the same capture-redacted warning/error summaries and global crash events as JSONL in the platform app log directory. On macOS that is `~/Library/Logs/com.multaiplayer.desktop/diagnostics.jsonl`. The file is created with owner-only `0600` permissions, retains at most seven days, 256 KiB, and 500 entries, and is pruned or compacted without truncating the live file in place. The browser/web preview remains memory-only.

Diagnostic entries cross a strict Rust IPC boundary: only `warn` or `error`, a message of at most 240 characters, optional detail of at most 800 characters, and a timestamp are accepted. Capture-time formatting omits `body` and `plaintext` values plus values under normalized keys ending in `key`, `token`, `secret`, or `passphrase`; it also redacts URL query data and token-like text. Contributors must still log stable error codes and bounded ids, never payload objects; redaction is defense in depth rather than a guarantee that arbitrary input is safe to log.

There is no diagnostic read command exposed to the webview. For native export, Rust parses and validates stored lines independently, discards malformed records, re-redacts entries, assembles the JSON bundle, opens the system save dialog, and writes the selected file directly. The command returns only `saved` or `cancelled`; it never returns prior-session entries, bundle contents, or the selected path to JavaScript. The bundle includes app version, runtime/platform metadata, relay origins, and redacted recent error entries; it is designed to exclude transcripts, room secrets, terminal output, browser contents, file contents, invite fragments, and GitHub tokens. The diagnostics file is not encrypted at rest: owner-only permissions and bounded, already-redacted metadata are proportionate for the current alpha, and encryption can be revisited if collection becomes richer.

Keeping diagnostics out of localStorage and IndexedDB reduces exposure to ordinary web-content access and makes the persisted file unavailable through a general-purpose diagnostic API. It is not a claim that a compromised desktop shell is harmless: the Tauri application has other powerful native command surfaces. Users should review every exported bundle before sharing it.

The alpha does not use automatic updates. The desktop checks the public release manifest and shows an in-app banner when a newer version is available, with a stronger label for security updates. Users still manually download and install signed builds.

## Room Browser Capability Guards

Approved room browser pages run in a room/project-scoped native WebView profile. The profile persists by default so signed-in sites can work inside that isolated room/project context, but the host can reset it or switch the room to refresh mode, which closes the room browser and clears the profile before each approved open. Downloads are denied by the native download handler. A guard script is injected into every frame to reject page Clipboard API calls and block file inputs, file input changes, and file drag/drop. This keeps the alpha on the conservative side until a host-approved browser upload flow exists.

## Sensitive Attachment Review

Project file previews that look like `.env` files, credential files, environment dumps, tokens, or private keys require an explicit review click before they can be attached to the next encrypted room message. The second click is labelled as an intentional override so the host can still share a needed file while seeing that it will be visible to the room and may enter Codex context.

Terminal output and received terminal command requests are scanned before sharing or host approval. Content that appears to dump environment variables, read `.env` or credential files, use a recognizable network operation, or include token-like text shows a warning. These text classifiers are review aids, not denylists or complete capability/secret detectors. Interpreters, scripts, aliases, hooks, configuration, and arbitrary executables can access files or the network without recognizable command text. A classifier match makes native approval one-shot; absence of a match does not make a command safe. Codex app-server command approvals always show the same incomplete-analysis warning, including when no recognizable marker is present. Explicit Codex permission requests for network access or recognizable credential paths are denied because those structured capabilities can be enforced directly. Codex/model output, webpages, attachments, pasted text, rendered content, relay peers, and the webview are all untrusted command sources. Shell authority is enforced outside the webview: a native operating-system dialog must approve the exact room, canonical working directory, command, and execution kind before a spawn, and must approve the exact room, terminal session, and visibly escaped input before every PTY write. Rust consumes each resulting short-lived authorization once. Room or workspace substitution, command or input substitution, replay, expiry, cancellation, concurrent prompt attempts, and calls without native authorization fail closed. Executable-name allowlists are not a security boundary because tools such as Git and npm can execute hooks, configuration, and scripts. Approving a terminal request grants shell access as the host account; the selected project folder is a working directory, not a sandbox.

Approval fatigue and prompt injection are primary product-security risks. Repeated dialogs are not treated as proof that content is safe, so each dialog displays the exact native operation and untrusted control characters are escaped. For repeated one-shot room commands only, the native dialog offers “Repeat this command text for 10 minutes” and warns that workspace files, scripts, hooks, configuration, and environment may change between runs. The in-memory grant binds the exact room, canonical workspace, and command bytes. Rust alone stores, matches, expires, and revokes these grants; app restart clears them, the terminal-panel revoke action requires a separate native confirmation, and they never authorize PTY creation or input. There is no executable-name or command-family allowlist. This reduces identical-command prompts without giving a compromised webview broader command authority.

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
