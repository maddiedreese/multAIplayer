# Epoch crypto and the MLS migration boundary

Status: superseded by [MLS protocol v2](mls-protocol-v2.md)

Superseded: 2026-07-12

## Decision

This record describes the removed protocol v1 boundary and remains only as historical rationale. Protocol v2 crossed the MLS-adoption tripwire and locked its implementation, ciphersuite, history-retention, and native-runtime decisions in the [MLS protocol v2 ADR](mls-protocol-v2.md). The former TypeScript crypto package, compatibility readers, public vectors, and custom epoch-key machinery were deleted rather than deprecated.

The following are mandatory architecture re-evaluation tripwires:

- the product supports more than one simultaneous room-administration authority;
- a supported room may contain more than **32 registered devices**; or
- forward secrecy within an epoch, per-message forward secrecy, or post-compromise security becomes a product or release claim.

Thirty-two devices is the concrete alpha boundary because the current host performs linear per-device key delivery and the relay/store are explicitly designed for small trusted teams. It is a protocol limit and review trigger, not evidence that 32-device rooms have been load- or security-audited.

Protocol v2 crossed these tripwires. The project evaluated OpenMLS and `mls-rs`, selected `mls-rs` for its native storage and rule integration, and records the audit tradeoff explicitly in the successor ADR. No v1 compatibility or custom MLS-like state machine remains in the runtime.

## Consequences

- This ADR must not be used as current implementation guidance.
- Future protocol work follows the MLS v2 ADR and current cryptography documentation.
- The v1 design remains available in Git history for audit context, without retaining dead cryptographic code.
