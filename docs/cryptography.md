# Cryptography architecture

This cryptography is custom and unaudited. It has not received an independent professional security audit. References to end-to-end encryption describe the intended protocol boundary and properties exercised by tests; they are not verified guarantees. Public [canonical-encoding and key-wrapping vectors](../packages/crypto/test-vectors/v1.json) let independent reviewers check exact bytes and interoperability without reading the desktop application; the [crypto package review guide](../packages/crypto/README.md) specifies the construction and verification command.

multAIplayer uses epoch-scoped symmetric room keys and authenticated per-device delivery. The active host is the sole rotation authority. For every new epoch it generates an independent 256-bit AES-GCM key with the platform CSPRNG, persists the complete pending rotation before publishing it, and wraps the same key separately to each eligible pinned device. Retrying a rotation reuses that persisted pending record. Epoch keys are never derived from an earlier room key or a device identity key, so compromise of either does not determine later epoch material.

Authenticated room-secret deliveries use only the version 3 canonical additional-data encoding. Version 2 authenticated wraps are rejected. The alpha protocol did not record a cryptographically trustworthy room-creation generation that could safely distinguish a migration case from an attacker-selected downgrade, so there is no receive-side legacy exception. Ordinary versioned ciphertext compatibility is separate from key-delivery authentication.

## Additional-data wire records

Version 3 writers authenticate deterministic canonical records using canonical encoding version 1. Device-context records use either `multaiplayer:device-sealed-json:v2` or `multaiplayer:room-secret-wrap:v2` and bind `purpose`, `teamId`, `roomId`, `senderUserId`, `senderDeviceId`, `recipientDeviceId`, `operationId`, `requestId`, `requestNonce`, `keyEpoch`, `previousEpoch`, and `newEpoch`; absent optional fields are encoded as `null`. Authenticated static-host room-secret delivery uses the separate `multaiplayer:authenticated-room-secret-wrap:v2` domain with the same fields and additional authorization constraints described by the protocol.

Ordinary room envelopes use `multaiplayer:room-envelope:v2` and bind `id`, `teamId`, `roomId`, `senderDeviceId`, `senderUserId`, `createdAt`, `kind`, and `keyEpoch`. Encrypted local records use `multaiplayer:local-json:v2` and bind `purpose`, `roomId`, `keyEpoch`, and `savedAt`. Attachment records use `multaiplayer:attachment:v2` and bind `teamId`, `roomId`, `name`, `type`, and `size`. These domains, field sets, and canonical encoding version are part of the wire protocol; changing any of them changes the authentication result.

Frozen JSON AAD encodings exist only on compatible read paths: version 2 ordinary, local, and attachment ciphertext; unversioned legacy device-sealed payloads; and version 1 standalone ephemeral room-secret wraps. Current writers never emit those encodings. Authenticated static-host room-secret deliveries have no legacy read path and reject every version other than 3.

## Invite capability authentication

An invite capability is exactly 32 bytes from the platform CSPRNG, encoded as canonical unpadded base64url (43 characters). The capability is the HMAC-SHA-256 key; it is independent of room and device keys. Verification rejects malformed capabilities and MACs and returns false on parsing or Web Crypto errors.

The MAC input is canonical encoding version 1 under `multaiplayer:invite-capability-mac`. Both request and response records bind `phase`, `inviteId`, `teamId`, `roomId`, `keyEpoch`, `requestId`, `requestNonce`, `requesterUserId`, `requesterDeviceId`, `requesterPublicKeyFingerprint`, `hostUserId`, `hostDeviceId`, and `hostPublicKeyFingerprint`. Response records additionally bind `status` and `decidedAt`. Phase separation prevents a valid request MAC from being reused as a response MAC.

Authenticated static-host room-secret wrapping accepts only `invite-response` and `room-key-rotation` contexts. An invite response requires a non-empty request id and nonce plus a positive key epoch. A rotation requires a non-empty operation id and the exact transition `newEpoch = previousEpoch + 1` with `keyEpoch = previousEpoch`. Other purposes and incomplete or inconsistent transitions are rejected. On unwrap, the normalized P-256 sender key's `kty`, `crv`, `x`, and `y` must equal the pinned host key and the payload version must be 3.

## Device private keys

The native desktop stores the serialized P-256 device identity under the fixed `device-identity:v1` account in the operating-system credential store, using the `com.multaiplayer.desktop.room-secrets` service namespace. A native process permits the startup identity command to retrieve that record only once; reset and later webview calls do not reopen retrieval. On load, the serialized private JWK exists transiently while crossing that Tauri command boundary and is immediately imported into a non-extractable Web Crypto `CryptoKey`; normal cryptographic operations receive that handle rather than the JWK. A webview compromised before or during the single startup retrieval remains inside the trust boundary. JavaScript memory is not a hardware security boundary, and this design does not claim Secure Enclave or hardware-backed key isolation.

The web preview has no OS credential-store bridge. It imports its runtime key as a non-extractable handle, but retains serialized identity material in localStorage so the development identity survives reloads. It is not covered by the native key-at-rest claim.

## Why this is not MLS

The current product has a single active host that serializes room administration and distributes epoch keys to a small set of registered devices. Messaging Layer Security (MLS) is designed for decentralized group membership and efficient group key agreement, with a substantially larger state machine: proposals, commits, tree synchronization, credential validation, recovery from missed commits, and interoperability requirements. Adopting only fragments of MLS would not inherit its security properties.

For the current host-authority model, independent random epoch keys plus authenticated per-device wrapping are smaller and easier to audit. This is a scoped architecture choice, not a claim that the design provides MLS guarantees. In particular, it does not provide a per-message ratchet, post-compromise security while a compromised host remains authoritative, decentralized membership commits, or MLS interoperability.

The [epoch crypto ADR](decisions/epoch-crypto-migration-boundary.md) makes re-evaluation mandatory if the product supports multiple simultaneous administration authorities, rooms beyond 32 registered devices, or any product claim of forward secrecy within an epoch, per-message forward secrecy, or post-compromise security. If a tripwire fires and those properties require MLS, adopt a maintained implementation wholesale (OpenMLS is the preferred Rust/Tauri candidate). Never extend the custom scheme with MLS-like pieces.

## Review surface

Keep `packages/crypto` small, dependency-light, and isolated from UI, relay transport, and product policy. This boundary is the future migration path to a maintained group-messaging implementation. Treat changes to canonical authenticated encoding, key derivation, wrapping, envelope additional data, or key lifecycle as protocol-level events: they require focused crypto-package tests, updated public vectors when bytes change, a protocol compatibility decision, and a dated [threat-model changelog](threat-model-changelog.md) entry. Avoid convenience dependencies in this package when the equivalent code can remain short and directly reviewable.

The committed vector file is normative only for the exact encoded bytes and deterministic test inputs it contains. Random production keys and nonces must still come from the platform CSPRNG. A vector match demonstrates interoperability with that fixture; it does not audit the construction or establish real-world security. Run `npm test -w @multaiplayer/crypto` to verify the committed vectors and related properties.
