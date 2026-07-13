# MLS protocol v2

Status: accepted

Date: 2026-07-12

## Context

multAIplayer's original room protocol used independently random epoch keys, custom per-device room-key delivery, and custom encrypted room envelopes. That design deliberately stopped short of Messaging Layer Security (MLS), and its migration boundary required a maintained MLS implementation once the product needed per-message forward secrecy or post-compromise security.

Protocol v2 crosses that boundary. There are no production rooms that justify a compatibility layer, so retaining legacy readers, key migration, or dual writers would add cryptographic and state-machine risk without preserving user data that the project promises to support. Protocol v2 may make existing alpha rooms and invite links unreadable.

MLS does not by itself express all of multAIplayer's product policy. In particular, MLS permits members to produce commits, while multAIplayer has exactly one active host with authority to change membership and group context. The relay remains a delivery service that is trusted for ordering and availability, not for confidentiality.

## Decision

### MLS implementation

Use **mls-rs**, maintained by AWS, as the RFC 9420 implementation in the native Rust/Tauri boundary.

The deciding factors are its provider-oriented Rust API, an existing SQLite provider with a SQLCipher feature, pre-apply custom MLS rules suitable for host-only commit enforcement, and a stable AWS-LC provider that implements the pinned P-256 suite. These fit the app's transactional send-after-persist and authenticated GroupContext policies without recreating the MLS state machine around the library.

The decision explicitly weighs the following upstream properties as of 2026-07-12:

- [`mls-rs`](https://github.com/awslabs/mls-rs) documents full RFC 9420 conformance, configurable storage traits with SQLite implementations, custom proposal/extension and rule support, WASM builds, and stable AWS-LC support for suite `0x0002`. Its repository has a comparatively frequent tag history. Its own security notice says it has **not** received a full third-party security audit.
- [OpenMLS](https://github.com/openmls/openmls) supports the pinned suite, pluggable crypto, SQLite storage, and a WASM/JavaScript build. It is actively maintained by Phoenix R&D and Cryspen. OpenMLS also [completed an independent SRLabs audit in 2026](https://blog.openmls.tech/), with reported findings remediated in maintained releases; this is a material advantage.
- WASM does not decide the choice because protocol v2 deliberately makes MLS native-only. Both projects could support a future Rust-to-WASM build, but that would require a separate key-boundary decision.

OpenMLS's audit advantage is real. `mls-rs` is selected despite it because the existing SQLCipher provider and native rule hook let this implementation enforce its two non-negotiable integration invariants—atomic MLS-state/outbox persistence and rejection of non-host commits before application—with less application-owned protocol machinery. The resulting application integration, and the chosen library itself, remain explicitly unaudited; conformance is not treated as a security audit.

OpenMLS remains a credible implementation, but protocol v2 does not abstract over two MLS libraries. A library-neutral wrapper would either expose the least common denominator or recreate MLS state-machine behavior in application code. Changing implementations is therefore a future protocol and storage migration that requires a new ADR.

### Ciphersuite

Support exactly ciphersuite `0x0002`, `MLS_128_DHKEMP256_AES128GCM_SHA256_P256`.

This keeps the protocol on the P-256 curve family while device credentials are regenerated as MLS signature identities. Writers emit only this suite. KeyPackages, Welcome messages, group state, and incoming MLS messages that select or require another suite fail closed. There is no runtime suite negotiation, fallback, or downgrade path. A suite change requires a clean protocol migration, updated tests, and a new security decision.

### History retention

On every epoch transition, derive a per-epoch history secret with the MLS exporter using the label `multaiplayer history v1` and store it in the device's encrypted local MLS store. Local history and retained relay backlog for that epoch remain readable to that device after the live MLS epoch secret is deleted.

This is a deliberate product-policy tradeoff. MLS provides forward secrecy for live traffic, but multAIplayer retains exporter-derived history secrets so it does not claim forward secrecy for retained local history. New members receive no pre-join history. A device that loses MLS state and rejoins can participate in future epochs but cannot reconstruct its old exporter-derived history secrets from the relay or another ordinary member.

History secrets, exporter output, epoch secrets, signature private keys, and group state never cross the Rust IPC boundary. They are stored only in the encrypted local provider, whose wrapping key is held by the operating-system credential store.

### Browser preview

Full MLS rooms are native-only. The browser/web preview is demoted to local seeded demo rooms and does not create, join, decrypt, or participate in end-to-end encrypted relay rooms.

The project will not ship a second MLS implementation in TypeScript or put production MLS keys in browser WASM linear memory. If a future browser product needs MLS, it must reuse the Rust core and receive a separate threat-model review of its weaker key-handling boundary before that capability is enabled.

### Authority and residual cryptography

The active host is the only member authorized to commit. Clients reject commits not signed by the leaf designated as active host, and the relay independently rejects non-host commits while serializing one commit per room epoch. The authenticated host designation is protocol-visible group state rather than UI-only metadata. Relay enforcement is defense in depth; clients do not trust it as the security authority.

Device-directed invite requests remain pairwise rather than group messages. They use standard single-shot HPKE under RFC 9180 with operation, identity, room, and epoch context bound as `info` and authenticated additional data. Capability authentication, host approval, fingerprint verification, attachment policy, and host-local execution approval remain application policy. Custom room-secret wrapping, rotation envelopes, nonce budgets, and room-envelope cryptography are deleted rather than adapted.

## Consequences

- Pre-v2 rooms and invite links are unsupported and unreadable; there is no legacy crypto migration or compatibility reader.
- All MLS state and cryptographic operations live in Rust. Webview IPC accepts bounded intents and returns ciphertext, public state, or opaque handles, never raw secrets.
- The encrypted MLS store is continuity-critical. State mutations must commit transactionally before their resulting messages are sent; corrupt or lost state requires an explicit clean rejoin.
- The relay may store public KeyPackages and opaque MLS messages, but never MLS private keys, group secrets, exporter output, history secrets, or plaintext room content.
- Forward secrecy and post-compromise security claims apply to live MLS traffic subject to host-authority policy. Retained exporter-derived history is intentionally readable on the device that stored its history secrets.
- A subsequent honest commit after authority leaves a compromised host can heal future group traffic. It cannot erase content, credentials, exporter-derived history, or keys already observed by the compromised device.

## Revisit when

Revisit this decision before adding browser MLS participation, a second ciphersuite, automatic or multi-host commit authority, cross-device history recovery, history sharing with new members, or a different MLS implementation. Each changes a security boundary or protocol invariant and requires an explicit migration and threat-model update.
