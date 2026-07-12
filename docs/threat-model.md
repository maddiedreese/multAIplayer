# Threat Model

This document describes the security model for multAIplayer. The product goal is that the relay never stores plaintext transcripts, plaintext attachments, Codex credentials, OpenAI credentials, repo contents, or plaintext GitHub access tokens.

The custom cryptographic design and implementation have not received an independent professional security audit. End-to-end encryption is a design intent supported by implementation review and automated tests, not a verified guarantee. Material changes to the assumptions and claims below are recorded in the public [threat-model changelog](threat-model-changelog.md).

Initial trust boundaries:

- Desktop app: trusted by the local user and open source for inspection.
- Relay: trusted for routing and metadata, not trusted with plaintext.
- Codex app-server: local agent harness using the host's local Codex auth.
- GitHub: identity provider and PR API.
- Other room members: trusted only with content intentionally shared in the room.

## Relay Metadata Authorization

Production relays require auth by default. Self-hosters can explicitly set `MULTAIPLAYER_RELAY_REQUIRE_AUTH=false` for a private local/LAN relay, but that is an opt-out from the hosted privacy posture.

When relay auth is enabled, team and room metadata reads are scoped to signed-in GitHub users who are known team members. Room mutations, attachment blob reads, and WebSocket room joins require membership, except that a valid room invite id can be presented once to admit an authenticated joiner. The invite id is server-visible metadata. Invite links contain no room secret; they carry a private single-use bearer capability plus the active host's public device binding.

Team member removal closes that user's live relay sockets, blocks future room/backlog/blob reads, invalidates outstanding invites, and performs a key-rotation preflight for affected rooms. Each room advances to a fresh epoch whose key is authenticated by the host and wrapped independently to eligible registered devices; removed devices receive no new key. Removal cannot erase content, ciphertext, exports, screenshots, or older epoch keys already delivered.

The relay also bounds stored and live routing metadata such as team names, room names, WebSocket user/device identities, live presence labels, avatar URLs, host labels, device identity fields, public key fingerprints, public key JWK blobs, project paths, and model ids. Oversized or control-character-bearing user-visible metadata is rejected at HTTP/WebSocket boundaries, and persisted records are normalized or discarded on startup.

Encrypted room envelopes have a serialized size ceiling before WebSocket fanout or backlog storage. The relay cannot inspect plaintext, but it can reject oversized ids, sender fields, nonces, ciphertext, and device-sealed invite key material to avoid unbounded encrypted-event storage.

GitHub OAuth access tokens are used only by the relay-side GitHub proxy for identity, pull requests, and Actions reads. Relay sessions are memory-only unless a `MULTAIPLAYER_RELAY_SESSION_SECRET` of at least 32 characters is configured. With that secret set, GitHub access tokens are AES-GCM encrypted in the relay store and expired sessions are pruned on load and save. Plaintext access-token records are ignored if encountered on disk.

SQLite is the default relay store. JSON snapshots are an explicit local-development or migration option only. If the configured relay store is unreadable or has an unsupported version, the relay renames it with a `.corrupt-...` suffix before starting from clean state. This avoids repeatedly loading untrusted state while preserving the file for operator recovery.

The implicit-default upgrade path transactionally imports a valid legacy `.multaiplayer/relay-store.json` into SQLite and preserves the source under a `.migrated-to-sqlite` name. Invalid legacy input fails startup rather than silently creating an empty relay. Tests exercise production client encryption across two relay clients and scan the SQLite database plus live WAL/SHM sidecars for known plaintext content markers.

Known high-risk areas:

- room key distribution and rotation;
- host handoff;
- signed-in browser pages;
- terminal output containing secrets;
- terminal command approval and project-directory confinement;
- `.env` and credential file access;
- git push and PR creation;
- attachment previews and downloads.

Host handoff is a future-authority transition, not retroactive erasure. A malicious outgoing host can retain every plaintext, credential, key, export, or external capability it previously observed. The incoming host must re-verify room membership and device keys, its local project and credential context, all pending actions, and its approval policy before it creates a fresh epoch and accepts authority. The complete trust decision is recorded in the [host-handoff ADR](decisions/host-handoff.md).

## Local Secret Storage

The native desktop app stores room secrets and the serialized device ECDH identity in the OS keychain using a multAIplayer service namespace. Room secrets use room-scoped account names; the device identity uses the fixed `device-identity:v1` account. Existing alpha localStorage room secrets and device identities are migrated into native storage on first access and then removed from localStorage. Each native process permits only one startup retrieval of the persisted identity; reset or subsequent webview calls cannot retrieve it again. On load, device private material crosses that boundary transiently and is imported into a non-extractable Web Crypto handle for normal runtime use. A compromise present at startup can still observe or invoke the one allowed retrieval. JavaScript memory and the keychain bridge are not a hardware security boundary.

The browser/web preview cannot access native keychain APIs, so it keeps room secrets only in process memory and loses room access on reload. Its runtime device key is a non-extractable Web Crypto handle, but its serialized development identity remains in localStorage for reload persistence. Production key-at-rest claims apply to the native app, not the web preview shell.

Local room history is encrypted with the room secret before it is written to localStorage. The same encrypted payload includes room chat history, room workflow events, stopped terminal snapshots, bounded metadata-only Codex activities, and the normalized Codex thread graph/active selection, so app restarts can resume local context without storing those values in plaintext app preferences or relay metadata.

## Codex App-server Boundary

Codex account/login, app inventory, MCP authentication, login refreshes, and the persistent `auto`/`prompt`/`writes` app approval default remain host-local. They are not published into room envelopes or local room history. The global approval default can affect other Codex clients on the host and is labelled accordingly.

Server-initiated app-server requests are bound to their native session and originating room. Only the active host can answer them. Unknown privileged methods, expanded permission responses, malformed ids/payloads, expiry after the 15-minute human deadline, shutdown, and version/capability mismatches fail closed. The supported compatibility range is 0.133.0–0.144.0, with generated-schema fixtures at 0.133.0, 0.143.0, and 0.144.0; newer versions are visibly unverified rather than assumed safe for new contract-sensitive features.

Room-visible `codex.activity` data is projected through an allowlist. Raw commands, output, tool arguments/results, prompt previews, environment values, secrets, raw upstream JSON, token deltas, and account/auth/token-refresh data are discarded before an activity can enter encrypted relay traffic or encrypted local history. Thread discovery also fails closed until the active thread's session identity is resolved, preventing unrelated cwd-matching thread titles from entering room state.

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

Terminal output and received terminal command requests are scanned before sharing or host approval. Content that appears to dump environment variables, read `.env` or credential files, or include token-like text shows an inline warning. This is a review aid, not a complete secret detector, and it does not replace host judgment. Codex/model output, webpages, attachments, pasted text, rendered content, relay peers, and the webview are all untrusted command sources. Shell authority is enforced outside the webview: a native operating-system dialog must approve the exact room, canonical working directory, command, and execution kind before a spawn, and must approve the exact room, terminal session, and visibly escaped input before every PTY write. Rust consumes each resulting short-lived authorization once. Room or workspace substitution, command or input substitution, replay, expiry, cancellation, concurrent prompt attempts, and calls without native authorization fail closed. Executable-name allowlists are not a security boundary because tools such as Git and npm can execute hooks, configuration, and scripts. Approving a terminal request grants shell access as the host account; the selected project folder is a working directory, not a sandbox.

Approval fatigue and prompt injection are primary product-security risks. Repeated dialogs are not treated as proof that content is safe, so each dialog displays the exact native operation and untrusted control characters are escaped. For repeated one-shot room commands only, the native dialog offers “Repeat this command text for 10 minutes” and warns that workspace files, scripts, hooks, configuration, and environment may change between runs. The in-memory grant binds the exact room, canonical workspace, and command bytes. Rust alone stores, matches, expires, and revokes these grants; app restart clears them, the terminal-panel revoke action requires a separate native confirmation, and they never authorize PTY creation or input. There is no executable-name or command-family allowlist. This reduces identical-command prompts without giving a compromised webview broader command authority.

## Device Key Agreement

Desktop device identities use P-256 ECDH key-agreement keys. The relay receives only the public JWK and fingerprint. The private key remains on the device.

The crypto package includes tested context-bound device seals and authenticated room-secret wrapping primitives. Invite and rotation key delivery derives from the pinned static host key and the exact recipient public key, and authenticates the operation, identities, room, and epoch. Only the intended recipient can unwrap it, and the recipient verifies the sender key.

Device fingerprints display the full SHA-256 digest of the canonical P-256 public key. Capability-authenticated invite enrollment binds the outer authenticated user/device identity to the exact request key, recomputes its fingerprint, verifies the capability MAC, and pins that binding before the request is displayed or approved. A changed known key fails closed. Users can additionally compare the full fingerprint out of band.

Invite links do not carry the room key. Version 3 links carry room metadata, the current epoch, an independent CSPRNG-generated 256-bit capability, and the exact active-host user, device, public key, and full fingerprint. The capability is never derived from the room or epoch key. It is a canonical 43-character unpadded-base64url HMAC-SHA-256 key. Requests and responses authenticate canonical version 1 records under `multaiplayer:invite-capability-mac`, binding phase, invite/team/room/epoch, request id and nonce, and both requester and host user, device, and full-fingerprint identities; responses additionally bind status and decision time. Public keys are compared structurally by normalized P-256 `kty`, `crv`, `x`, and `y` rather than serialized object text. Room-key delivery uses an authenticated static-host ECDH wrap inside a context-bound device-sealed response. Legacy room-key links are scrubbed and rejected.

The capability is a confidential bearer authenticator. It reaches the recipient in the URL fragment rather than the relay-visible query string, is scrubbed on import, remains process-memory-only on the requester, and crosses the relay only inside a request sealed to the pinned host key. The issuer persists only a domain-separated verifier. Relay compromise alone therefore does not reveal the capability MAC key. Compromise of an endpoint or any channel used to share the complete link can reveal it; anyone holding it can submit a device-bound request, so host review remains required.

Room key rotation advances an explicit key epoch. The sole active host creates an independent CSPRNG key and authenticates a separate wrap to every eligible registered device; the next key is not derivable from the previous room key or the host identity private key. Those wraps travel inside the rotation envelope encrypted under the previous epoch so current members can authenticate the transition, but possession of that old epoch alone cannot open a recipient-specific ECDH wrap. A persisted pending rotation supplies crash-safe retry identity only while its recipients exactly match the current eligible device set; a membership or exclusion change discards it and creates fresh random material before publish. Authenticated key deliveries accept only canonical version 3 AAD and reject version 2, because no trusted room-generation marker exists to scope a downgrade-safe migration. Envelopes authenticate their epoch and canonical routing metadata with AES-GCM additional data. Clients retain older epoch keys only as needed for already-received local history.

The model treats a compromised active host as compromised for rotations it controls; non-extractable runtime handles reduce accidental export but do not make hostile JavaScript safe. The protocol does not claim per-message forward secrecy or post-compromise security. The rationale and MLS adoption boundary are documented in [Cryptography architecture](cryptography.md).

Random 96-bit AES-GCM nonces are additionally bounded by a relay-enforced message budget for every room epoch. A monotonic room counter is persisted independently of backlog retention and survives restarts. Ordinary publishes stop at the configured ceiling while the authenticated host rotation event remains allowed and atomically resets the counter, ensuring rotation can advance to a fresh key and nonce budget.

## Member Removal And Key Epochs

Member removal uses the following enforced sequence:

- the relay keeps a membership-scoped device roster containing user ids, device ids, device public keys, and membership status;
- every encrypted room envelope carries a key epoch id in authenticated metadata;
- removing a member first closes their live relay sockets and blocks future room/backlog/blob reads at the relay boundary;
- the active host or team owner creates a fresh room key epoch and authenticates the new room key separately to each remaining registered device public key;
- removed devices do not receive a wrapped copy of the new key and cannot decrypt future epochs through the relay;
- invite links created before removal are revoked, and new invites use the new epoch;
- clients keep old epoch keys only as long as local retention requires reading already-received history.

This cannot erase plaintext or ciphertext a removed member already received, screenshots they took, copied Markdown, terminal output they saw, browser pages they viewed, or local history retained on their own device. The security goal is exclusion from future room epochs, not retroactive erasure.
