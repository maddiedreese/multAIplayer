# multAIplayer MLS protocol v2: external review

Thank you for reviewing multAIplayer. Please anchor findings to the commit reviewed and use the private reporting path in `SECURITY.md` for potentially exploitable issues.

## Review scope

Protocol v2 replaces the custom group-key and message-protection construction with RFC 9420 MLS through `mls-rs`. Full encrypted rooms are native-only: MLS state, signature keys, HPKE keys, exporter output, and history secrets remain in Rust/Tauri and never cross webview IPC.

The most useful review questions are:

1. Does the Rust IPC surface prevent secret export and validate every bounded intent?
2. Does transactional persist-before-send ordering prevent forks across crashes and retries?
3. Is host-only Commit authority enforced independently by both the client and relay, including handoff?
4. Are KeyPackage publication, exact-request consumption, Welcome delivery, and credential binding replay-safe?
5. Does RFC 9180 HPKE bind enough invite capability, identity, room, operation, and epoch context?
6. Are retained exporter-derived history secrets described and protected consistently with the narrower live-traffic forward-secrecy claim?

## Locked protocol choices

- MLS implementation: `mls-rs`.
- Only ciphersuite `0x0002`, `MLS_128_DHKEMP256_AES128GCM_SHA256_P256`; no negotiation or downgrade fallback.
- MLS BasicCredential payload binds GitHub user id and device id. The displayed fingerprint is the full SHA-256 digest of the MLS signature public key.
- The active host is the only authorized committer. MLS's default multi-committer capability is deliberately restricted by product policy.
- Device-directed invite requests use single-shot RFC 9180 HPKE. MLS Welcome messages provide group admission.
- Each epoch's local-history key is derived with exporter label `multaiplayer history v1` and retained in encrypted device storage.
- Attachment blobs remain outside MLS messages and are sealed with keys derived using exporter label `multaiplayer blob v1` and the blob id as context.
- Protocol v2 has no legacy wire reader. Pre-v2 rooms and invite links are unreadable and invalid.

## Roles and trust

- The active host controls membership and Commit production. A compromised host can admit members and disclose content while authoritative.
- Member devices hold native MLS state and can decrypt epochs in which they participate.
- The relay authenticates devices, authorizes reads, stores public KeyPackages and opaque MLS messages, serializes one Commit per epoch, and rejects non-host Commits. It is not trusted with plaintext or group secrets.
- The browser/web preview supports seeded local demo rooms only and cannot create, join, or decrypt relay-backed MLS rooms.

The relay may deny service, withhold messages, or lie about unauthenticated metadata. Client-side MLS validation and host-authority checks must remain the security boundary.

## Message and membership flows

Application events are validated against bounded plaintext schemas, passed to Rust, and encoded as MLS PrivateMessages. Existing allowlist projections, including `codex.activity`, still determine what enters a room message. The relay receives only an opaque MLS blob plus bounded routing metadata.

Invite links retain the single-use bearer-capability and host-pinning policy. A joiner publishes single-use KeyPackages, sends an HPKE-sealed capability request bound to the exact KeyPackage id and hash, and the host approves that exact request. The host creates an Add Commit and Welcome; the relay consumes the exact package once and delivers the Welcome once to the intended authenticated device.

Removal first revokes relay reads and sockets, then the host produces an MLS Remove Commit. Host handoff is an authenticated authority transfer coupled to a Commit; after it lands, both relay and clients accept Commits only from the new active host leaf.

## Persistence and crash safety

MLS state and exporter-derived history keys are stored in an encrypted native SQLite store whose wrapping key is held in the OS credential store. A mutation is committed before its resulting Commit, Welcome, or application message is sent. Corrupt state is quarantined and requires an explicit clean rejoin; rejoining does not restore older history secrets.

The relay uses SQLite compare-and-swap state to accept exactly one Commit for epoch N. KeyPackages are public but bounded, suite-pinned, credential-validated by the bundled Rust validator, and consume-once. Production startup fails closed if `MULTAIPLAYER_MLS_VALIDATOR_PATH` is missing or unusable; the relay container builds and packages the validator.

## Honest non-goals

The protocol does not claim endpoint-compromise protection, retroactive deletion, anonymous metadata, availability against a malicious relay, browser MLS security, history forward secrecy for retained local history, or independent professional audit. Live MLS traffic receives RFC 9420 forward-secrecy and post-compromise mechanisms subject to the single active-host authority policy.

## Verification evidence

- Native tests cover suite pinning, Welcome targeting, HPKE context binding, removal, handoff, history across epochs, and transactional state recovery.
- Relay tests cover non-host and stale Commit rejection, exact KeyPackage consumption, one-shot Welcome delivery, validation failure modes, and SQLite epoch compare-and-swap.
- The process security journey scans relay SQLite, WAL, SHM, and wire artifacts for plaintext and secret markers.
- Protocol and relay schemas have fuzz/property coverage and strict size limits.

These tests are implementation evidence, not a cryptographic proof or audit.

## Review map

| Topic                             | Location                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------- |
| Protocol decision                 | `docs/decisions/mls-protocol-v2.md`                                             |
| MLS core and validator            | `apps/desktop/src-tauri/crates/mls-core/`                                       |
| Native command boundary           | `apps/desktop/src-tauri/src/lib.rs`                                             |
| Public protocol schemas           | `packages/protocol/src/`                                                        |
| KeyPackage and Welcome delivery   | `apps/relay/src/http/key-packages.ts`, `apps/relay/src/http/invite-delivery.ts` |
| Commit authorization and ordering | `apps/relay/src/ws/fanout.ts`, `apps/relay/src/persistence.ts`                  |
| Threat and crypto claims          | `docs/threat-model.md`, `docs/cryptography.md`                                  |

Findings, partial reviews, and questions are welcome. Please state the reviewed commit and preferred attribution.
