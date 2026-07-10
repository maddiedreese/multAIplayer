# Multi-repository room evaluation

Status: accepted for the current alpha

Date: 2026-07-09

## Decision

Keep one primary repository binding per room for now. Do not present multi-repository rooms as shipped app-server functionality until Codex exposes a stable local multi-root execution contract.

Codex app-server 0.144 accepts one `cwd` on `thread/start`, `thread/resume`, and `turn/start`. Its generated schema contains capability-root definitions for environment-backed capabilities, but those definitions are not an additional-local-workspace field on the thread or turn request. Passing extra absolute paths in prompt text would not create an enforceable filesystem boundary and is not an acceptable substitute.

This is a deliberate compatibility and security decision, not a permanent product limitation.

## Required future model

When app-server exposes stable multi-root execution, rooms should use two layers:

- A shared logical `ProjectRootDescriptor` with a stable root id, label, optional remote identity, and one primary root.
- A host-local binding from `(roomId, rootId)` to an absolute directory.

Room events, approvals, files, terminals, Git operations, activity items, and handoffs should carry the stable root id plus a relative path. They should not publish a host's absolute paths as shared relay metadata. Native commands must resolve and canonicalize every path against the selected binding and reject traversal, symlink escapes, cross-room bindings, and cross-root confusion.

Existing rooms can migrate by synthesizing a `legacy-primary` descriptor and binding it to the current `projectPath`.

## Enablement gate

Revisit implementation only when all of the following are true:

1. A contract-tested app-server version accepts declared additional local roots or an equivalent environment capability on thread and turn requests.
2. Sandbox and approval requests identify the affected root unambiguously.
3. Canonical activity items can be attributed to a root without parsing display text.
4. Host handoff can rebind every logical root without sharing machine-specific absolute paths.
5. Native security tests cover traversal, symlink escape, cross-room/root confusion, and Git/terminal execution for every root.

Until then, users can create separate rooms for separate repositories and use thread forks or agent trees within each room.
