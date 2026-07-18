# multAIplayer CLI development plan

Status: Approved  
Plan version: 1.1
Owner: Maddie D. Reese  
Approved baseline: GitHub `main` at `156c55e51ab2db9d00c8eb418c4443a55ddb739e`  
Last material update: 2026-07-18

This document is the normative source of truth for multAIplayer CLI product
scope, architecture, security boundaries, sequencing, and completion criteria.
Implementation work may not change it implicitly.

## Product statement

The CLI provides the core multAIplayer experience in a terminal: multiple
GitHub-authenticated participants share an encrypted room, any participant can
propose work, and one active participant hosts and approves a local Codex
session on their machine and account.

The CLI is a second client of the existing product, not a fork, remote shell, or
desktop replacement. Desktop and CLI participants must interoperate in the same
rooms through the same relay protocol and MLS groups.

## First public-alpha scope

Required:

- GitHub device authentication and session restoration.
- Persistent device, signing, HPKE, and MLS identity.
- List, create, open, leave, and explicitly forget rooms.
- Associate a host-local project with a room without sharing its path.
- Generate, parse, revoke, expire, consume, approve, and deny secure invite codes.
- Encrypted multiplayer chat, presence, and active-host indication.
- `@codex` proposals from any current room member.
- Host preview and approval before invoking Codex.
- Host-local Codex app-server execution and compatibility checks.
- Shared assistant transcript and normalized activity.
- Host-local handling of supported Codex server requests.
- Ordered relay processing, reconnect, backlog replay, acknowledgements, and MLS
  outbox recovery.
- Atomic encrypted local state and bounded encrypted history.
- Safe restart, cancellation, corruption detection, and explicit recovery.
- CLI-host/desktop-participant and desktop-host/CLI-participant journeys.
- Signed Apple-silicon macOS binary and checksums.

Deferred:

- Browser, shared terminal, file editor, attachments, rich diff viewer, GitHub
  workflows, room archive UI, goals, thread graphs, thread forks, host handoff,
  unattended bots, auto-approval, Linux, Windows, and Homebrew distribution.

Deferred desktop records must not break a CLI room. They are validated and
rendered as bounded unsupported-content placeholders where appropriate.

## User experience

The initial interface is line oriented and remains usable over SSH and in plain
text. Representative commands:

```text
multAIplayer auth login
multAIplayer auth status
multAIplayer auth logout

multAIplayer room list
multAIplayer room create --name "Compiler work" --project /path/to/project
multAIplayer room join <invite-code>
multAIplayer room open <room>
multAIplayer room invite <room>
multAIplayer room leave <room>
multAIplayer room forget <room>
```

Inside a room, participant text, Codex proposals, trusted host prompts, Codex
activity, and assistant messages must be visually distinguishable even without
color. Untrusted text must not be able to spoof a trusted approval prompt.

## Repository and release isolation

Development occurs in this monorepo from a dedicated worktree. The desktop app,
CLI, and relay remain separate application surfaces over shared core behavior.

Initial arrangement:

- `apps/cli` is a standalone Rust workspace with its own manifest and lockfile.
- It has no npm `package.json` while isolation is required.
- Existing `mls-core` remains in place and is used through path dependencies.
- Desktop workspace and lockfiles are not reorganized for the scaffold.
- CLI packaging is excluded from desktop updater, signing, notarization, version
  synchronization, asset manifests, and release artifacts.

Long-term target, reached incrementally rather than through a mass move:

```text
apps/desktop
apps/cli
apps/relay
crates/mls-core
crates/protocol
crates/client-core
crates/codex-host
crates/secure-storage
packages/protocol
e2e/cli
e2e/cross-client
```

Extract one boundary at a time. An extraction change must preserve behavior,
switch consumers only after focused tests exist, and avoid simultaneously
moving files, changing wire formats, changing cryptographic policy, and adding
features.

## Shared architecture

### MLS core

Reuse the existing engine and policy for ciphersuite selection, group lifecycle,
membership, application encryption, invite sealing, exporter encryption,
outbox metadata, state storage, and host rules. There is no second crypto
implementation.

### Rust protocol layer

Add strict Rust representations for relay records and room events. The existing
TypeScript protocol is authoritative initially. Golden JSON fixtures are read by
both implementations and prove bounds, serialization equivalence, unknown-field
handling, and supported-version compatibility. Schema generation may replace
paired definitions later but does not block the alpha.

### Client core

A UI-independent client core owns authenticated relay HTTP/WebSocket behavior,
ordered processing, acknowledgements, reconnect, replay watermarks, MLS outbox
publication, stale-epoch recovery, room membership, chat projection, invite
admission, local history, host state, and proposal state. It must not depend on
Tauri, React, Zustand, browser globals, or terminal rendering.

### Codex host

A UI-independent Codex host owns app-server process lifecycle, compatibility
probing, JSON-RPC correlation, thread continuity, turn submission, notification
projection, server-request validation, pending approval deadlines, cancellation,
shutdown, normalized activity, and removal of sensitive upstream fields. Tauri
and CLI adapters provide their own event sinks and human prompts.

### Platform adapters

Keep narrow interfaces for secure credentials, atomic files, trusted URL opening,
clock/IDs, prompts, rendering, process spawning, and diagnostics. Core behavior
must be testable with deterministic adapters.

## Invitation and admission security

The code is a presentation of the existing secret capability, not a short PIN.
It contains or securely references the relay origin, invite identifier, and at
least 128 bits of unpredictable secret material. Encoding is versioned and
checksummed. Codes never enter logs, diagnostics, fixtures, shell arguments, or
room events.

Admission flow:

1. Host creates the room and MLS group.
2. Host requests relay invite metadata and issues the local capability.
3. Joiner authenticates with GitHub and initializes a bound device identity.
4. Joiner publishes a key package and sealed admission request.
5. Host sees the GitHub identity and device fingerprint.
6. Host explicitly approves or denies.
7. Existing MLS commit/welcome handling admits the device.
8. Durable state is written before success is claimed.
9. The invite is consumed, revoked, or expires.

## Codex proposal and approval lifecycle

Use an explicit state machine:

```text
idle -> proposed -> approved -> starting -> running
running -> awaiting_host_approval -> running
running -> completed | failed | cancelled
```

Proposal IDs and privileged request keys are stable and idempotent. Approval is
bound to the exact room, host authority, proposal/request, parameters, Codex
session, and expiry. Starting a turn rechecks native authority. Unknown,
malformed, expired, cross-room, cross-session, or authority-lost requests fail
closed. Host loss cancels safely and cannot be reported as success.

## Context policy

Send the current proposal, a bounded transcript since the previous completed
Codex turn, relevant recent assistant responses, participant display names, room
model intent, and host-authorized project context. Exclude credentials, invite
codes, device secrets, relay records, unsupported event payloads, unbounded
history, raw app-server objects, and local paths not needed by the runtime.

Before approval the host sees the proposer, task, room/project association,
context extent, effective model, reasoning effort, service tier, and sandbox
policy.

## Shared activity policy

Share assistant messages and the existing bounded normalized activity categories:
turn lifecycle, configured reasoning summaries, command/file/tool/web/image/
agent/review/hook lifecycle, and intentionally projected details. Do not share
environment variables, tokens, refresh data, arbitrary stdout/stderr, raw tool
arguments containing secrets, unknown upstream payloads, or host-local account
and MCP state.

## Persistence and recovery

Persist device and MLS identity, MLS group state, outbox entries, pending invite
state, room configuration, local project association, Codex thread ID, bounded
encrypted history, and replay watermark. Writes are atomic and crash safe.
Relay delivery is idempotent. Corruption or incompatibility produces explicit
rejoin/recovery behavior; it never silently regenerates room secrets or deletes
state. `auth logout`, `room leave`, and destructive `room forget` are distinct.

## Desktop interoperability

Required journeys cover CLI/CLI, CLI host with desktop participant, desktop host
with CLI participant, rooms created by either client, chat in both directions,
proposals approved by either host client, reconnect/replay, removal, and safe
unsupported-event rendering. Host handoff involving the CLI is unavailable in
the first alpha and fails explicitly through capability checks.

## Security requirements

- GitHub and relay sessions are origin bound and stored in macOS Keychain.
- Private keys and MLS state never cross an unnecessary UI/process boundary.
- Untrusted terminal control sequences are escaped or neutralized.
- Trusted prompts cannot be forged by participant or Codex output.
- There is no global `--yes`, unattended host, or unauthenticated local socket.
- Secrets are redacted from errors, diagnostics, crash reports, snapshots, and
  command arguments.
- Host authority and path containment are rechecked at operation time.
- Unknown relay, room, or Codex messages fail closed within bounded resource use.

## CI and Git workflow

Use one short-lived `codex/cli-*` branch and isolated worktree per task. Never
allow two writers in the same checkout or overlapping shared boundary. Desktop
hotfixes land on `main`; new CLI tasks begin from current `main` or the approved
CLI integration baseline.

CLI-000 is the program orchestrator. A 15-minute heartbeat wakes it to inspect
the active task, verify completion evidence, maintain the status ledger, merge
accepted work into `codex/cli-integration`, and approve the next dependency-ready
task. It may keep exactly one implementation task active. It never merges to
`main`, publishes a release, changes the approved plan, waives a gate, or resolves
an owner-only decision. The complete procedure and task-thread registry live in
`docs/cli/orchestration.md`.

CLI-only changes run CLI formatting, clippy, tests, protocol fixtures, and
journeys. Desktop-only changes retain existing gates. Shared protocol/MLS/Codex
changes run desktop, CLI, relay, and mixed-client verification. CLI path changes
must not implicitly alter desktop packaging or its dependency lock.

## Development phases

1. Governance and source-of-truth setup.
2. Release isolation and path-aware CI.
3. Inert Rust CLI scaffold.
4. Rust protocol and compatibility fixtures.
5. GitHub authentication and device identity.
6. Relay transport and workspace reads.
7. Reusable MLS client state and persistence.
8. Room creation and secure invitations.
9. Encrypted chat, presence, reconnect, and history.
10. Codex host extraction and compatibility.
11. Proposals, context, hosted turns, and privileged approvals.
12. Desktop/CLI interoperability.
13. Security hardening, packaging, and external-alpha readiness.

The task catalog is the authoritative decomposition of these phases.

## Public-alpha acceptance criteria

- A new user authenticates without manual configuration.
- A host creates a room and securely admits at least two participants.
- Desktop and CLI clients coexist in the room.
- Encrypted chat survives participant and relay reconnects without duplication.
- Any member proposes work; only the active host approves and executes it.
- Codex runs under the host's account and project.
- Supported privileged requests require exact host approval; unknowns fail closed.
- Assistant output and normalized activity reach all members in order.
- Crashes do not corrupt MLS state or duplicate execution.
- Secrets do not appear in relay plaintext, logs, diagnostics, shell arguments,
  snapshots, or release artifacts.
- The signed binary, checksums, documentation, compatibility matrix, and threat
  model match the actual implementation.
- Desktop release and updater verification remain unaffected.

## Plan change control

Material changes require an owner-approved plan-change task and isolated commit
or pull request. Examples include changing identity, invitation entropy, offline
admission, auto-approval, wire formats, MLS policy, host handoff scope, workspace
layout, lockfile coupling, or shared-output policy. Implementation agents stop
and ask rather than resolving such conflicts themselves.

The owner approved plan version 1.1 to delegate bounded task advancement and
CLI-only integration authority to CLI-000. This delegation does not extend to
`main`, desktop releases, publication, plan changes, or stop-condition decisions.
