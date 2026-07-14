# Message lifecycles

These traces describe the native protocol-v2 path. Seeded browser demo rooms stop at local state and never join an encrypted relay room.

## Life of first-run setup state

1. A fresh installation loads a versioned local onboarding record. Missing state opens Welcome; unsupported, malformed, or internally inconsistent state is discarded rather than partially trusted.
2. Create/join selection and presentation progress update an allowlisted local record containing bounded identifiers and booleans. Form drafts, project paths, invite input, GitHub/ChatGPT login ids, URLs and codes, prompts, account data, and project content are excluded and are not onboarding milestones.
3. Readiness rows are derived from current relay, GitHub, Codex, ChatGPT-account, and project-selection state. Create blocks on host readiness. Join blocks only on relay and GitHub identity; Codex, ChatGPT, and project checks are deferrable. These are presentation projections, not room messages.
4. On create, the relay-backed team operation completes before room creation. If the room fails, local state retains the bounded team id so the next attempt creates only the room. A successful room event consumes that partial marker.
5. On join, invite parsing and the device-bound HPKE request follow the invite lifecycle below. The local guide may remain at verification-required until an approved Welcome unlocks the room.
6. Codex connection, room/project readiness, a completed first turn, and observed teammate membership advance checklist markers. An explicit local “Not now” marker can resolve the optional teammate task without representing a membership event.
7. Dismiss, skip, reopen, restart, and checklist visibility remain local UI state. None is published through MLS or the relay, and none changes room membership or host authority.

## Life of an HTTPS invitation click

1. The host creates an HTTPS `open.multaiplayer.com/invite` link. The relay invite id, capability/host binding, and approval mode are all fragment fields.
2. If the installed signed app receives the universal link, Rust validates one exact URL, replaces its one pending in-memory slot, emits a payload-free availability event, and focuses the main window. The frontend subscribes before taking the slot once.
3. If the website receives the navigation instead, its pre-hydration script scrubs every fragment synchronously. A bounded candidate survives only in page memory until full validation. The page renders no invite value and sends none to storage, cookies, analytics, telemetry, or clipboard.
4. With no installed app, the page offers the official DMG. **Open multAIplayer** navigates to the alternate associated host only after an explicit click. Refresh, navigation, or closing the page loses the candidate, so the user returns to the original private message after installation.
5. React displays only an invitation-received action. Accept delegates the values to the normal join adapter and clears them. Error, denial, cancellation, supersession, or process exit also clears them.
6. The ordinary invite lifecycle below remains authoritative. Universal-link receipt alone creates no team membership, MLS state, or room access.

## Life of a chat message

1. The React composer validates the draft and dispatches a send intent through the room action layer.
2. `ChatPlaintextPayload` validates the bounded application payload. Attachment policy decides whether previews are embedded or referenced as opaque exporter-sealed blobs.
3. The desktop invokes the Rust MLS command with the room handle, payload, and authenticated metadata. No group secret or exporter output enters TypeScript.
4. The Rust MLS core persists any required state before returning the opaque MLS PrivateMessage.
5. `RelayClientMessage` wraps the blob with bounded room, sender-device, and epoch-hint routing metadata.
6. The relay authenticates the device session, verifies room membership and routing limits, durably appends the opaque message, then broadcasts `mls.message`.
7. Recipients pass the opaque blob to Rust. MLS authenticates the sender and epoch and returns only validated plaintext application data.
8. TypeScript validates the event schema again, normalizes the message, updates unread state, and deduplicates by application message id before rendering.

The relay cannot decrypt the MLS message and does not parse its application event kind.

## Life of a membership Commit

1. An approved invite or removal gives the active host a bounded membership intent.
2. Rust creates the MLS Add or Remove proposal/Commit and transactionally persists the resulting group state before exposing the opaque Commit. Add also produces a Welcome encrypted for the exact consumed KeyPackage.
3. The relay accepts a Commit only from the room's exact active host user/device and only for the next expected epoch. SQLite compare-and-swap permits one Commit for that epoch.
4. Peers independently reject a Commit unless its authenticated sender leaf is the current host leaf and its ciphersuite is the pinned suite.
5. On success, peers persist new state and derive/store that epoch's local-history exporter secret. Removed members cannot process later epochs.
6. A stale concurrent Commit is rejected so the host reloads current state and rebases the intended operation.

## Life of an invite

1. The joiner validates the fragment-carried invite id and encoded host/capability binding against current relay metadata and the active host device.
2. The joiner publishes a bounded, suite-pinned single-use KeyPackage from Rust.
3. The capability request is HPKE-sealed to the pinned host and binds the exact KeyPackage id/hash plus identities, room, operation, and epoch context.
4. The relay stores only the opaque request and content-free notification metadata.
5. After host approval, the relay consumes the exact requested KeyPackage once. Rust creates the Add Commit and Welcome.
6. The Commit follows the membership lifecycle above. The Welcome is delivered once to the authenticated requesting device and can be processed only by its intended KeyPackage private key. If the requester exits after sealing, its encrypted native pending record republishes the exact request on restart; after Welcome processing, a separate durable join-admission receipt carries relay acknowledgement to completion.

## Life of a Codex turn

Codex approval, native execution, safe event projection, and transcript handling remain host-local policy. Room-visible queue, progress, typed activity, and result payloads follow the same MLS application-message lifecycle as chat. Bounded tool input/results and provider-supplied reasoning summaries may enter the typed activity schema. Raw reasoning may enter only under the host's off-by-default per-room setting and is not guaranteed to be supplied. Raw RPC objects, unknown fields, credentials, environment/account/auth state, token data, and host-local diagnostics are not projected wholesale into room messages.
