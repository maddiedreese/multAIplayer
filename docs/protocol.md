# Protocol

This is a mechanism/interoperability reference. The [threat model](threat-model.md) is the sole normative source for security claims, trust assumptions, audit status, and residual risks; if wording here conflicts, the threat model controls.

multAIplayer protocol v2 uses RFC 9420 MLS via `mls-rs` for native encrypted rooms. The relay wire/store formats route opaque MLS messages and public/bounded metadata rather than fields for room plaintext, MLS private state, exporter output, or history secrets. Current assurance and audit status are stated only in the threat model.

Protocol v2 is a clean break. Pre-v2 rooms and invite links are invalid and there is no legacy envelope or room-key migration path.

## Locked MLS profile

- Implementation: `mls-rs` in the Rust/Tauri boundary.
- Ciphersuite: only `0x0002`, `MLS_128_DHKEMP256_AES128GCM_SHA256_P256`.
- Credential: MLS BasicCredential binding GitHub user id and device id.
- Fingerprint: full SHA-256 digest of the MLS signature public key.
- Authority: only the currently designated active-host leaf may produce a Commit.
- Browser: static native-app notice only; no workspace, relay client, identity, or browser MLS implementation.

All group state and cryptographic operations live in Rust. Webview IPC accepts bounded intents and returns plaintext display data, public state, opaque MLS messages, or opaque handles. It never returns signature private keys, HPKE private keys, group secrets, exporter output, or retained history secrets.

## Application messages

Chat, reactions, edits, deletes, room-setting audit records, browser and workspace approvals, terminal events, Codex queue/progress/activity, Git events, and host-handoff records are bounded application payloads carried in MLS PrivateMessages. The existing plaintext schemas and allowlist projections determine what enters a message; MLS supplies sender authentication, epoch binding, and confidentiality.

Authenticated application metadata uses the MLS `authenticated_data` field with canonical serialization. The relay receives only an opaque `mlsMessage` plus bounded routing metadata: message id, team/room id, authenticated sender device/account, message class, creation time, and an epoch hint used for delivery ordering. It does not inspect the application event kind.

Publishes are idempotent by message id within a room. State that produces a message is persisted before send. The relay durably stores the message before broadcast. To recover from a lost acknowledgement after backlog pruning or an epoch advance, it retains exact-digest acceptance receipts for 180 days: Commit receipts use an independent per-room pool, while application receipts are bounded per room and sender account so one member cannot multiply its allowance across devices or evict another member's retry record.

## KeyPackages and invites

Devices publish bounded batches of single-use public KeyPackages. The relay verifies the pinned suite and calls the bundled Rust validator to ensure the credential matches the authenticated uploader. Production startup fails closed without a usable validator.

Invite links retain the authorization design: an independently random single-use capability remains in the URL fragment, the host identity/fingerprint is pinned, and only a verifier is persisted by the issuer. The fragment contains no group secret.

The joiner sends an RFC 9180 HPKE-sealed request to the pinned host. Its info/AAD binds operation, identities, room, epoch, capability record, and the exact published KeyPackage id/hash. Invite authenticator v3 uses a fixed binary framing rather than JSON serialization, plus independently derived request/response HMAC keys and labels; phase-specific verifiers cannot accept the other domain. Before network publication, the requester persists the exact sealed request, native-only bearer capability, and authoritative original binding in its encrypted native store. The public binding is also present in the relay-visible request envelope. A restart can therefore republish byte-identical bytes, while response authentication still occurs inside Rust using the native-stored capability and binding rather than renderer-supplied values. Rust and relay contract tests pin the envelope's canonical field order across the language boundary. The relay exposes only a content-free pending notification. Approval consumes that exact KeyPackage once; the host creates an MLS Add Commit and Welcome. The relay refuses to persist the Welcome until the room's durable accepted epoch has advanced from the request epoch. The native outbox binds and orders the corresponding Add Commit and Welcome; the relay independently prevents any pre-Commit Welcome publication but does not inspect opaque MLS membership contents. The Welcome is delivered only to the authenticated requesting device and is usable only with the intended KeyPackage private key. The requester's acknowledgement atomically removes the response and invite; approval also admits the exact user, while denial never does. Bounded durable receipts on both sides make a lost publication or acknowledgement safely retryable after restart. Once a decision is pending, the invite rejects new requests so deletion of the issuer's verifier cannot leave a reusable dead link.

## Commit ordering and host authority

MLS permits member Commits by default, but multAIplayer deliberately does not. Clients reject a Commit unless MLS authenticates its sender as the leaf designated by the current host-authority group context. The relay independently requires the exact active host account/device.

Room creation reserves the authenticated creator as the offline bootstrap host. That creator may activate exactly one registered, device-authenticated identity while the room has no MLS epoch; the transition initializes relay epoch zero. The reservation survives relay restart. Direct release, reclaim, or later host mutation is rejected—after bootstrap, only a signed MLS handoff Commit can change host authority.

The relay accepts exactly one Commit for epoch N using a durable SQLite compare-and-swap transition. An exact retry of the already accepted Commit is acknowledged from its durable receipt; a different competing Commit receives a stale-epoch response and must be rebased from current group state. Commit-producing local mutations are transactionally persisted before network send so a crash cannot produce a message from uncommitted state.

Application publishes may arrive at the current epoch or either of the two immediately preceding epochs retained by the native core. This permits a message encrypted and persisted before a concurrent host Commit to finish sending without weakening Commit ordering. Future application epochs are rejected as stale state; older messages receive `application_epoch_expired` so the desktop can discard that exact native outbox item and surface a failed-send warning. Relay room membership and device-session checks still run before this epoch window, so removed members and nonmembers cannot use it to publish.

Host handoff changes the authenticated host designation alongside a Commit. After the transfer, neither clients nor relay accept further Commits from the old host.

## Invite transport versus admission

The official transport URL is `https://open.multaiplayer.com/invite#invite=<id>&multaiplayerJoin=<encoded>&approval=request`. All three fields are fragment parameters. They are not HTTP query parameters and are not sent to the website origin by a conforming browser. The apex host is an associated-domain fallback for one explicit user retry. No `multaiplayer:` custom scheme is defined.

Universal-link and website parsing are transport gates only. Native intake validates the HTTPS host/path/authority, exact singleton fragment fields, base64url alphabets, and independent size ceilings, then provides the parsed values once to the existing join adapter. It does not register membership, publish a KeyPackage, or unlock a room. The encoded invitation is still decoded and matched against relay metadata, active-host identity/device/fingerprint, expiry, and the production v3 capability binding before the device publishes its HPKE-sealed request. Because a real invitee is not a member yet, the invite lookup returns only the room's exact active-host public identity fields; the host-only request lookup likewise returns only each requester's exact registered signature identity. Neither grants access to the membership-scoped team device directory. Both clients fail closed if a projection is absent or differs from its protected binding.

GitHub OAuth and ChatGPT authorization are out-of-band account protocols, not room or MLS events. GitHub Device Flow polling and access-token custody terminate in native Rust; the relay receives the identity token over TLS for verify-then-discard bootstrap at initial sign-in and when a missing or expired CLI relay session is re-established. Codex browser/device login terminates at the local app-server. Onboarding stores neither flow's transient identifiers. An invite join requires authenticated GitHub identity when relay auth is enabled, but does not require local Codex or ChatGPT authorization.

## Removal

Removal is an MLS Remove Commit. The relay first closes the removed member's live sockets, blocks future reads, and revokes outstanding invites. The active host then commits the removal and advances the MLS epoch. The removed leaf has no new epoch secret. Already delivered plaintext, exports, screenshots, and retained older history cannot be revoked.

## Attachments and history

Large attachment blobs do not travel as MLS application messages. Rust derives a per-blob key with exporter label `multaiplayer blob v1` and blob-id context, and the relay stores only the opaque sealed blob. Client-generated blob ids are room-bound and duplicate/cross-room access is rejected. Draft binding still prevents a delayed upload from attaching to another room.

On every epoch transition, Rust derives a history secret with exporter label `multaiplayer history v1` and retains it in the encrypted native store. This preserves local history readability across epochs while live MLS traffic advances. New members receive no pre-join history. A device that loses state and rejoins cannot reconstruct old history secrets.

## Device and local state

MLS signature and HPKE identity keys are generated in Rust. Keychain-held wrapping material protects the encrypted native SQLite store, and identity private material is retrieved under the native process boundary. Corrupt state is quarantined and the UI offers a clean KeyPackage/Welcome rejoin; neither the host nor relay can reconstruct the device's lost MLS state or older exporter-derived history secrets.

Device authentication to the relay uses a signed, domain-separated, one-use challenge and a bounded session token. Public signature and HPKE keys are registered as metadata; private keys never reach the relay.

## Relay-visible data

The relay sees team/room names and ids, membership, host labels, device public identity material, invite metadata, public KeyPackages, opaque request/Welcome blobs, opaque MLS message sizes and routing metadata, attachment filename/MIME/declared-size/epoch/expiry metadata, and operational counters. Host-local project paths and Codex model/tuning configuration travel only in host-authenticated MLS `room.config` snapshots. Attachment contents are exporter-encrypted; their routing and descriptive metadata are not. Presence and `team.updated`/`room.updated` broadcasts remain plaintext metadata and are not stored in the MLS backlog.

The relay can deny service, withhold or replay retained opaque messages within application limits, and lie about unauthenticated metadata. MLS validation, authenticated application data, exact host-leaf checks, idempotency, and monotonic epochs make unauthorized mutation fail closed; they do not make the relay available.

## Limits and compatibility

HTTP, WebSocket, KeyPackage, MLS-message, sealed-request, Welcome, metadata, backlog, blob, and rate limits are enforced independently. The old cryptographic nonce budget and room-key rotation counter do not exist in v2; MLS derives per-message keys and nonces from its key schedule.

Shared Zod schemas in `packages/protocol` are authoritative for live wire and domain shapes. Relay persistence is a second trust boundary: SQLite rows may be relationally inconsistent, malformed, or edited outside the process. `store-codec.ts` coordinates encoding and decoding, while `store-codec-normalizers.ts` applies persistence-only byte ceilings, canonical-encoding checks, expiry, and cross-record constraints. Missing or unsupported database version metadata, malformed JSON, storage-key identity mismatches, and invalid team, room, membership, or device rows fail startup for operator recovery. Invalid or expired sessions and independently optional artifacts are discarded rather than granted authority. The public alpha begins with the current version-1 SQLite shape and carries no multAIplayer pre-release migration readers.

An approved KeyPackage alone does not admit the invitee. The relay requires the exact approved Welcome response to be durably stored before a matching user/device may consume the invite and join. This prevents a reconnect between the membership Commit and Welcome publication from deleting the capability that the host still needs to finish recovery.

Unknown ciphersuites and malformed MLS/public records are rejected. There is no v1 envelope reader, v2/v3 AAD selection, custom room-secret wrap, rotation envelope, or direct room-secret delivery.
