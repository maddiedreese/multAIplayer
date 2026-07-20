# multAIplayer CLI architecture

The CLI provides the core multAIplayer experience in a terminal: authenticated
participants share an encrypted room, any participant can propose work, and one
active participant hosts and approves a local Codex session on their machine and
account.

The desktop and CLI clients use the same relay protocol, MLS groups, invitation
model, room records, and host-authority rules. A room may contain either client.

## Supported alpha surface

- GitHub device authentication and session restoration.
- Persistent device, signing, HPKE, and MLS identity.
- Room listing, creation, opening, leaving, and explicit local forgetting.
- Host-local project association without sharing the local path.
- Versioned, checksummed, revocable, expiring secure invitation capabilities.
- Host-mediated admission bound to GitHub identity and device fingerprint.
- Encrypted chat, presence, active-host indication, reconnect, and replay.
- Codex proposals from room members with explicit active-host approval.
- Host-local Codex app-server execution and compatibility checks.
- Shared assistant messages and bounded normalized activity.
- Host-local approval of supported privileged Codex requests.
- Atomic encrypted state, bounded encrypted history, and crash recovery.
- Apple-silicon macOS packaging independent of the desktop release.

Browser, shared-terminal, file-editor, attachment, rich-diff, goals, thread-graph,
host-handoff, unattended-bot, Linux, Windows, and Homebrew surfaces are not part
of this alpha. Unsupported desktop records render as bounded placeholders where
appropriate instead of breaking the room.

## Repository boundaries

`apps/cli` is a standalone Rust workspace with its own `Cargo.toml` and
`Cargo.lock`. It deliberately has no npm package and does not participate in the
desktop updater, version synchronization, release workflow, signing inputs, or
asset manifest.

The CLI currently uses the existing `mls-core` crate through a path dependency.
Shared extraction should remain incremental: add focused parity tests, switch
consumers, and preserve behavior before moving another boundary. Do not combine
a file move with wire-format, cryptographic-policy, and feature changes.

## Runtime components

### Protocol

Strict Rust relay and room-event types share golden JSON fixtures with the
TypeScript protocol. Both implementations enforce bounds, serialization parity,
unknown-field handling, and supported-version compatibility.

### Client core

The UI-independent client core owns authenticated relay HTTP/WebSocket behavior,
ordered processing, acknowledgements, reconnect, replay watermarks, MLS outbox
publication, stale-epoch recovery, room membership, chat projection, admission,
local history, host state, and proposal state. It must not depend on Tauri,
React, browser globals, or terminal rendering.

### Codex host

The UI-independent Codex host owns app-server lifecycle, compatibility probing,
JSON-RPC correlation, thread continuity, turn submission, notification
projection, privileged-request validation, approval deadlines, cancellation,
shutdown, normalized activity, and removal of sensitive upstream fields.
Desktop and CLI adapters provide their own event sinks and trusted prompts.

### Platform adapters

Narrow adapters provide secure credentials, atomic files, trusted URL opening,
clock and identifiers, prompts, rendering, process spawning, and diagnostics.
Core behavior must remain testable with deterministic adapters.

## Invitations and admission

An invitation is a secret capability, not a short PIN. It contains or securely
references the relay origin, invitation identifier, and at least 128 bits of
unpredictable secret material. Its encoding is versioned and checksummed.
Invitation material must never enter logs, diagnostics, fixtures, shell
arguments, or room events.

Admission proceeds as follows:

1. The host creates the room and MLS group.
2. The host issues a relay-backed invitation capability.
3. The joining client authenticates with GitHub and initializes a bound device.
4. The joining client publishes a key package and sealed admission request.
5. The host reviews the GitHub identity and device fingerprint.
6. The host explicitly approves or denies the request.
7. MLS commit and Welcome handling admit the approved device.
8. Durable state is written before success is reported.
9. The invitation is consumed, revoked, or expires.

## Codex authority

Codex proposals use an explicit lifecycle:

```text
idle -> proposed -> approved -> starting -> running
running -> awaiting_host_approval -> running
running -> completed | failed | cancelled
```

Approval is bound to the exact room, active host, proposal or request,
parameters, Codex session, and expiry. Authority and project-path containment
are rechecked immediately before execution. Unknown, malformed, expired,
cross-room, cross-session, or authority-lost requests fail closed. Losing the
host safely cancels an active turn.

The host preview includes the proposer, task, room/project association, context
extent, effective model, reasoning effort, service tier, and sandbox policy.
There is no global `--yes` or unattended-host mode.

## Shared and private data

Codex receives the current proposal, bounded room context, relevant recent
assistant messages, participant display names, room model intent, and the
host-authorized project context.

The room may receive assistant messages and bounded normalized lifecycle
activity. Credentials, invitation codes, device secrets, relay internals,
unbounded history, raw app-server objects, environment variables, arbitrary
stdout or stderr, host-local account state, and unnecessary local paths remain
private.

## Persistence and recovery

Device and MLS identity, group state, outbox entries, invitation state, room
configuration, local project association, Codex thread ID, bounded encrypted
history, and replay watermark are persisted atomically. Relay delivery is
idempotent. Corrupt or incompatible state produces explicit recovery behavior;
it never silently regenerates room secrets or deletes state.

`auth logout`, `room leave`, and `room forget` have intentionally distinct
effects. Changes to these operations require focused durability and failure
tests.

## Security invariants

- GitHub and relay sessions are origin-bound and stored in macOS Keychain.
- Private keys and MLS state do not cross unnecessary UI/process boundaries.
- Untrusted terminal controls and Unicode spoofing characters are neutralized.
- Participant and Codex output cannot imitate a trusted approval prompt.
- Secrets are redacted from errors, diagnostics, snapshots, arguments, and
  release artifacts.
- Host authority and path containment are checked at operation time.
- Unknown relay, room, and Codex messages fail closed within bounded resources.

See the [threat model](../threat-model.md) for maintained claims and residual
risks.

## Verification by change type

CLI-only changes run formatting, Clippy, locked workspace tests, packaging-policy
tests, protocol fixtures, and CLI journeys. Shared protocol, MLS, or Codex-host
changes additionally run desktop, relay, native, and mixed-client verification.
The path classifier must continue to keep CLI packaging outside every protected
desktop release surface.
