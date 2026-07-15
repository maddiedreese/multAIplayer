# Cryptography mechanism

This document describes formats, algorithms, state transitions, and storage locations. It does not state product security claims or audit conclusions; those belong only in the [threat model](threat-model.md). The [external review packet](external-review-packet.md) defines the first independent review scope.

## Ciphersuite and credentials

Protocol v2 uses RFC 9420 MLS through Rust `mls-rs` with only `MLS_128_DHKEMP256_AES128GCM_SHA256_P256` (`0x0002`). The decoder accepts no other suite and there is no suite negotiation.

Each native installation creates an MLS P-256 signature key and a distinct RFC 9180 HPKE P-256 key. Private records are stored through the native credential/storage adapters. An MLS BasicCredential encodes GitHub user id and device id. The displayed fingerprint is SHA-256 over the signature public key's P-256 SPKI DER.

## MLS group state and host authority

`mls-rs` maintains group state, epochs, credentials, proposals, Commits, Welcome messages, and PrivateMessages. Native application records and MLS state use SQLCipher; its wrapping key is obtained through the operating-system credential adapter. Outbound mutations stage group state, retained material, and exact outbox records in one transaction before the network layer sends them.

The application adds a mandatory GroupContext extension containing the active host leaf/device. Commit constructors and inbound processing compare the committer with that extension. Relay Commit admission separately compares the authenticated device with the room's current host record and expected epoch. Host handoff encodes an authorization record, signature, and Commit that changes the extension and relay routing authority.

The current project/Codex configuration is a versioned `room.config` MLS application payload. Rust parses and bounds its fields, revision, and epoch, stores the latest native copy for retry, and produces a PrivateMessage. Receivers order accepted snapshots by authenticated epoch/revision.

## Application messages and attachments

Room events are MLS PrivateMessages. Canonical authenticated data encodes message id, team id, room id, sender user/device ids, creation time, event kind, and epoch. The receiver compares that routing record with the decrypted application record and sender credential.

Attachment bytes are stored outside MLS messages as exporter-sealed blobs. For each blob, the native core derives 32 bytes using exporter label `multaiplayer blob v1` and the blob id as context. The sealed record carries its format version, epoch, nonce, and ciphertext; public attachment routing metadata is encoded separately.

## Invites and device-directed HPKE

An invite link contains a random capability, pinned host identity material, bounded room metadata, and a relay invite id in its URL fragment. The issuer stores a verifier derived as:

```text
SHA-256("multaiplayer:invite-capability-verifier:v3\0" || capability)
```

The joiner publishes a single-use MLS KeyPackage and sends an RFC 9180 HPKE request using P-256, HKDF-SHA-256, and AES-128-GCM to the pinned host HPKE key. Invite authenticator v3 uses a fixed prefix, version/phase discriminants, big-endian epoch, length-prefixed UTF-8 fields, and tagged optional decision fields. The canonical bytes are used as HPKE AAD and request-receipt input.

Request and response MAC keys use separate derivation labels:

```text
multaiplayer:invite-capability-request-key:v3\0
multaiplayer:invite-capability-response-key:v3\0
```

Their MAC inputs also use distinct request/response labels. Admission loads the stored capability/binding, consumes the exact KeyPackage, creates the MLS Add Commit and Welcome, and records the resulting outbox state transactionally. Pre-v3 invite authenticators are not decoded by protocol v2.

The HTTPS universal link, AASA files, native one-shot URL intake, and React onboarding are delivery layers around that same native admission flow. The accepted URL shape is described in [Using the app](using-the-app.md#invites-and-mls-membership).

## History retention and exporter derivation

At each epoch, the native engine derives 32 bytes with:

```text
exporter("multaiplayer history v1", context = "", length = 32)
```

That value is stored as retained epoch material in the encrypted native database and is used with room/epoch authenticated data for local-history sealing and opening. Retention and deletion behavior are defined by the local-history settings and native forget/delete operations. The implications for forward secrecy and device compromise are stated only in the [threat model](threat-model.md#host-authority-forward-secrecy-and-recovery).

### Passphrase-encrypted room archives

Room export serializes a bounded version-1 display-history envelope and encrypts it with the exact-pinned `age` passphrase API. The envelope contains a digest of its display-history body. The native archive library stores the original age bytes and a sidecar containing random archive id, import time, encrypted byte length, and format version. Imported records are normalized into a read-only display projection. See [Room archives](room-archives.md) for the file format and operations.

## Onboarding record

The resumable onboarding record is a bounded webview workflow record. Its schema includes create/join intent, selected presentation surface, coarse readiness/completion flags, and limited team/room identifiers. Invite capability, KeyPackage private state, Welcome bytes, project path, prompts, provider credentials, and transcripts are not fields in that schema. Membership continues through the native invite/MLS flow described above.

## Implementation and test map

| Mechanism                        | Implementation                                                           | Tests/evidence                                                           |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| MLS lifecycle and host extension | `crates/mls-core/src/engine/*`                                           | engine unit/property tests, lifecycle fixture, native two-client journey |
| RFC 9180 device sealing          | `crates/mls-core/src/hpke_seal.rs`                                       | RFC Appendix A.3 vector and context/recipient cases                      |
| Invite authenticator/capability  | `crates/mls-core/src/invite_capability.rs`, `engine/invite_admission.rs` | canonical encoding, phase separation, replay/restart cases               |
| Exporter/history/blob records    | `engine/exporter.rs`, retained-material storage                          | round trips, epoch transitions, plaintext-marker journey                 |
| Tauri exposure                   | `apps/desktop/src-tauri/src/lib.rs`, `mls_native*`                       | [command audit](tauri-ipc-boundary-audit.md), native command tests       |

Protocol or storage compatibility decisions are recorded under [docs/decisions](decisions/README.md). Reviewer questions and the exact narrow engagement are in the [external review packet](external-review-packet.md).
