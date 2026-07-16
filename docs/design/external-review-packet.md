# External security review packet

Packet revision: 2026-07-15.

This design packet is preparation material for a future independent review. It is not a merge gate or an audit result, and it deliberately does not restate product security claims: [the threat model](../threat-model.md) is the only normative claims source. Maintainer workflow, CI, dependency, release, and relay operations live in [CONTRIBUTING.md](../../CONTRIBUTING.md).

The multAIplayer cryptographic integration has **not received an independent professional audit**. Record the exact commit or tag reviewed, reviewer identity, dates, and findings before changing that status anywhere in the product or documentation. Potentially exploitable findings use the private process in [SECURITY.md](../../SECURITY.md).

## Review scope

### Targeted cryptography review

The first paid review is intentionally narrow enough for one experienced cryptographer to complete in roughly one working week:

- `apps/desktop/src-tauri/crates/mls-core/src/engine/invite_admission.rs`
- `apps/desktop/src-tauri/crates/mls-core/src/engine/host_transfer.rs`
- `apps/desktop/src-tauri/crates/mls-core/src/hpke_seal.rs`
- `apps/desktop/src-tauri/crates/mls-core/src/invite_capability.rs`
- exporter and retained-history derivation in `apps/desktop/src-tauri/crates/mls-core/src/engine/exporter.rs`, plus the immediately called staging/persistence code

The reviewer should answer the following existing questions, preserving their numbering for stable references:

3. Is host-only Commit authority enforced independently by both the client and relay, including handoff?
4. Are KeyPackage publication, exact-request consumption, Welcome delivery, credential binding, and decision receipts replay-safe?
5. Does RFC 9180 HPKE bind enough invite capability, identity, room, operation, epoch, expiry, nonce, and exact KeyPackage context?
6. Is invite authenticator v3 unambiguous and sufficiently domain-separated between requests and responses?
7. Are retained exporter-derived history secrets described and protected consistently with the narrower live-traffic forward-secrecy claim?

The engagement is complete only when the repository records:

- reviewed commit/tag and any excluded lines or dependencies;
- reviewer and review dates;
- findings with severity and disposition;
- retest commit for every remediation;
- a short final statement distinguishing design review, implementation review, and test review.

Until that record exists, the invite flow and public documentation must continue to say **unaudited**.

### Tauri IPC review

The second focused review surface is every `#[tauri::command]` registered by the invocation handler in `apps/desktop/src-tauri/src/lib.rs`. The repository-owned [IPC audit](../tauri-ipc-boundary-audit.md) records, command by command:

1. whether the return value can contain secret material;
2. whether every caller-controlled input is parsed, bounded, canonicalized, and authorized in Rust;
3. whether the command fails closed when invoked before authentication, outside the selected room/project, twice, or after state changes.

The `typed-tauri-command` procedural macro makes a noncanonical fallible command return type a compile error. A separate Rust exact-set test requires every compiler-owned registration to have exactly one IPC-audit row. Neither control is authorization evidence: reviewers must still inspect validation, authority, state, and sensitive output.

### Updater trust review

Review the signed metadata comparator, its read-once authentication-failure signal, and the desktop warning as one boundary. A tampered newer manifest must fail closed **and** surface **Update check could not be verified**; an authenticated non-increasing manifest remains a quiet no-update result. Confirm that the embedded public key matches the pre-committed SHA-256 fingerprint in the README, release verification guide, and independently hosted `multaiplayer.com/security/updater-key` page. Treat the updater key and Apple Developer ID as separate mechanisms but not as independent account-compromise defenses while one maintainer and GitHub release environment can authorize both.

### Out of scope for the narrow engagement

The initial review does not certify the complete Tauri shell, relay availability, GitHub/Codex providers, Apple signing infrastructure, operating-system credential stores, SQLCipher, `mls-rs`, or the end-user device. Findings that depend on those systems should still be recorded as assumptions or follow-up scope.

### Relay reliability boundary

The single-node relay is not part of the narrow cryptography certification scope, but reviewers should not infer a conventional relational data model from “SQLite persistence.” The process keeps durable entities in memory, stores entity payloads as JSON rows, and synchronously commits tracked mutations before success or broadcast; whole-state serialization is limited to legacy import. Review the fail-stop path as part of this boundary: a runtime SQLite failure must poison readiness, close active sockets, emit `relay_store_persistence_poisoned`, and terminate the production process for supervised restart rather than serve divergent memory. Global and per-team durable-entry ceilings fail startup or insertion explicitly, actual stored attachment-ciphertext bytes drive live/upload quotas, and quota-consuming compound insertions must roll back their contributed quota/entity state on capacity rejection. The [single-node decision](../decisions/single-node-relay.md) records this tradeoff, and [self-hosting](../self-hosting.md) records the operational recovery and trusted-proxy checks.

The checked-in [synchronous-persistence soak](../benchmarks/relay-soak-2026-07-15.md) records request/publish p99, event-loop p99/max, WAL bounds, room/member cardinality, restarts, and integrity evidence before and after WAL checkpoint tuning. It is local alpha evidence, not a hosted SLO.

## Locked choices

These are implementation constraints, not review conclusions:

- Protocol v2 uses `mls-rs` and only ciphersuite `0x0002` (`MLS_128_DHKEMP256_AES128GCM_SHA256_P256`). There is no negotiation or legacy room-wire reader.
- MLS BasicCredential canonically binds the GitHub user id and device id. Displayed device fingerprints use the complete SHA-256 digest of the P-256 signature SPKI DER.
- Product policy permits only the active host leaf to create membership or host-transfer Commits.
- Device-directed invite requests use RFC 9180 HPKE with P-256, HKDF-SHA-256, and AES-128-GCM. MLS Welcome messages perform group admission.
- Invite authenticator v3 rejects earlier invite authenticators and separates request and response encodings and MAC domains.
- History retention derives 32 bytes with exporter label `multaiplayer history v1`; attachment keys use label `multaiplayer blob v1` and the blob id as context.
- Mutation, outbox, and retained-material changes are staged and committed before network send.
- Cryptographic private material and raw exporter output are intended to remain behind the Rust/Tauri IPC boundary; verify that intent against the IPC audit and implementation rather than accepting it from this packet.

Changing any item requires an explicit compatibility decision, focused tests, and an update to the canonical threat model.

## Evidence map

Evidence demonstrates exercised behavior at a recorded revision; it does not convert an unaudited integration into an audited one.

| Review question                     | Primary implementation                                                                     | Focused evidence                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 3 — host-only Commit and handoff    | `engine/host_transfer.rs`, `engine/membership.rs`, relay Commit admission/routes           | generated membership transitions, host-transfer tests, real two-client native journey                  |
| 4 — exact request and replay safety | `engine/invite_admission.rs`, native admission persistence, relay KeyPackage/invite routes | lost-ack/restart journey, KeyPackage consumption tests, duplicate decision/receipt tests               |
| 5 — HPKE context binding            | `hpke_seal.rs`, invite binding/canonical encoding                                          | RFC 9180 known-answer tests, wrong-recipient/context tests, malformed-input cases                      |
| 6 — authenticator separation        | `invite_capability.rs`, invite request/response validators                                 | request/response cross-use rejection, canonical encoding vectors, property tests                       |
| 7 — exporter/history retention      | `engine/exporter.rs`, `engine/outbound.rs`, `storage/retained_material.rs`                 | epoch/history/blob round trips, removal/rejoin model, plaintext-marker journey                         |
| IPC secret/validation/state review  | `apps/desktop/src-tauri/src/lib.rs` and registered command modules                         | `docs/tauri-ipc-boundary-audit.md`, exact registration/audit Rust test, typed-command compile contract |

### Executable entry points

- `npm run verify` — blocking TypeScript, relay/package, build, Rust, and native verification.
- `npm run test:security-journey` — deterministic native/relay confidentiality and lifecycle journey; missing Rust is a failure, never a skipped success.
- `npm run test:e2e:native` — two real Tauri clients through invite, message, restart, and host handoff.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --all-features` — native unit/property/integration evidence.
- Weekly `Product journeys` — scheduled relay parsing fuzzing, expanded relay decision mutation signal, chaos/restore exercise, and native parser fuzzing.
- Scheduled macOS two-client and signed release workflows — platform evidence plus the authenticated version/URL/archive-signature metadata binding, signed updater bundle, SPDX SBOM, provenance, Sigstore bundles, and advisory normalized-payload comparison record.

### Reviewer record

Copy this table into the review deliverable; do not mark the integration audited from an informal conversation or automated scan.

| Field                     | Value              |
| ------------------------- | ------------------ |
| Commit or tag             | _Not yet reviewed_ |
| Reviewer                  | _Not yet assigned_ |
| Review dates              | _Not started_      |
| Included questions        | 3–7                |
| Findings                  | _Pending_          |
| Remediation/retest commit | _Pending_          |
| Final disposition         | **Unaudited**      |
