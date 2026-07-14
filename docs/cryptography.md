# Cryptography architecture

multAIplayer protocol v2 uses RFC 9420 Messaging Layer Security through the Rust `mls-rs` implementation. MLS group state and every operation that handles a group secret, signature private key, exporter output, or retained history key run in the native Tauri process. The webview sends bounded intents and receives public state or ciphertext; it cannot request raw secret material. This integration has not received an independent professional security audit, so end-to-end encryption remains an intended property supported by automated tests rather than an independently verified guarantee.

## Ciphersuite and credentials

Protocol v2 pins exactly one suite: `MLS_128_DHKEMP256_AES128GCM_SHA256_P256` (`0x0002`). Decoders reject every other suite. There is no algorithm negotiation or downgrade path; changing the suite requires a new protocol decision and migration.

Each native installation owns an MLS P-256 signature key and a separate RFC 9180 HPKE P-256 key. Private keys are generated and used in Rust and persisted in the operating-system credential store under versioned accounts in the existing multAIplayer service namespace. An MLS BasicCredential canonically binds the GitHub user id and device id. The UI displays the complete SHA-256 fingerprint of the signature public key for out-of-band verification. The relay sees only signed KeyPackages, public credential and key material, and fingerprints.

## MLS group state and host authority

MLS provides the group key schedule, authenticated membership changes, sender authentication, epoch binding, and application-message protection. The native store uses SQLCipher with a wrapping key held in the operating-system credential store. A mutation persists the resulting MLS state and exact outbound outbox record in one transaction before any message is sent. Relay acknowledgement applies a pending local commit; a stale relay response discards the exact pending commit and allows the client to rebase. A corrupt database and its WAL/SHM sidecars are quarantined with a `.corrupt-<timestamp>` suffix and the UI requires a clean rejoin.

Host authority is application policy, not an MLS default. A mandatory authenticated GroupContext extension identifies the active host leaf and device. Native proposal and commit rules reject commits from any other leaf and reject malformed or mismatched transfers before MLS applies them. The relay independently requires the authenticated active host device and atomically accepts only one commit for an expected room epoch. The relay check protects availability; the native authenticated check is the security boundary.

Host handoff is an explicit authority transfer. The incoming device first publishes an authenticated request after completing the local trust checks in the [host-handoff ADR](decisions/host-handoff.md). The outgoing host approves and commits the GroupContext change. The relay changes routing authority atomically with that accepted commit. An attacker that controlled the old host can retain earlier material, but a later honest MLS commit can restore confidentiality for future live traffic once the attacker is no longer a member or authority.

## Application messages and attachments

Room events are MLS PrivateMessages. Canonical authenticated data binds the message id, team id, room id, sender user and device ids, creation time, event kind, and epoch. The receiver compares authenticated routing data with the decrypted event and the sender leaf's authenticated credential. The relay stores and forwards only opaque canonical-base64 MLSMessage bytes plus bounded public routing metadata.

Large attachments remain opaque relay blobs. The native core derives a per-blob key using the MLS exporter label `multaiplayer blob v1` and the client-generated blob id, then retains the exact per-blob key needed to read that blob after later epoch changes. Blob ids, room binding, and draft ownership are checked so a delayed upload cannot attach to another room. The relay rejects duplicate blob ids and never receives exporter output or plaintext.

## Invites and device-directed HPKE

Invite capabilities remain an authorization mechanism. A link carries a random single-use capability in its URL fragment, the pinned host identity, and bounded room metadata; it never carries an MLS group secret. The issuer persists only a domain-separated verifier. The joiner publishes a single-use KeyPackage and sends an invite request sealed to the pinned host's dedicated HPKE key.

The official HTTPS universal link is only a delivery envelope. The relay invite id is also fragment-carried, so the website request contains no invitation field. Apple associated-domain routing, the static install page, native one-shot intake, and React onboarding do not transform or authenticate MLS bytes and cannot grant membership. They fail into the same decoder and capability-bound request path described here. No custom scheme or browser-persisted handoff exists.

Pairwise invite requests use RFC 9180 HPKE with P-256, HKDF-SHA-256, and AES-128-GCM. Invite authenticator v3 encodes the binding independently of Serde and Rust field declaration order: a fixed versioned prefix, one-byte version and phase discriminant, big-endian epoch, eleven unsigned-32-bit-length-prefixed UTF-8 fields, and tagged optional status/decision fields. The same bytes are the HPKE AAD and the input to the request receipt hash. They bind purpose, host and requester identities/devices, room, epoch, expiry, request id/nonce, and the exact KeyPackage hash.

The raw 256-bit capability is reduced to the issuer's verifier with `SHA-256("multaiplayer:invite-capability-verifier:v3\0" || raw)`. Request and response HMAC-SHA-256 subkeys are then derived independently from that verifier with `multaiplayer:invite-capability-request-key:v3\0` and `multaiplayer:invite-capability-response-key:v3\0`; their MAC inputs additionally use distinct `...request-mac:v3\0` and `...response-mac:v3\0` labels. Phase-specific verification APIs reject the other phase before authenticating. This is deliberate belt-and-braces domain separation rather than relying on the encoded phase alone.

Native composite commands build and open these records so the webview cannot substitute a generic HPKE context or obtain the capability key. Request sealing first persists the capability, exact binding, KeyPackage id, and relay-visible sealed request in SQLCipher. Recovery IPC returns only routing fields and the already-public sealed request; native response acceptance reloads the capability and binding internally. Approval verifies and consumes the capability, validates the exact KeyPackage and credential, atomically persists the MLS Add commit and Welcome outbox records, then sends the commit. The Welcome is already encrypted to the intended KeyPackage init key and is delivered once to the exact requester. Pre-v3 invite links and pending responses are rejected rather than interpreted under the new labels.

## History retention and forward secrecy

MLS erases superseded epoch secrets as its key schedule advances. multAIplayer deliberately derives `exporter("multaiplayer history v1", ...)` once per epoch and retains that history secret in encrypted native storage for the device's configured retention period. Local room history is encrypted under the matching epoch history secret.

This creates a precise tradeoff: live MLS traffic gains forward secrecy and post-compromise recovery properties, while locally retained history does not gain forward secrecy against later compromise of that device's encrypted store and credential-store wrapping key. New members receive no pre-join history. A device that loses MLS state can rejoin, but cannot recover old backlog or local history secrets from the relay.

## Onboarding state is not cryptographic state

The resumable setup record is a local webview preference, not MLS state, a room-history payload, or a source of authority. It may retain bounded team and room identifiers plus boolean workflow markers, including a partial team id used to avoid duplicate creation. It does not retain an invite capability, KeyPackage private material, Welcome, project path, prompt, account credential, transcript, or room key.

GitHub Device Flow codes/URLs and Codex login ids/URLs/codes are likewise excluded. They exist only in their live auth controllers and are erased on completion, cancellation, expiry, or process exit. Joining a room does not cryptographically depend on local Codex availability or ChatGPT authorization; those are host-execution prerequisites, not membership inputs.

Choosing “Join with an invite” does not create membership locally. The normal HPKE request, active-host approval, MLS Add Commit, and Welcome lifecycle remains authoritative. Likewise, a local checklist marker cannot grant room or host access. Compromise of the onboarding record can reveal coarse setup progress and identifiers or confuse the local presentation, but it cannot decrypt room traffic; strict normalization discards unsupported and inconsistent records.

## Verification strategy

The native suite includes a shrinkable generated model of add, remove, host-handoff, and rejoin transitions. After every generated transition, it proves that every active non-host is rejected by the add, remove, and handoff Commit constructors and that removed or retired engine instances cannot decrypt the current epoch. Separate adversarial cases feed every truncated prefix of a valid Commit, deliver later Commits before their parents, and replay already-applied Commits; rejected inputs must not prevent the later valid ordered transition.

The invite HPKE suite is checked against the published RFC 9180 Appendix A.3 P-256/HKDF-SHA-256/AES-128-GCM encapsulation and ciphertext bytes, including decryption through the public native wrapper. This supplements context-binding and wrong-recipient tests; it does not make the application integration independently audited. The exact tests and parser-fuzz evidence are indexed in the [external review packet](external-review-packet.md).

## Protocol boundary and review

Protocol v2 intentionally has no compatibility reader for custom room envelopes, room-secret wraps, rotation messages, legacy invite key delivery, or localStorage room secrets. Pre-v2 rooms and pre-v3 invite authenticators are unreadable and invalid. Git history preserves the removed design; runtime compatibility code would only enlarge the attack surface.

The residual application-defined security surface is the host-authority policy and authenticated context extension, canonical routing and invite records, RFC 9180 device-directed sealing, SQLCipher/credential-store integration, and deliberate history-secret retention. Changes to those boundaries, the pinned suite, credential encoding, exporter labels, or send-after-persist ordering require focused tests, a compatibility decision, and a dated [threat-model changelog](threat-model-changelog.md) entry. The accepted rationale is recorded in the [MLS protocol v2 ADR](decisions/mls-protocol-v2.md).
