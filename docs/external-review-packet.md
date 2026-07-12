# multAIplayer cryptographic protocol: external review

Thank you for reading this. Careful outside review is the most valuable thing this project can receive right now, and any time you spend on it, whether a full read or a single sharp question, is genuinely appreciated.

- Repository: https://github.com/maddiedreese/multAIplayer
- This document describes commit `22cf4fafec3292842c18850adcf1b30136a48c66`. Please anchor findings to that commit or note the commit you reviewed.
- Runtimes: the desktop client is a Tauri app (webview WebCrypto); the relay is Node.js. All cryptography runs through WebCrypto.
- If you find something you believe is seriously exploitable, please consider the private reporting path in `SECURITY.md` before posting details publicly.

## 1. Review request

This packet is the curated front door for external cryptographic and protocol review. It intentionally overlaps with the living protocol, cryptography, and threat-model documentation so reviewers can evaluate the relevant construction and implementation boundaries from one pinned snapshot.

multAIplayer is an end-to-end encrypted collaboration application with one active host per room. The host serializes membership administration and distributes independent room keys to registered devices. This draft asks reviewers to evaluate the concrete construction, binding choices, downgrade surface, and lifecycle logic before the project broadens its alpha.

The most useful review questions are:

1. Does the authenticated static-host ECDH + HKDF construction bind enough context and use HKDF correctly?
2. Are the invite bearer-capability and device-pinning steps sufficient to prevent relay substitution, replay, and unknown-key-share failures? Note that the authenticated-wrap context binds device identifiers, not key fingerprints; recipient-key binding is implicit through ECDH and sender-key binding is an explicit comparison against the pinned host key.
3. Does the member-removal rotation sequence actually exclude removed devices from future epochs under the stated threat model?
4. Are any canonical-record fields missing, ambiguous, or attacker-controlled in a dangerous way?
5. Are the retained legacy receive paths safely separated from authenticated room-key delivery?
6. Should the direct ECDH-to-AES `deriveKey` construction used by device seals and standalone legacy wraps be replaced immediately, despite authenticated room-key delivery already using HKDF?
7. Is it acceptable that device seals are confidentiality-only (ephemeral sender, no sender authentication at the seal layer), given that authenticity is supplied by the invite capability MAC, relay account authentication, and the pinned-host authenticated wrap?
8. At what point should this design be retired in favor of a maintained MLS implementation?

## 2. Non-goals and honest claims

This protocol does not claim:

- MLS compatibility or MLS security properties;
- decentralized group administration;
- per-message forward secrecy or a per-message ratchet;
- post-compromise security while a compromised host remains authoritative;
- retroactive deletion from removed members;
- protection from a compromised endpoint or active host;
- hardware-backed isolation of JavaScript/WebCrypto key handles;
- sender authentication at the device-seal layer (seals are confidentiality-only; see section 7.1);
- anonymous metadata or traffic analysis resistance;
- independent professional audit.

The intended property is narrower: a relay that follows or violates the application protocol should not learn room plaintext or room keys; admitted devices can decrypt epochs delivered to them; removal prevents delivery of fresh independent epoch keys to excluded devices; and recipients authenticate host-originated room-key deliveries against a pinned host device key.

## 3. Roles and trust assumptions

- **Active host:** sole room-administration and rotation authority. A compromised host can admit devices, disclose plaintext, and choose future epoch membership.
- **Member device:** owns a P-256 ECDH identity key pair and may hold one or more room epoch keys.
- **Relay:** authenticates accounts, stores metadata/ciphertext, routes envelopes, closes removed-member sockets, and enforces epoch message budgets. It is not trusted with plaintext or key material.
- **Invite recipient:** initially knows a confidential invite URL fragment containing a bearer capability and the expected host identity/public key.
- **Operating system credential store:** protects the serialized native device identity at rest. A compromised webview during startup remains in the endpoint trust boundary.

The network and relay are adversarial for cryptographic review. Endpoints, the active host, and any channel carrying a complete invite link are trusted only to the degree explicitly stated.

## 4. Primitive suite

| Purpose | Construction |
| --- | --- |
| Room/local/attachment encryption | AES-256-GCM, random 96-bit nonce |
| Device identity | P-256 ECDH key pair |
| Authenticated host-to-device room-key delivery | static-static P-256 ECDH shared secret → HKDF-SHA-256 → AES-256-GCM |
| Device seals (confidentiality-only) | ephemeral-static P-256 ECDH → direct WebCrypto `deriveKey` to AES-256-GCM |
| HKDF salt (authenticated delivery) | SHA-256 of the complete canonical authenticated-data bytes |
| HKDF info (authenticated delivery) | UTF-8 `multaiplayer:authenticated-room-secret-wrap:v2` |
| Invite capability authentication | HMAC-SHA-256 with an independent random 256-bit bearer key |
| Invite capability at-rest verifier | SHA-256 over a canonical record in domain `multaiplayer:invite-capability-verifier` |
| Device fingerprint | SHA-256 over a fixed canonical JSON string containing `crv`, `kty`, `x`, `y` |
| Canonical encoding | Restricted deterministic JSON object encoded as UTF-8 |

All production keys and nonces are generated through WebCrypto CSPRNG operations. Room keys are independently random and are not derived from previous epochs or device identities.

Important implementation note: current version-3 device seals and standalone version-2 room-secret wraps call WebCrypto `deriveKey({name: "ECDH"}, ..., {name: "AES-GCM", length: 256})` directly, without an explicit HKDF step, even though their algorithm label is `ECDH-P256-HKDF-SHA256-AES-GCM-256`. Authenticated static-host room-secret delivery does use explicit HKDF. Reviewers should treat the label/construction mismatch and direct derivation as a known question, not assume HKDF is present everywhere.

## 5. Canonical authenticated records

The canonical encoder accepts a domain, positive safe-integer version, and scalar fields (`string`, safe-integer `number`, `boolean`, or `null`). It rejects malformed Unicode, reserved field names, non-scalars, and invalid names. It inserts `domain` and `version`, sorts all ASCII field names lexicographically, serializes each name/value with JSON scalar serialization, joins entries with commas, wraps them in braces, and UTF-8 encodes the result.

In notation:

```text
Canonical(domain, version, fields) = UTF8(
  "{" || join(",", sort_by_name(JSON(name) || ":" || JSON(value))) || "}"
)
```

Current canonical encoding version is `1`.

### 5.1 Domains and bound fields

| Domain | Bound fields |
| --- | --- |
| `multaiplayer:room-envelope:v2` | `id`, `teamId`, `roomId`, `senderDeviceId`, `senderUserId`, `createdAt`, `kind`, `keyEpoch` |
| `multaiplayer:local-json:v2` | `purpose`, `roomId`, `keyEpoch`, `savedAt` |
| `multaiplayer:attachment:v2` | `teamId`, `roomId`, `name`, `type`, `size` |
| `multaiplayer:device-sealed-json:v2` | device context below |
| `multaiplayer:room-secret-wrap:v2` | device context below |
| `multaiplayer:authenticated-room-secret-wrap:v2` | device context plus authorization constraints |
| `multaiplayer:invite-capability-mac` | invite binding below |
| `multaiplayer:invite-capability-verifier` | issuer-side at-rest verifier of the invite capability |

Device context fields are:

```text
purpose, teamId, roomId, senderUserId, senderDeviceId, recipientDeviceId,
operationId|null, requestId|null, requestNonce|null,
keyEpoch|null, previousEpoch|null, newEpoch|null
```

Epoch values, when present, are positive safe integers. Note that device context binds device and user identifiers, not public keys or fingerprints; the mapping from identifier to key relies on registration records plus the pinning and fingerprint checks described in sections 7 through 9.

## 6. Ordinary encrypted payloads

Writers emit:

```json
{
  "version": 3,
  "algorithm": "AES-GCM-256",
  "nonce": "standard-base64(12 random bytes)",
  "ciphertext": "standard-base64(AES-GCM output including tag)"
}
```

The AES-GCM key is the 32-byte room secret. Additional data is the canonical record for the envelope, local record, or attachment. Decryption accepts versions 2 and 3; version 2 uses a frozen legacy `JSON.stringify` additional-data representation, while version 3 uses the canonical encoder. Writers never emit version 2.

The relay enforces a persisted per-room-epoch envelope budget to limit random-nonce collision risk. Ordinary publishes stop at the ceiling, but an authenticated host rotation event remains allowed and atomically advances/resets the epoch counter.

## 7. Device identities and pinning

Each device generates a P-256 ECDH key pair. Public keys are normalized to JWK fields `kty=EC`, `crv=P-256`, `x`, and `y`; private keys remain endpoint-local. Public-key equality compares normalized `x` and `y` after schema validation, rather than serialized object order.

The displayed fingerprint preimage is exactly:

```text
{"crv":"P-256","kty":"EC","x":"<base64url-x>","y":"<base64url-y>"}
```

The display value is the SHA-256 digest formatted as colon-separated four-hex-character groups with prefix `sha256:`.

Native clients store serialized identity material in the OS credential store, retrieve it once during startup, and import the private JWK into a non-extractable WebCrypto handle. This is accidental-export reduction, not protection against a compromised endpoint.

### 7.1 Device seals are confidentiality-only

Device-sealed payloads use an ephemeral sender key pair and the recipient's static public key. Because the sender key is ephemeral and unauthenticated, any party that knows a recipient's public key (host public keys appear in every invite link, and registered device keys are relay-visible records) can construct a device seal that decrypts correctly with valid additional data. Seals therefore provide confidentiality and context binding, not sender authentication.

Authenticity is supplied elsewhere: invite requests carry the capability HMAC and arrive over an authenticated relay account; invite responses matter only insofar as they carry the room key, which is delivered exclusively through the authenticated static-host wrap of section 9, verified against the pinned host key. Reviewers are asked to confirm that no protocol decision relies on seal-layer sender authenticity.

## 8. Invite protocol

### 8.1 Link creation

The host creates:

- relay-visible invite metadata and a random invite id;
- an independent random 32-byte invite capability, encoded as canonical unpadded base64url (43 characters);
- a URL fragment carrying room/team/invite metadata, current epoch, the capability, and the exact host user id, device id, public JWK, and full fingerprint.

The fragment contains no room key. The issuer persists only a domain-separated SHA-256 verifier of the capability (domain `multaiplayer:invite-capability-verifier`); the capability itself should remain confidential.

### 8.2 Request MAC

The capability is the HMAC-SHA-256 key. Request records bind:

```text
phase="request", inviteId, teamId, roomId, keyEpoch,
requestId, requestNonce,
requesterUserId, requesterDeviceId, requesterPublicKeyFingerprint,
hostUserId, hostDeviceId, hostPublicKeyFingerprint
```

The input is `Canonical("multaiplayer:invite-capability-mac", 1, fields)` and the MAC is canonical unpadded base64url.

The request, including capability evidence and requester public key, is sealed to the pinned host device. The host checks the authenticated outer relay identity, expected invite state, capability verifier/MAC, recomputed requester and host fingerprints, current epoch, and exact public-key bindings before presenting approval.

### 8.3 Response and room-key delivery

Response MAC fields include all request fields plus:

```text
phase="response", status in {approved, denied}, decidedAt
```

For approval, the host wraps the current room secret with the authenticated static-host construction described next. The response is device-sealed to the requester. Request and response phase separation prevents direct cross-phase MAC replay.

Legacy links that directly contain a room key are scrubbed and rejected.

## 9. Authenticated static-host room-secret wrap

This construction is used for invite approval and room-key rotation.

Inputs:

- sender: the active host's static P-256 private key (recipients verify the embedded sender key against their pinned host public key);
- recipient: exact registered recipient P-256 public key;
- context: canonical authenticated device context;
- plaintext: JSON room-secret record `{algorithm:"AES-GCM-256", rawKey:<base64-32-bytes>}`.

Derivation:

```text
Z     = P-256-ECDH(sender_private, recipient_public)  // 256 derived bits
salt  = SHA-256(canonical_authenticated_context)
PRK/OKM via HKDF-SHA-256(Z, salt, info="multaiplayer:authenticated-room-secret-wrap:v2")
Kwrap = 256-bit AES-GCM key produced by WebCrypto HKDF deriveKey
```

Encryption uses AES-256-GCM with a random 96-bit nonce and the same canonical context as additional data. The output is:

```json
{
  "version": 3,
  "algorithm": "ECDH-P256-HKDF-SHA256-AES-GCM-256",
  "senderPublicKeyJwk": {"kty":"EC","crv":"P-256","x":"...","y":"..."},
  "nonce": "standard-base64(...)",
  "ciphertext": "standard-base64(...)"
}
```

The recipient rejects every version other than 3, rejects a different algorithm label, structurally compares the embedded sender public key to the pinned host public key, reconstructs the same context, derives the wrapping key, decrypts, and validates that the plaintext is exactly a 256-bit AES room secret. Recipient-key binding is implicit: only the holder of the registered recipient private key can derive the wrapping key.

Authorization constraints:

- `purpose=invite-response` requires non-empty `requestId`, `requestNonce`, and positive `keyEpoch`.
- `purpose=room-key-rotation` requires non-empty `operationId`, `newEpoch=previousEpoch+1`, and `keyEpoch=previousEpoch`.
- other purposes are rejected.

Authenticated room-secret wraps have no legacy receive exception. Version 2 is rejected because the protocol lacks a cryptographically trusted room-generation marker that could safely scope downgrade compatibility.

## 10. Member removal and rotation

The intended removal sequence is:

1. Relay authorization removes membership, closes the removed user's live room/team/workspace sockets, blocks future backlog/blob reads, and revokes outstanding invites.
2. The host enumerates the current eligible registered device set.
3. The host creates a fresh independent random 256-bit AES room key for `newEpoch=previousEpoch+1`.
4. Before publish, the host persists a pending rotation containing the operation identity, exact recipient set, and fresh key material.
5. The host creates one authenticated static-host wrap per eligible device; removed devices receive no wrap.
6. The rotation payload travels inside an envelope encrypted under the previous epoch, allowing current members to authenticate the transition while recipient-specific ECDH protects the new secret.
7. Recipients verify host identity, operation/room/epoch context, exact transition, and their device-specific wrap before installing the new epoch key.
8. Retry may reuse the persisted pending rotation only if the eligible recipient set is unchanged. Membership/exclusion changes discard it and generate fresh material.

Security goal: excluded devices cannot derive or obtain future epoch keys through the relay. Non-goal: deleting any old key, ciphertext, plaintext, export, screenshot, or observed content already held by the removed member.

## 11. Host handoff

Host handoff transfers future administrative authority, not past secrecy. The incoming host must re-verify membership, registered device keys, local project context, credentials, and pending actions. The incoming host then establishes a fresh epoch under its own pinned host identity. The outgoing host remains capable of retaining everything it previously observed.

Review question: is the handoff transcript/binding sufficient to prevent a relay or stale host from substituting the incoming authority between acceptance and the fresh-epoch transition?

## 12. Legacy compatibility surface

Decrypt-only compatibility exists for:

- version-2 ordinary room/local/attachment AES-GCM payloads using frozen JSON additional data;
- unversioned legacy device-sealed payloads;
- version-1 standalone ephemeral room-secret wraps (the standalone unwrap path accepts versions 1 and 2).

Current production code paths do not write these forms. One caveat for reviewers grepping the code: the version-2 standalone wrap writer (`wrapRoomSecretForDevice`) still exists and is exported, but it has no production call sites; room-key delivery goes exclusively through the authenticated version-3 construction. Unknown versions and algorithm identifiers fail closed.

Reviewers are asked to examine whether any legacy discriminator can be stripped, added, or confused to select an unintended additional-data path.

## 13. Relay-visible information

The relay sees identifiers and routing metadata: team/room ids and names, sender user/device ids, envelope ids/kinds/timestamps/epochs, ciphertext sizes, invite metadata, membership/device public records, and encrypted blob metadata. It should not receive plaintext chat, attachment contents, Codex input/output, terminal output, file contents/diffs, browser contents, room keys, private device keys, or the invite capability key in plaintext.

The relay remains authoritative for access control and availability. A malicious relay can deny service, replay retained ciphertext within application limits, lie about metadata, or withhold membership updates; cryptographic context binding and idempotency are intended to make substitution/replay detectable rather than make the relay available or honest.

## 14. Verification evidence

Current repository evidence includes:

- canonical byte and key-wrapping vectors with an independent Python verifier;
- unit tests for wrong keys, tampering, context substitution, version/algorithm rejection, legacy routing, and fixed fingerprints/MACs;
- property tests for canonical records, codecs, key material, and authorization bindings;
- a 100% policy score on governed crypto mutation regions;
- a real relay-process two-client create/invite/rotate/remove lifecycle test that scans persisted/transmitted material for plaintext markers;
- protocol/relay parser fuzz/property suites with deterministic seeds;
- repository hygiene gates pinning mutation policy, vectors, dependencies, and CI wiring.

These tests are implementation evidence, not a cryptographic proof or audit.

## 15. Where to look in the repository

To save reviewers time, the constructions above live in a small number of files:

| Topic | Location |
| --- | --- |
| Canonical encoder | `packages/crypto/src/canonical.ts` |
| AAD construction, device context, authorization constraints | `packages/crypto/src/additional-data.ts` |
| Key generation, HKDF and direct derivation, fingerprints, key equality | `packages/crypto/src/key-material.ts` |
| Device seals, standalone wraps, authenticated wraps | `packages/crypto/src/device-wrapping.ts` |
| Invite capability MAC | `packages/crypto/src/inviteCapability.ts` |
| Capability at-rest verifier | `apps/desktop/src/lib/inviteCapabilityStore.ts` |
| Invite request/response flow | `apps/desktop/src/lib/invite/inviteRelayActions.ts` |
| Rotation receive path | `apps/desktop/src/hooks/relay/routeRoomEnvelope.ts` |
| Relay epoch envelope budget | `apps/relay/src/` (`roomEpochEnvelopeLimit`) |
| Test vectors and independent verifier | `packages/crypto/test-vectors/`, `scripts/verify-crypto-vectors.py` |
| Threat model and protocol prose | `docs/threat-model.md`, `docs/protocol.md`, `docs/cryptography.md` |

## 16. Known concerns and requested scrutiny

1. **Direct ECDH key derivation in device seals/legacy wraps.** The code uses WebCrypto ECDH `deriveKey` directly to AES-GCM, without explicit HKDF, while the algorithm label names HKDF. Authenticated room-secret delivery is separate and does use HKDF. Should all current device seals migrate to explicit HKDF with a new wire version immediately?
2. **Seal-layer sender authenticity.** Device seals are confidentiality-only (section 7.1). Is the surrounding authenticity story (capability MAC, relay account auth, pinned-host authenticated wrap) sufficient, or does any flow implicitly assume authenticated seals?
3. **Single-host compromise.** A malicious active host controls membership and future rotations. Is this sufficiently prominent, and are there useful safeguards short of MLS?
4. **Invite capability delivery.** The capability is a bearer secret in a URL fragment. What practical channels and expiry/revocation requirements should be mandatory?
5. **Canonical JSON subset.** Are scalar-only sorted JSON records sufficiently unambiguous across JS/Python/Rust implementations, particularly Unicode and integer handling?
6. **Nonce budgeting.** Is a relay-enforced per-epoch count meaningful if a malicious endpoint can choose/reuse nonces, and should clients additionally maintain nonce state?
7. **Device-key authentication.** Host/requester fingerprints are link-pinned and may be compared out of band, but there is no PKI, and the wrap context binds identifiers rather than fingerprints. Does the invitation ceremony adequately communicate this trust-on-first-link model?
8. **Crash/retry state.** Does persisting a pending rotation before publish introduce key-retention or rollback risks beyond those already stated?
9. **Legacy parsing.** Can any malformed payload route into legacy AAD unexpectedly?
10. **Metadata integrity.** Which relay metadata should be cryptographically committed but currently is not?
11. **MLS migration threshold.** Are the current tripwires (multiple administrators, more than 32 devices, or stronger forward/post-compromise claims) too late?

## 17. Thanks

Whether you read one section or all of it, thank you. Findings, partial reviews, pointed questions, and "this framing is wrong" comments are all welcome. Please reference the pinned commit in any feedback, and use `SECURITY.md` for anything you consider seriously exploitable. Credit will gladly be given in the repository for any findings, at whatever level of attribution you prefer.
