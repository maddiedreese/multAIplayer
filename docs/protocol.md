# Protocol

multAIplayer uses end-to-end encrypted envelopes routed by the relay.

The relay sees:

- team id;
- room id;
- room metadata such as the selected Codex model;
- sender user id;
- sender device id;
- envelope kind;
- timestamps;
- ciphertext payload.

The relay does not see plaintext message bodies, reactions, attachments, Codex turn input, terminal output, or file diffs.

In the alpha desktop app, small text/code attachments can be embedded inside the encrypted chat payload. A message can include up to 5 embedded attachments, each with up to 80 KB of plaintext preview content and up to 200 KB of embedded preview content total. Larger previews are encrypted locally and uploaded to relay blob storage as ciphertext, then referenced from the encrypted chat payload by blob id. Desktop clients fetch ciphertext blobs with the blob id plus matching team and room ids, decrypt them with the room key, and preview them locally without exposing plaintext to the relay.

Codex turn summaries mark each attachment as inline content, metadata-only, or encrypted-blob-reference-only. This keeps the host approval sheet aligned with the actual Codex turn input: inline content can be sent to the local Codex app-server after approval, while large encrypted blob attachments are referenced but not decrypted into Codex context by default.

Message reactions are routed as encrypted `chat.reaction` envelopes. The relay sees that a reaction event happened in a room, but not the emoji, target message, action, or reactor identity.

Host handoff packages are routed as encrypted `room.host` envelopes. The relay sees the envelope metadata but not the handoff summary contents.

Room setting activity that should be visible in the transcript is routed as encrypted `room.settings` envelopes. The alpha uses this for host-controlled approval policy, room mode, Codex model, project path, browser allowlist, and browser profile persistence changes. The relay can store current room metadata, but it cannot read the human-readable before/after activity message.

Browser access requests are routed as encrypted `browser.request` envelopes. Host decisions are routed as encrypted `browser.event` envelopes and can render as local room transcript activity after decryption. The relay sees the envelope kind, room id, sender id, and timestamp, but not the URL, reason, requester display name, decider, or host decision state.

Gated invite requests are routed as encrypted `room.invite` envelopes. The relay sees that an invite workflow event happened in a room, but not the requester name, device id, note, host decision, requester device public key, or wrapped room-key payload.

Codex turn progress is routed as encrypted `codex.event` envelopes. The relay sees that a Codex event happened in a room, but not the model id, host name, thread id, event label, or progress message.

Git workflow progress and GitHub Actions refreshes are routed as encrypted `git.event` envelopes. The relay sees that a Git event happened in a room, but not the branch, command output, PR URL, workflow run URLs, or result details. This lets non-host room members see the approved branch, commit, push, PR, and CI flow without exposing plaintext Git output to the hosted relay.

Desktop clients also keep Git workflow events and GitHub Actions refreshes in the versioned encrypted local room-history payload. This lets a restarted client restore the latest workflow status and Actions panel from local ciphertext without storing plaintext branch names, PR URLs, command output, or run URLs on the relay.

Persistent terminal snapshots are local-only and stored in that same encrypted room-history payload. Restored terminal snapshots are marked stopped/restartable; live terminal processes are not represented as durable relay state.

Clients can send `subscribe.workspace` over the room WebSocket to receive plaintext `team.updated` metadata events when teams are created. They can also send `subscribe.team` to receive plaintext `room.updated` metadata events for that team. This keeps sidebars current when teams or rooms are created and when room settings change. These updates contain metadata only; encrypted chat envelopes still require joining the specific room.

Room metadata is bounded before storage and broadcast. Project paths are trimmed, must be non-empty, cannot contain control characters, and are capped at 2,048 characters. Codex model ids are trimmed, capped at 80 characters, and must either match the known model switcher ids or a compact model-id pattern. Browser origin allowlists are normalized to http(s) origins, and browser profile persistence is stored as a boolean room setting.

Encrypted room envelopes are idempotent by envelope id within a room. If the same joined device publishes the same envelope id again, the relay keeps the first copy and does not append or rebroadcast the duplicate.

When relay auth is required, workspace metadata is scoped to the signed-in GitHub user's team memberships. Non-members cannot list a team's rooms, create rooms, create invites, upload or fetch attachment blobs, change room settings, or join the room WebSocket unless they present a valid invite id for that room. The invite id does not carry the room key; it only lets the relay add the authenticated user to the team membership list so encrypted room traffic can be routed.

When a team member is removed, the relay closes that user's live room/team/workspace sockets for the team and deletes outstanding invite metadata for that team. Removed users must receive a fresh invite before the relay will admit them again. This does not erase room keys or ciphertext already present on their device.

Desktop clients register a device public key with `POST /devices`. The relay stores the user id, device id, display name, public JWK, fingerprint, and timestamps. On authenticated relays, the device user id is bound to the signed-in GitHub session and a mismatched client-supplied user id is rejected. The private key stays on the device.

Device fingerprint trust is local desktop state. The relay does not receive or store trusted/untrusted decisions. A trusted badge means this device has locally marked the exact room id, device id, and fingerprint as expected.

Device keys are P-256 ECDH key-agreement keys. The crypto package can wrap an AES-GCM room secret to a registered device public key using an ephemeral ECDH sender key and AES-GCM wrapping payload, then unwrap it only with the recipient device private key. Gated join requests include the requester device public key when available, and host approval statuses can include a room secret wrapped specifically for that requester device.

For gated invites, the desktop creates a no-secret `#multaiplayerJoin=...` fragment containing room metadata and the host device public key, but not the room key. The joiner sends a `room.invite` request as a device-sealed payload encrypted to the host public key. When the host approves, the approval status is device-sealed to the requester and includes a wrapped room secret for that requester device. Non-gated direct invites still use the older room-key fragment flow.

Room key rotations use encrypted `room.key` envelopes. The payload is encrypted with the current room key and contains a new AES-GCM room key plus rotation metadata. Clients that can decrypt the event replace their local room key and use the new key for future room messages and invite links.

Host handoff packages are encrypted `room.host` envelopes. An available handoff summarizes the outgoing host's project path, selected model, approval policy, recent-message count, attachment names, and terminal names. When another member accepts the handoff and claims host, the desktop sends a second encrypted `room.host` envelope with `status: "accepted"` so peers stop showing the stale handoff as available.

Host-controlled room setting changes are encrypted `room.settings` envelopes with `eventType: "room.settings"` and a setting name such as `codexModel`, `approvalPolicy`, `roomMode`, `projectPath`, `browserAllowedOrigins`, or `browserProfilePersistent`. Clients render them as system transcript messages after decrypting locally, which gives the room an audit trail without exposing the before/after transcript text to the relay.

The relay accepts device-sealed envelope payloads only for `room.invite`. All other room events must use normal room-key AES-GCM payloads, which keeps the envelope formats predictable and prevents device-sealed chat, terminal, Git, or Codex events from being routed as if peers could read them.

Room presence updates also register the user id as a known member of that team for metadata counts. This updates the plaintext `members` count in `team.updated` events and relay storage, but it is not an authorization boundary in the alpha; room access still depends on possessing the room key.

## Invites

Room invite links split metadata from key material.

The relay receives and stores only invite metadata:

- invite id;
- team id;
- room id;
- creation time;
- expiry time.

The invite id is carried in the normal query string as `?invite=...`, which lets a joining desktop fetch room and team metadata from the relay. Non-gated direct invites encode the room key into the URL fragment as `#multaiplayerInvite=...`. Gated invites encode only request metadata and the host public key as `#multaiplayerJoin=...`; the room key is delivered later in the encrypted approval status. URL fragments are not sent to the relay by normal HTTP requests, so the official relay can route either invite type without receiving the room secret.

When the desktop detects an invite in the current URL, it immediately replaces the history entry with the same path and no query or fragment before lookup/import work continues. This removes direct room-key fragments from the address bar even if import later fails.

The desktop also avoids retaining direct room-key invite links in visible app state after generation. Direct links are copied to the clipboard when possible and then hidden; gated no-secret links can remain visible because they carry metadata and the host public key, not the room key. Pasted invite text is cleared from the import box as soon as import begins.

On accept, the desktop verifies that the relay invite metadata points to the same team and room named in the encrypted fragment before importing the room key. If the relay requires auth, the desktop also includes the invite id in its first room WebSocket join so the relay can admit the signed-in GitHub user as a team member.

The current alpha invite payload is versioned and contains:

- team id;
- room id;
- room name;
- AES-GCM-256 room secret.

This is intentionally simple for the alpha. A production-grade design still needs member removal, key rotation, identity verification, and multi-device recovery.

Shared TypeScript schemas live in `packages/protocol`.
