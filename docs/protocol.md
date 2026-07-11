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

The relay does not see plaintext message bodies, reactions, attachments, Codex turn input, terminal output, file-save contents, or file diffs.

Small text/code attachments can be embedded inside the encrypted chat payload. A message can include up to 5 embedded attachments, each with up to 80 KB of plaintext preview content and up to 200 KB of embedded preview content total. Larger previews are encrypted locally and uploaded to relay blob storage as ciphertext, then referenced from the encrypted chat payload by blob id. Desktop clients fetch ciphertext blobs with the blob id plus matching team and room ids, decrypt them with the room key, and preview them locally without exposing plaintext to the relay. A locally locked room does not preview inline attachments or decrypt attachment blobs until it is unlocked with a fresh invite or key.

Codex turn summaries mark each attachment as inline content, metadata-only, or encrypted-blob-reference-only. This keeps the host approval sheet aligned with the actual Codex turn input: inline content can be sent to the local Codex app-server after approval, while large encrypted blob attachments are referenced but not decrypted into Codex context by default.

Chat messages can carry encrypted reply references. Message reactions are routed as encrypted `chat.reaction` envelopes. Message edits and deletes are routed as encrypted `chat.edit` and `chat.delete` envelopes, applied only to the original author's messages, and stored in local encrypted history as audit records. The relay sees that these chat events happened in a room, but not the target message, emoji, edited body, delete attribution, action, or actor identity. A locally locked room cannot add or remove reactions or mutate messages until it is unlocked.

Host handoff packages are routed as encrypted `room.host` envelopes. The relay sees the envelope metadata but not the handoff summary contents.

Room setting activity that should be visible in the transcript is routed as encrypted `room.settings` envelopes. This covers host-controlled approval policy, approval delegation, Codex model, Codex reasoning/speed/sandbox settings, project path, browser allowlist, and browser profile persistence changes. The relay can store current room metadata, but it cannot read the human-readable activity message.

Browser access requests are routed as encrypted `browser.request` envelopes. Host decisions are routed as encrypted `browser.event` envelopes and can render as local room transcript activity after decryption. The relay sees the envelope kind, room id, sender id, and timestamp, but not the URL, reason, requester display name, decider, or host decision state.

Non-host file-save requests are routed as encrypted `workspace.request` envelopes. Host decisions are routed as encrypted `workspace.event` envelopes. The relay sees that a workspace approval workflow happened in a room, but not the file path, previous content, proposed content, requester display name, decider, or decision state.

Invite requests are routed as device-sealed `room.invite` envelopes. The relay sees routing metadata but not the requester name, note, host decision, requester public key, capability authentication fields, or wrapped room-key payload.

Codex turn progress is routed as encrypted `codex.event` envelopes. Started-turn events can include encrypted `consumedMessageIds` so clients know which room messages have already entered Codex context. Those messages are no longer editable or deletable in the UI, while queued-but-not-started turns still refresh against current room text. The relay sees that a Codex event happened in a room, but not the model id, host name, thread id, consumed message ids, event label, or progress message.

Canonical item lifecycle metadata is routed separately as encrypted `codex.activity` envelopes. The plaintext schema is bounded and allowlisted: stable activity/turn/item ids, optional thread id, category, lifecycle status, generic title, timestamps, host attribution, and optional normalized subagent action/ids. Clients upsert by activity id and retain at most 160 room activities. Native projection ignores token/output deltas and never copies raw app-server JSON, commands, output, tool arguments/results, environment values, secrets, account/auth data, or token refreshes into the payload. The relay sees only normal encrypted-envelope routing metadata.

Codex account, login, app inventory, MCP authentication, global app approval configuration, and thread-list/fork RPC are host-local control APIs rather than room envelope kinds. The encrypted local-history payload may store the bounded activity timeline and normalized thread graph, including the active thread, but not raw RPC payloads or host credentials. The agent tree is derived locally only from normalized subagent fields in `codex.activity`; it is not serialized as a thread graph.

Git workflow progress and GitHub Actions refreshes are routed as encrypted `git.event` envelopes. The relay sees that a Git event happened in a room, but not the branch, command output, PR URL, workflow run URLs, or result details. This lets non-host room members see the approved branch, commit, push, PR, and CI flow without exposing plaintext Git output to the hosted relay.

Desktop clients also keep file-save requests, Git workflow events, and GitHub Actions refreshes in the versioned encrypted local room-history payload. This lets a restarted client restore the latest workflow status and Actions panel from local ciphertext without storing plaintext file contents, branch names, PR URLs, command output, or run URLs on the relay.

Persistent terminal snapshots are local-only and stored in that same encrypted room-history payload. Restored terminal snapshots are marked stopped/restartable; live terminal processes are not represented as durable relay state.

Clients can send `subscribe.workspace` over the room WebSocket to receive plaintext `team.updated` metadata events when teams are created. They can also send `subscribe.team` to receive plaintext `room.updated` metadata events for that team. This keeps sidebars current when teams or rooms are created and when room settings change. These updates contain metadata only; encrypted chat envelopes still require joining the specific room.

Room metadata is bounded before storage and broadcast. Project paths are trimmed, must be non-empty, cannot contain control characters, and are capped at 2,048 characters. Codex model ids are trimmed, capped at 80 characters, and must either match the known model switcher ids or a compact model-id pattern. Legacy browser origin metadata is normalized to http(s) origins when present, and browser profile persistence is stored as a boolean room setting.

Encrypted room envelopes are idempotent by envelope id within a room. If the same joined device publishes the same envelope id again, the relay keeps the first copy and does not append or rebroadcast the duplicate.

When relay auth is required, workspace metadata is scoped to the signed-in GitHub user's team memberships. Non-members cannot list a team's rooms, create rooms, create invites, upload or fetch attachment blobs, change room settings, or join the room WebSocket unless they present a valid invite id for that room. The invite id does not carry the room key; it only lets the relay add the authenticated user to the team membership list so encrypted room traffic can be routed.

Team and room records include optional `archivedAt` and `deletedAt` lifecycle timestamps. Archived records remain visible so clients can restore them, while deleted records are omitted from normal workspace listings. These flags are relay metadata only; they do not erase encrypted backlog, local history, exported Markdown, project files, or room keys already present on devices.

When a team member is removed, the relay closes that user's live room/team/workspace sockets, blocks future reads, deletes outstanding invite metadata, and advances affected rooms to fresh key epochs delivered only to remaining eligible devices. Removed users need a fresh invite before admission. This does not erase room keys, ciphertext, or plaintext already present on their device.

Desktop clients register a device public key with `POST /devices`. The relay stores the user id, device id, display name, public JWK, fingerprint, and timestamps. On authenticated relays, the device user id is bound to the signed-in GitHub session and a mismatched client-supplied user id is rejected. The private key stays on the device.

Device fingerprints are full SHA-256 digests of canonical P-256 public keys. Public-key equality compares the normalized `kty`, `crv`, `x`, and `y` fields structurally; JSON property order and optional public JWK metadata do not affect pinning. During invite enrollment, the host binds the authenticated outer-envelope user/device identity to the exact request key, recomputes the fingerprint, verifies the invite capability MAC, and pins the binding before showing or approving the request. A changed key for a known binding is rejected.

Device keys are P-256 ECDH key-agreement keys. Invite and rotation deliveries derive an authenticated wrapping key from the pinned static host private key and the exact recipient public key, with canonical operation and epoch context as additional data. Only the intended recipient can unwrap the room secret, and the recipient verifies the sender against the pinned host public key.

The desktop creates a version 3 `#multaiplayerJoin=...` fragment containing room metadata, current epoch, an independently CSPRNG-generated 256-bit capability, and the active host's exact user, device, public key, and full fingerprint—but not the room key. The capability is never derived from or keyed by a room secret. The join request is sealed to that host key and carries a capability MAC over a versioned, domain-separated deterministic encoding of the invite/team/room/epoch/request nonce and both device identities. The host verifies the outer sender, recomputed key fingerprints, issued capability, MAC, epoch, and pinned key before approval. The response repeats those bindings with its own MAC and delivers the epoch key through an authenticated static-host ECDH wrap inside a context-bound device seal.

Room key rotations advance an explicit epoch. The host creates a fresh AES-GCM room key and authenticates it separately to each eligible registered device using the host's pinned static key. Removed devices are omitted. Every ordinary room envelope carries its epoch and authenticates canonical envelope metadata as AES-GCM additional data.

The relay enforces a configurable per-room, per-epoch encrypted-envelope budget (1,000,000 by default). A monotonic count is persisted with the room independently of encrypted-backlog pruning. Once the ceiling is reached, ordinary room publishes are rejected until the active host publishes a `room.key` transition; the transition itself is allowed at the ceiling and atomically resets the budget for the next epoch.

Canonical authenticated records use encoding version 1 inside version 3 ciphertext, device-sealed, authenticated-wrap, and invite-link formats. Readers accept version 2 ciphertext and authenticated wraps plus unversioned legacy device seals using their frozen pre-canonical AAD encodings so retained encrypted history remains readable. Active invite and room-event writers emit only the version 3 canonical formats. Existing issued invite verifiers are intentionally invalidated by this protocol transition; hosts generate a fresh version 3 invite rather than accepting an ambiguous legacy MAC encoding. The standalone ephemeral wrapper API uses version 2 canonical AAD and reads its legacy version 1 format; active invite and rotation delivery use the authenticated version 3 wrapper instead.

Host handoff packages are encrypted `room.host` envelopes. An available handoff summarizes the outgoing host's project path, selected model, approval policy, recent-message count, attachment names, and terminal names. When another member accepts the handoff and claims host, the desktop sends a second encrypted `room.host` envelope with `status: "accepted"` so peers stop showing the stale handoff as available.

Host-controlled room setting changes are encrypted `room.settings` envelopes with `eventType: "room.settings"` and a setting name such as `codexModel`, `approvalPolicy`, `approvalDelegationPolicy`, `trustedApprovers`, `codexReasoningEffort`, `codexSpeed`, `codexSandboxLevel`, `projectPath`, `browserAllowedOrigins`, or `browserProfilePersistent`. Clients render them as system transcript messages after decrypting locally, which gives the room an audit trail without exposing the before/after transcript text to the relay.

The relay accepts device-sealed envelope payloads only for `room.invite`. All other room events must use normal room-key AES-GCM payloads, which keeps the envelope formats predictable and prevents device-sealed chat, terminal, Git, or Codex events from being routed as if peers could read them.

Room presence updates also register the user id as a known member of that team for metadata counts on local or unauthenticated relay setups. This updates the plaintext `members` count in `team.updated` events and relay storage. On authenticated relays, workspace and room routing is scoped by signed-in team membership or a valid invite id, while message readability still depends on possessing the room key.

## Invites

Room invite links split metadata from key material.

The relay receives and stores only invite metadata:

- invite id;
- team id;
- room id;
- creation time;
- expiry time.

The invite id is carried in the normal query string as `?invite=...`, which lets a joining desktop fetch room and team metadata from the relay. The `#multaiplayerJoin=...` fragment contains the capability and public host binding, never a room key. The room key is delivered only after the authenticated approval handshake. Legacy `#multaiplayerInvite=...` room-key fragments are removed from browser history before processing and rejected with guidance to request a current invite.

Each invite capability is an independent 256-bit bearer secret generated from the platform CSPRNG. It is unrelated to every room secret and epoch key. The capability reaches the recipient only in the URL fragment, which browsers do not include in HTTP requests to the relay. On import, the requester scrubs the fragment, retains the raw capability only in process memory, and sends it through the relay only inside a request device-sealed to the pinned host key. The host persists only a domain-separated SHA-256 verifier. Relay transport therefore receives neither the fragment nor a usable capability.

Anyone who obtains the complete invite link obtains its bearer capability and can submit a device-bound request for host review. Host approval and the exact requester user/device/key binding still gate room-key delivery. Complete invite links are private secrets and must not be pasted into logs, public chats, issue trackers, or diagnostics.

When the desktop detects an invite in the current URL, it immediately replaces the history entry with the same path and no query or fragment before lookup/import work continues. This also removes legacy room-key-bearing fragments from the address bar before they are rejected.

The desktop may display and copy the capability invite for private delivery, but the link remains a bearer secret even though it contains no room key. Pasted invite text is cleared from the import box as soon as import begins.

On accept, the desktop verifies that relay invite metadata matches the capability fragment, the link's host key matches its full fingerprint, the response outer sender matches that host, and the nonce, recipient, epoch, and capability MAC match the pending request before importing the room key. If relay auth is required, the desktop includes the invite id in its first room WebSocket join so the signed-in user can be admitted.

Member removal revokes future relay reads and live sockets, invalidates outstanding invites, and advances affected rooms to a new key epoch delivered only to remaining eligible devices. Earlier epochs may remain readable by devices that legitimately received them, subject to local retention. Delivered content cannot be retroactively erased.

Shared TypeScript schemas live in `packages/protocol`.
