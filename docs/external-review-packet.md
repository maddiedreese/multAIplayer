# multAIplayer MLS protocol v2: external review

Packet revision: 2026-07-13.

Thank you for reviewing multAIplayer. Record the exact commit or tag you reviewed in every finding; this living packet deliberately does not embed a self-referential commit hash. Use the private reporting path in `SECURITY.md` for potentially exploitable issues.

## Review scope

Protocol v2 replaces the custom group-key and message-protection construction with RFC 9420 MLS through `mls-rs`. Full encrypted rooms are native-only: MLS state, signature keys, HPKE keys, exporter output, and history secrets remain in Rust/Tauri and never cross webview IPC.

The application still owns security-sensitive policy and integration code. The most useful review questions are:

1. Does the Rust IPC surface prevent secret export and validate every bounded intent?
2. Do transactional persist-before-send ordering and automatic staged-write cleanup prevent forks or stale mutations across failures, crashes, and retries?
3. Is host-only Commit authority enforced independently by both the client and relay, including handoff?
4. Are KeyPackage publication, exact-request consumption, Welcome delivery, credential binding, and decision receipts replay-safe?
5. Does RFC 9180 HPKE bind enough invite capability, identity, room, operation, epoch, expiry, nonce, and exact KeyPackage context?
6. Is invite authenticator v3 unambiguous and sufficiently domain-separated between requests and responses?
7. Are retained exporter-derived history secrets described and protected consistently with the narrower live-traffic forward-secrecy claim?
8. Does native error handling retain enough diagnostic cause information without disclosing library, storage, or cryptographic details through webview IPC?

## Locked protocol choices

- MLS implementation: `mls-rs`.
- Only ciphersuite `0x0002`, `MLS_128_DHKEMP256_AES128GCM_SHA256_P256`; no negotiation or downgrade fallback.
- MLS BasicCredential payload binds GitHub user id and device id. The displayed fingerprint is the full SHA-256 digest of the signature public key's P-256 SPKI DER encoding.
- The active host is the only authorized committer. MLS's default multi-committer capability is deliberately restricted by product policy.
- Device-directed invite requests use single-shot RFC 9180 HPKE. MLS Welcome messages provide group admission.
- Each epoch's local-history key is derived with exporter label `multaiplayer history v1` and retained in encrypted device storage.
- Attachment blobs remain outside MLS messages and are sealed with keys derived using exporter label `multaiplayer blob v1` and the blob id as context.
- Protocol v2 has no legacy room-wire reader. Invite authenticator v3 rejects pre-v3 links and pending responses.

## Roles, trust, and visible metadata

- The active host controls membership and Commit production. A compromised host can admit members and disclose content while authoritative.
- Member devices hold native MLS state and can decrypt epochs in which they participate.
- The relay authenticates devices, authorizes reads, stores public KeyPackages and opaque MLS messages, serializes one Commit per epoch, and rejects non-host Commits. It is not trusted with plaintext or group secrets.
- The browser/web preview supports seeded local demo rooms only and cannot create, join, or decrypt relay-backed MLS rooms.

The relay sees team and room metadata, membership, host labels, device public identity material, invite metadata, public KeyPackages, opaque invite/Welcome and MLS-message bytes, routing metadata, sizes, and operational counters. For attachment blobs it also sees filename, MIME type, declared size, epoch, expiry, and routing identifiers; only the attachment contents are exporter-encrypted. Presence and team/room update broadcasts are plaintext metadata.

The relay may deny service, withhold messages, or lie about unauthenticated metadata. Client-side MLS validation and host-authority checks remain the security boundary.

## Message and membership flows

Application events are validated against bounded plaintext schemas, passed to Rust, and encoded as MLS PrivateMessages. Allowlist projections, including `codex.activity`, determine what enters a room message. The relay receives an opaque MLS blob plus bounded routing metadata and does not inspect the application event kind.

A joiner publishes a single-use KeyPackage, sends an HPKE-sealed capability request bound to the exact package id and hash, and the host approves that exact request. Approval atomically persists the capability decision, MLS Add state, Commit, Welcome, and outbox records before network send. The relay consumes the exact package once and delivers the Welcome once to the intended authenticated device. Bounded durable receipts make exact lost-acknowledgement retries possible without reopening admission.

Removal first revokes relay reads and sockets, then the host produces an MLS Remove Commit. Host handoff is an authenticated authority transfer coupled to a Commit; after it lands, both relay and clients accept Commits only from the new active-host leaf.

## Invite authenticator v3

The invite URL carries an independent random 256-bit capability and the issuer persists only:

```text
verifier = SHA-256("multaiplayer:invite-capability-verifier:v3\0" || raw_capability)
```

A capability binding contains version, phase, invite/team/room ids, epoch, exact KeyPackage hash, request id and nonce, requester and host user/device ids, expiry, and optional decision status/time. It is encoded independently of Serde and Rust struct field order:

```text
"multaiplayer:invite-capability-binding:v3\0"
|| version_byte
|| phase_byte
|| uint64_be(epoch)
|| 11 * (uint32_be(utf8_length) || utf8_field)
|| tagged_optional(status)
|| tagged_optional(decided_at)
```

Request fields forbid status and decision time. Response fields require them. The fixed bytes are reused as HPKE AAD and in request-receipt hashing, so all three consumers have one framing definition.

Request and response keys are derived separately:

```text
Krequest  = HMAC-SHA-256(verifier, "multaiplayer:invite-capability-request-key:v3\0")
Kresponse = HMAC-SHA-256(verifier, "multaiplayer:invite-capability-response-key:v3\0")

request_mac  = HMAC-SHA-256(Krequest,
  "multaiplayer:invite-capability-request-mac:v3\0" || binding_bytes)
response_mac = HMAC-SHA-256(Kresponse,
  "multaiplayer:invite-capability-response-mac:v3\0" || binding_bytes)
```

Phase-specific APIs reject the other phase before authentication. This uses independent key and input labels in addition to the encoded phase. There is no compatibility interpretation for v2 JSON/field-order-dependent authenticators; pre-v3 links and pending responses fail closed.

## Persistence, rollback, and crash safety

MLS state, exact outbox records, exporter-derived history secrets, per-blob keys, and admission receipts are stored in SQLCipher. Its wrapping key is held in the operating-system credential store. A state mutation and every resulting outbound record commit before any Commit, Welcome, or application message is sent. Corrupt database, WAL, and SHM files are quarantined together and require an explicit clean rejoin; rejoining does not restore older history secrets.

`mls-rs` invokes its group-state storage callback without an application transaction parameter, so multAIplayer stages application-owned records beside the pending group write. The only staging entry point returns `StagedWriteGuard`; raw staging methods are private. Every engine mutation stages through that guard. Its `Drop` implementation clears all staged outbox additions/deletions, history secrets, invite receipts/deletions, and join receipts. A successful group write clears the same buffers, making final cleanup idempotent. Regression tests cover both a staged history secret followed by a failing outbox delete and a staged outbox delete followed by a failing receipt delete.

The relay independently uses SQLite compare-and-swap state to accept exactly one Commit for epoch N. KeyPackages are public but bounded, suite-pinned, credential-validated by the bundled Rust validator, and consume-once. Production startup fails closed if `MULTAIPLAYER_MLS_VALIDATOR_PATH` is missing or unusable; the relay container builds and packages the validator.

## Error and diagnostics boundary

`EngineError` keeps stable public state errors plus structured operation failures. A failure records:

- category: `storage`, `protocol`, `serialization`, `crypto`, or `internal`;
- a static operation name identifying the failed step; and
- a bounded underlying-cause debug representation for native diagnosis and tests (at most 1,024 Unicode scalar values).

Its `Display` implementation exposes only the category and operation, never the stored cause. A rejoin-required failure retains bounded storage operation/cause detail natively but displays only the stable `MLS_REQUIRES_REJOIN` sentinel. Tauri commands use these redacted display strings. Reviewers should check both sides of this boundary: failures must not collapse into an undifferentiated MLS error internally, and dependency/storage details must not cross webview IPC.

## Deployment boundary worth reviewing

The relay origin allowlist enforces browser CORS and browser-origin WebSocket policy. Requests or upgrades without an `Origin` header are allowed for native and server-side clients; the allowlist is not client authentication. Device sessions, membership authorization, and TLS remain necessary.

Relay session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` whenever `NODE_ENV=production`. Authenticated production deployments therefore require HTTPS/WSS. An explicitly unauthenticated private-LAN development relay may set `MULTAIPLAYER_RELAY_REQUIRE_AUTH=false`, but production GitHub sign-in still does not work over plain HTTP and the production doctor intentionally rejects auth-disabled operation.

## Dependency and source-review policy

Direct dependencies are lockfile-pinned. CI audits both the application/release Cargo lockfile and the independent MLS fuzz-target lockfile with RustSec and `cargo-deny`. The structured `.github/rust-advisory-policy.json` ledger records owner, review date, exact RustSec ids and packages, dependency path, platform scope, reachability, and disposition; repository hygiene requires it to match `deny.toml`.

The current ledger keeps the `glib 0.18.5` `VariantStrIter` soundness advisory visible, records that the affected API is not called, and tracks the inherited Linux GTK3 plus proc-macro/`rust-unic` maintenance advisories. These are time-bounded assessments, not claims that advisory severity is lower. The supported release target is macOS, while Linux remains a compatibility/CI target.

Repository hygiene also caps every production Rust source file at 1,000 physical lines. This is a reviewability guard, not evidence that a module is correct.

## Honest non-goals

The protocol does not claim endpoint-compromise protection, retroactive deletion, anonymous metadata, availability against a malicious relay, browser MLS security, history forward secrecy for retained local history, or independent professional audit. Live MLS traffic receives RFC 9420 forward-secrecy and post-compromise mechanisms subject to the single active-host authority policy.

## Verification evidence

- Native tests cover suite pinning, Welcome targeting, v3 capability encoding and domain separation, HPKE context binding, removal, handoff, history across epochs, staging-guard cleanup, categorized failures, and transactional recovery.
- Relay tests cover non-host and stale Commit rejection, exact KeyPackage consumption, one-shot Welcome delivery, validation failure modes, durable receipts, and SQLite epoch compare-and-swap.
- The process security journey scans relay SQLite, WAL, SHM, and wire artifacts for plaintext and secret markers.
- Protocol and relay schemas have fuzz/property coverage and strict size limits.
- The MLS core fuzz target reaches the real RFC 9420 KeyPackage deserializer.

These tests are implementation evidence, not a cryptographic proof or audit.

## Review map

| Topic                                  | Location                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Protocol decision and claims           | `docs/decisions/mls-protocol-v2.md`, `docs/cryptography.md`, `docs/protocol.md`                  |
| MLS lifecycle orchestration            | `apps/desktop/src-tauri/crates/mls-core/src/engine.rs`, `engine/invite_admission.rs`              |
| Engine output and error types          | `apps/desktop/src-tauri/crates/mls-core/src/engine/types.rs`, `engine/error.rs`                  |
| Outbound staging and host transfer     | `apps/desktop/src-tauri/crates/mls-core/src/engine/outbound.rs`, `engine/host_transfer.rs`       |
| Exporter use and input validation      | `apps/desktop/src-tauri/crates/mls-core/src/engine/exporter.rs`, `engine/validation.rs`          |
| Transaction adapter and rollback guard | `apps/desktop/src-tauri/crates/mls-core/src/storage.rs`, `storage/atomic_group.rs`               |
| Encrypted history/blob/receipt store   | `apps/desktop/src-tauri/crates/mls-core/src/storage/encrypted_store.rs`                          |
| Invite v3 and HPKE                     | `apps/desktop/src-tauri/crates/mls-core/src/invite_capability.rs`, `hpke_seal.rs`                |
| Native Tauri command boundary          | `apps/desktop/src-tauri/src/mls_native.rs`, `mls_native/types.rs`, `mls_native/invites.rs`       |
| Credential and KeyPackage validation   | `apps/desktop/src-tauri/crates/mls-core/src/policy.rs`, `validator.rs`                           |
| KeyPackage and Welcome delivery        | `apps/relay/src/http/key-packages.ts`, `apps/relay/src/http/invite-delivery.ts`                  |
| Commit authorization and ordering      | `apps/relay/src/ws/fanout.ts`, `apps/relay/src/persistence.ts`                                   |
| Origin, cookie, and deployment policy  | `apps/relay/src/http/origin-policy.ts`, `apps/relay/src/auth/session.ts`, `docs/self-hosting.md` |
| Advisory ledger and CI audit           | `.github/rust-advisory-policy.json`, `deny.toml`, `.github/workflows/rust-audit.yml`             |
| Threat claims and changelog            | `docs/threat-model.md`, `docs/threat-model-changelog.md`                                         |

Findings, partial reviews, and questions are welcome. State the exact reviewed commit or tag and preferred attribution.
