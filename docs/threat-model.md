# Threat Model

This document describes the security model for multAIplayer. The product goal is that the relay never stores plaintext transcripts, plaintext attachments, Codex credentials, OpenAI credentials, repo contents, or plaintext GitHub access tokens.

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

If the relay JSON store is unreadable or has an unsupported version, the relay renames it with a `.corrupt-...` suffix before starting from clean state. This avoids repeatedly loading untrusted state while preserving the file for operator recovery.

Known high-risk areas:

- room key distribution and rotation;
- host handoff;
- signed-in browser pages;
- terminal output containing secrets;
- terminal command approval and project-directory confinement;
- `.env` and credential file access;
- git push and PR creation;
- attachment previews and downloads.

## Local Secret Storage

The native desktop app stores room secrets and the device ECDH identity in the OS keychain using a multAIplayer service namespace. Room secrets use room-scoped account names; the device identity uses a fixed account name for the local install. Existing alpha localStorage room secrets and device identities are migrated into native storage on first access and then removed from localStorage.

The browser/web preview cannot access native keychain APIs, so it keeps room secrets only in process memory and loses room access on reload. Its development device identity remains in localStorage. Production security claims should be evaluated against the native app, not the web preview shell.

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

Terminal output and received terminal command requests are scanned before sharing or host approval. Content that appears to dump environment variables, read `.env` or credential files, or include token-like text shows an inline warning. This is a review aid, not a complete secret detector, and it does not replace host judgment. Approving a terminal request grants shell access on the host account, with the selected project folder only used as the working directory.

## Device Key Agreement

Desktop device identities use P-256 ECDH key-agreement keys. The relay receives only the public JWK and fingerprint. The private key remains on the device.

The crypto package includes tested context-bound device seals and authenticated room-secret wrapping primitives. Invite and rotation key delivery derives from the pinned static host key and the exact recipient public key, and authenticates the operation, identities, room, and epoch. Only the intended recipient can unwrap it, and the recipient verifies the sender key.

Device fingerprints display the full SHA-256 digest of the canonical P-256 public key. Capability-authenticated invite enrollment binds the outer authenticated user/device identity to the exact request key, recomputes its fingerprint, verifies the capability MAC, and pins that binding before the request is displayed or approved. A changed known key fails closed. Users can additionally compare the full fingerprint out of band.

Invite links do not carry the room key. Version 3 links carry room metadata, the current epoch, an independent CSPRNG-generated 256-bit capability, and the exact active-host user, device, public key, and full fingerprint. The capability is never derived from the room or epoch key. Requests and responses authenticate versioned, domain-separated deterministic encodings of the invite, room, epoch, nonce, host, requester, and recipient bindings. Authenticated records use fixed validated scalar fields before encoding, and public keys are compared structurally by normalized P-256 fields rather than serialized object text. Room-key delivery uses an authenticated static-host ECDH wrap inside a context-bound device-sealed response. Legacy room-key links are scrubbed and rejected.

The capability is a confidential bearer authenticator. It reaches the recipient in the URL fragment rather than the relay-visible query string, is scrubbed on import, remains process-memory-only on the requester, and crosses the relay only inside a request sealed to the pinned host key. The issuer persists only a domain-separated verifier. Relay compromise alone therefore does not reveal the capability MAC key. Compromise of an endpoint or any channel used to share the complete link can reveal it; anyone holding it can submit a device-bound request, so host review remains required.

Room key rotation advances an explicit key epoch. The host creates a fresh key and authenticates a separate delivery to every eligible registered device; the next key is never broadcast under the previous room key. Envelopes authenticate their epoch and canonical routing metadata with AES-GCM additional data. Clients retain older epoch keys only as needed for already-received local history.

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
