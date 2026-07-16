# Host handoff and key authority

Status: accepted

Date: 2026-07-11

## Context

multAIplayer has one active host that authorizes host-local work and, under protocol v2, is the only member allowed by application policy to publish MLS commits. That makes the host both an execution authority and a continuity bottleneck. A handoff cannot make a formerly trusted host forget room plaintext, credentials it used, or keys it already received. It is a change in authority for future work, not retroactive revocation.

The outgoing host may be malicious, compromised, or simply unavailable. It can retain room plaintext, ciphertext, attachments, exports, screenshots, terminal and browser content, retained history secrets, its device identity, pending requests, and any host-local credentials or repository data it legitimately accessed. Native key isolation and local deletion improve hygiene but cannot prove erasure.

## Decision

A host handoff is complete only after the incoming member publishes an authenticated request naming its exact user, device, and MLS leaf; the outgoing host explicitly approves it; an MLS commit authenticates the mandatory GroupContext extension change to that leaf and the exact handoff offer id; the relay accepts the expected epoch from the old host and atomically records the new host device; and native clients apply the commit. A candidate cannot claim authority with a direct relay metadata mutation.

The commit is the completion record. The offer id is carried in the authenticated native host context and the outgoing device's signed relay authorization, so a reconnecting client can correlate the committed transfer without a second message from the outgoing process. The encrypted `room.host.accepted` event is informational and may improve the live UI, but correctness and recovery never depend on its delivery. This avoids a crash window after relay commit persistence. Concurrent requests converge on a deterministic candidate binding until one is committed; the committed native binding always wins.

The incoming host must re-verify, rather than inherit on trust:

- the room and team identifiers, relay origin, membership, and exact eligible device roster;
- its own user id, device id, MLS leaf, signature key, HPKE key, and full fingerprints, plus the authenticated group roster;
- the canonical project directory/repository binding and any local branch or checkout used for Codex;
- its own Codex login, model/app-server compatibility, MCP/app connections, Git/GitHub identity, private browser sessions, credentials, and approval defaults;
- every pending Codex turn, terminal/browser/file request, and native approval under the new host's current context and policy.

Old approvals, repeat-command grants, native session bindings, pending invite approvals, browser sessions, terminal sessions, and claimed credential state do not transfer. Pending proposals may remain visible for continuity, but they are untrusted input and require a new decision by the incoming host. The incoming host must not execute an outgoing host's serialized local state as authority. In particular, a transferred Git patch is staged and shown to the incoming host; applying it is a separate explicit action after authority changes.

The authority-transfer commit advances the MLS epoch using the RFC 9420 key schedule. The authenticated GroupContext extension names the new host leaf and device, and every client rejects a commit whose author was not the host designated for its parent epoch. The relay independently rejects stale epochs and commits from the wrong authenticated device. After acknowledgement, the old host cannot publish further commits; the new host's next honest commit can provide post-compromise recovery for future live traffic, provided the attacker no longer retains authorized membership or current endpoint access.

Room authority remains `active` while offers and candidate requests are pending. Offer state is separate from authority state, and persisted room status has no handoff value. A successful transfer atomically replaces the active host binding while leaving the room `active`.

## Verification

Focused unit tests exercise the production record transitions, deterministic candidate selection, and exact correlation between an authenticated native transfer and its offer. Separate native state-machine and end-to-end tests exercise the native transfer, relay authority, application wiring, and reconnect boundaries.

Room history from earlier epochs remains readable only to devices that already retained the corresponding exporter-derived history secrets. Handoff does not re-encrypt history and cannot revoke copies already delivered. If the outgoing host's retained credentials, repository access, or other external capabilities are no longer appropriate, their owners must revoke or rotate them in the relevant external systems; an MLS commit cannot do that.

## Consequences

- The outgoing host can always retain everything it legitimately observed before handoff and can attempt to lie about local state. The design promises exclusion from future authority, not deletion.
- The incoming host becomes the application-policy authority. Compromise of that host compromises approvals and commits it controls, although MLS can heal future traffic after a later honest update and removal of attacker access.
- Availability depends on a valid incoming MLS leaf and an outgoing-host-authorized commit. A lost sole host requires a clean recovery/rejoin flow; silently electing a host from room membership is forbidden.
- Continuity is intentionally narrower than state transfer: shared encrypted history and proposals can continue, but host-local credentials, sessions, approvals, and execution capabilities start fresh.
- Audit and UI surfaces should identify both outgoing and incoming host bindings, the request and approval, the resulting host leaf, and the epoch without exposing secret key material.

## Revisit when

Revisit this decision before adding automatic host election, multi-host execution, delegated capabilities, recovery without the prior host, or decentralized membership administration. Those designs require an explicit protocol for quorum, conflict resolution, recovery credentials, expiry, revocation, and auditable commits; they must not be inferred from room membership or relay presence.
