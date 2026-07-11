# Epoch crypto and the MLS migration boundary

Status: accepted

## Decision

multAIplayer's current protocol is deliberately limited to a single active administration authority and small rooms. Epoch keys are independently random, delivered separately to pinned devices, and rotated on bounded time/message policies. This provides coarse forward secrecy between epochs; it is not MLS and does not provide forward secrecy within an epoch.

`packages/crypto` is the protocol migration seam. Keep it small, dependency-light, and isolated from relay transport, desktop UI, and product policy. A change to its authenticated encodings, key derivation, wrapping, envelope additional data, or key lifecycle is a protocol-level event: it requires focused package tests, updated public vectors when bytes change, an explicit compatibility decision, and a dated threat-model changelog entry.

The following are mandatory architecture re-evaluation tripwires:

- the product supports more than one simultaneous room-administration authority;
- a supported room may contain more than **32 registered devices**; or
- forward secrecy within an epoch, per-message forward secrecy, or post-compromise security becomes a product or release claim.

Thirty-two devices is the concrete alpha boundary because the current host performs linear per-device key delivery and the relay/store are explicitly designed for small trusted teams. It is a protocol limit and review trigger, not evidence that 32-device rooms have been load- or security-audited.

If any tripwire fires, work on extensions to the custom construction stops until the architecture is re-evaluated. If the required properties call for MLS, adopt a maintained, independently reviewed MLS implementation wholesale. OpenMLS is the preferred candidate for the Rust/Tauri boundary. Do not add proposals, tree state, ratchets, multi-committer logic, or other MLS-like pieces to `packages/crypto`; partial imitation would add state-machine risk without inheriting MLS security or interoperability.

## Consequences

- Ordinary maintenance may improve the existing bounded epoch scheme without expanding its claims.
- Changes crossing the crypto boundary receive protocol review even when their diff is small.
- Product and capacity planning must count registered devices, not just human members.
- Crossing a tripwire creates migration work and may require a wire-format break; avoiding that work is not justification for extending the custom scheme.
