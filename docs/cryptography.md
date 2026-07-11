# Cryptography architecture

multAIplayer uses epoch-scoped symmetric room keys and authenticated per-device delivery. The active host is the sole rotation authority. For every new epoch it generates an independent 256-bit AES-GCM key with the platform CSPRNG, persists the complete pending rotation before publishing it, and wraps the same key separately to each eligible pinned device. Retrying a rotation reuses that persisted pending record. Epoch keys are never derived from an earlier room key or a device identity key, so compromise of either does not determine later epoch material.

Authenticated room-secret deliveries use only the version 3 canonical additional-data encoding. Version 2 authenticated wraps are rejected. The alpha protocol did not record a cryptographically trustworthy room-creation generation that could safely distinguish a migration case from an attacker-selected downgrade, so there is no receive-side legacy exception. Ordinary versioned ciphertext compatibility is separate from key-delivery authentication.

## Device private keys

The native desktop stores the serialized P-256 device identity under the fixed `device-identity:v1` account in the operating-system credential store, using the `com.multaiplayer.desktop.room-secrets` service namespace. A native process permits the startup identity command to retrieve that record only once; reset and later webview calls do not reopen retrieval. On load, the serialized private JWK exists transiently while crossing that Tauri command boundary and is immediately imported into a non-extractable Web Crypto `CryptoKey`; normal cryptographic operations receive that handle rather than the JWK. A webview compromised before or during the single startup retrieval remains inside the trust boundary. JavaScript memory is not a hardware security boundary, and this design does not claim Secure Enclave or hardware-backed key isolation.

The web preview has no OS credential-store bridge. It imports its runtime key as a non-extractable handle, but retains serialized identity material in localStorage so the development identity survives reloads. It is not covered by the native key-at-rest claim.

## Why this is not MLS

The current product has a single active host that serializes room administration and distributes epoch keys to a small set of registered devices. Messaging Layer Security (MLS) is designed for decentralized group membership and efficient group key agreement, with a substantially larger state machine: proposals, commits, tree synchronization, credential validation, recovery from missed commits, and interoperability requirements. Adopting only fragments of MLS would not inherit its security properties.

For the current host-authority model, independent random epoch keys plus authenticated per-device wrapping are smaller and easier to audit. This is a scoped architecture choice, not a claim that the design provides MLS guarantees. In particular, it does not provide a per-message ratchet, post-compromise security while a compromised host remains authoritative, decentralized membership commits, or MLS interoperability. If multAIplayer moves to decentralized administration, large dynamic groups, or those guarantees become release requirements, the protocol should adopt a maintained, independently reviewed MLS implementation rather than extending this custom scheme to imitate MLS.
