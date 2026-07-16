# Active-host authorization

Status: accepted

Date: 2026-07-10

## Context

A room can coordinate work across several people, but Codex, project files, terminals, browser sessions, Git, GitHub, secrets, and local credentials belong to one participant's machine and accounts. Room membership is therefore not sufficient authority to spend a Codex subscription or mutate host-local resources.

## Decision

Each room has at most one active host. Any admitted room member may propose collaborative work, including a Codex turn, file save, terminal command, or browser request. Only the current active host may authorize execution that uses the host's machine, local Codex app-server session, credentials, or signed-in state.

Authorization is checked at execution or decision time against the room's stable `hostUserId` and active host status. Display names are retained only for legacy compatibility and presentation. A proposal does not capture permanent authority: if hosting changes while it waits, the replacement host decides it. Server-initiated Codex requests are additionally bound to the originating native session and room, and responses are returned only to that session.

Host-controlled room settings express shared intent, but they do not delegate the host's authority. Unknown request types, malformed identities, locked rooms, missing hosts, expired requests, and capability/version mismatches fail closed.

## Consequences

- UI affordances are not the security boundary; action helpers and native/relay routing must repeat the host and room checks.
- Encrypted room events may make proposals and outcomes visible without granting execution rights.
- Host handoff transfers future decision authority and continuity, not credentials or an already-approved blanket capability.
- Room settings cannot authorize another member to answer for the host.
- Direct room membership remains powerful because members can request host actions; product copy and threat modeling must state that clearly.

## Revisit when

A multi-host or delegated-execution model requires a new capability protocol with explicit scope, expiry, revocation, auditability, and native enforcement. Do not infer delegation from team roles, room membership, or relay metadata.
