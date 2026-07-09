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

When relay auth is enabled, team and room metadata reads are scoped to signed-in GitHub users who are known team members. Room mutations, attachment blob reads, and WebSocket room joins require membership, except that a valid room invite id can be presented once to admit an authenticated joiner. The invite id is server-visible metadata. Gated invite links do not include the room secret; direct invite links can include it in the URL fragment, which is not sent to the relay by normal HTTP requests.

Team member removal closes that user's live relay sockets for the team and invalidates outstanding team invite metadata, so stale invites cannot immediately re-admit the removed user. This limits casual cross-team metadata exposure on hosted/self-hosted relays. It is not full cryptographic membership enforcement: anyone with a valid room key can decrypt content they already received, and production-grade removal still needs key rotation and mediated key exchange.

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

The browser/web preview cannot access native keychain APIs, so it keeps using localStorage as a development fallback for room secrets and the device identity. Production security claims should be evaluated against the native app, not the web preview shell.

Local room history is encrypted with the room secret before it is written to localStorage. The same encrypted payload includes room chat history, room workflow events, stopped terminal snapshots, and the active host's last Codex thread id, so app restarts can resume the local Codex conversation and restore restartable terminal context without storing those values in plaintext app preferences or sending them to the relay as metadata.

Draft message text and attachments are kept in memory per room. Large encrypted blob uploads append back to the originating room draft, so a delayed upload cannot attach project content to a different room after navigation.

## Desktop App Shell CSP

The packaged Tauri app sets a Content Security Policy for the main multAIplayer window. It allows the app bundle itself, Tauri IPC, local development relay endpoints, the official hosted relay origin, and the public `multaiplayer.com` release-manifest endpoint used for update notices. It does not allow arbitrary HTTPS/WSS egress from the app shell; self-hosted packaged builds must include their relay origin in the build-time CSP. App-shell image loading is limited to bundled/data/blob images and GitHub-hosted avatars, and presence avatar URLs are filtered before render. This policy applies to the multAIplayer app shell; approved room browser pages open in separate room/project-scoped WebViews with their own profile and download blocking.

## Diagnostics And Updates

The alpha does not send telemetry automatically. The desktop keeps a small local diagnostics buffer of warning/error summaries and global crash events. Users can copy a diagnostics JSON bundle from Account settings when filing a bug. The bundle includes app version, runtime/platform metadata, relay origins, and redacted recent error entries; it is designed to exclude transcripts, room secrets, terminal output, browser contents, file contents, invite fragments, and GitHub tokens.

The alpha does not use automatic updates. The desktop checks the public release manifest and shows an in-app banner when a newer version is available, with a stronger label for security updates. Users still manually download and install signed builds.

## Room Browser Capability Guards

Approved room browser pages run in a room/project-scoped native WebView profile. The profile persists by default so signed-in sites can work inside that isolated room/project context, but the host can reset it or switch the room to refresh mode, which closes the room browser and clears the profile before each approved open. Downloads are denied by the native download handler. A guard script is injected into every frame to reject page Clipboard API calls and block file inputs, file input changes, and file drag/drop. This keeps the alpha on the conservative side until a host-approved browser upload flow exists.

## Sensitive Attachment Review

Project file previews that look like `.env` files, credential files, environment dumps, tokens, or private keys require an explicit review click before they can be attached to the next encrypted room message. The second click is labelled as an intentional override so the host can still share a needed file while seeing that it will be visible to the room and may enter Codex context.

Terminal output and received terminal command requests are scanned before sharing or host approval. Content that appears to dump environment variables, read `.env` or credential files, or include token-like text shows an inline warning. This is a review aid, not a complete secret detector, and it does not replace host judgment. Approving a terminal request grants shell access on the host account, with the selected project folder only used as the working directory.

## Device Key Agreement

Desktop device identities use P-256 ECDH key-agreement keys. The relay receives only the public JWK and fingerprint. The private key remains on the device.

The crypto package includes tested device-sealed JSON and room-secret wrapping primitives: a sender can encrypt an invite request, approval status, or AES-GCM room secret to a recipient device public key using an ephemeral ECDH key and AES-GCM. Only the recipient private key can unwrap it.

The desktop app lets a user locally trust a room member's device fingerprint. Trust is scoped to the room id, device id, and exact fingerprint. If the same device id later presents a different fingerprint, the UI falls back to an untrusted keyed state until the user reviews it again. This is a local verification aid only; it is not a relay-enforced role, member removal mechanism, or room-key rotation system.

Gated invite links do not carry the room key. They carry room metadata and the host device public key in the URL fragment, then deliver the room key after host approval as a device-wrapped payload inside a device-sealed approval event. Non-gated direct invite links still carry the room key in the URL fragment for convenience.

Room key rotation is available as an alpha hygiene control. The active host publishes a new room key inside an encrypted `room.key` event using the current room key, then clients that can decrypt that event replace their local room key for future messages and invites. Local encrypted history ciphertext is cleared when the key is replaced so stale ciphertext is not left behind under the old key. This does not provide cryptographic member removal by itself: any device that still has the old key and receives the rotation event can learn the new key.

## Post-Alpha Stronger Member Removal Design

Production-grade member removal is post-alpha roadmap work. It should use explicit room key epochs and per-device key delivery instead of broadcasting the next room key under the current room key.

The intended stronger design is:

- the relay keeps a membership-scoped device roster containing user ids, device ids, device public keys, and membership status;
- every encrypted room envelope carries a key epoch id in authenticated metadata;
- removing a member first closes their live relay sockets and blocks future room/backlog/blob reads at the relay boundary;
- the active host or team owner creates a fresh room key epoch and wraps the new room key separately to each remaining trusted device public key;
- removed devices do not receive a wrapped copy of the new key and cannot decrypt future epochs through the relay;
- invite links created before removal are revoked, and new invites use the new epoch;
- clients keep old epoch keys only as long as local retention requires reading already-received history.

This design still cannot erase plaintext or ciphertext a removed member already received, screenshots they took, copied Markdown, terminal output they saw, browser pages they viewed, or local history retained on their own device. The realistic security goal is forward secrecy for future room events after removal, not retroactive erasure.
