# multAIplayer CLI development status

Plan version: 1.1
Decision set: 1.1
Baseline: `156c55e51ab2db9d00c8eb418c4443a55ddb739e`  
Current phase: CLI-050 Relay transport and workspace reads
Implementation authorization: Delegated to CLI-000 within the approved runbook
Last update: 2026-07-18

## Current state

- Desktop pre-release `v0.1.0-alpha.7` exists.
- CLI governance worktree: `/Users/maddiedreese/Documents/MultAIplayer-cli`.
- Codex project: `MultAIplayer-cli`.
- Governance branch: `codex/cli-governance`.
- The CLI scaffold, strict Rust protocol parity layer, GitHub authentication,
  and secure device identity are present; relay transport, MLS room state, and
  later product behavior have not been implemented.
- CLI-000 is the authorized program orchestrator.
- CLI-010 is complete and integrated. Its accepted task commit is
  `2490d71fa71696ffdd692e9950b4c93327c959be`; integration merge
  `d7fd5d73e9f6b612a904cc8f4e639be9b89751fb` passed 23 CI tests, 21 release-tool
  tests, documentation checks, the CLI isolation check, and the protected-path
  audit. The task's full `npm run verify` also passed before integration.
- CLI-020 is complete and integrated. Its accepted task commit is
  `fc54881490473d9f2aab7ff822c5560041315af6`; integration merge
  `9d0e71b154fc59c9bdfc783da9f8df36ff699b0c` passed CLI formatting, Clippy,
  two unit tests, bounded help/version checks, 18 classification/isolation tests,
  and the protected desktop-release audit.
- CLI-030 is complete and integrated. Its accepted task commit is
  `09cddb0c6734844e6457a86ccd9d24f601b0e055`; integration merge
  `c9471059b0ee06a25e3be2f050a884069c1af566` passed Rust formatting,
  warnings-denied Clippy, 11 locked CLI/protocol tests, protocol typecheck and
  build, 27 TypeScript protocol tests, fixture drift verification, the CLI
  runner, 18 classification/isolation tests, and the protected desktop-release
  audit. The task's full `npm run verify` also passed before integration.
- CLI-040 is complete and integrated. Its accepted task head is
  `3ac746dd3de9f4ca310624911c7450a8436b3629`; integration merge
  `8f2e0016f8a0a0c0adee875e005cd10fc5a5980f` passed the CLI runner with 30
  locked CLI/protocol tests, 18 classification/isolation tests, focused relay
  device compatibility, 33 `mls-core` tests, the durable identity lifecycle
  test, dependency advisories/sources/license audits, Apple Keychain selection,
  origin-binding/redaction/logout audits, and the protected desktop-release
  audit.
- CLI-050 is the only active implementation task.
- Every other implementation task is `waiting_for_orchestrator_approval` until
  CLI-000 confirms dependencies and grants exact task approval.
- All 18 Codex tasks have read their governing files, reported readiness, and
  stopped without implementation.
- `[CLI-000] Program Control — Governance` and `[CLI-010] Desktop Release
  Isolation` are pinned in the Codex project.
- Tasks must be approved and executed one at a time unless the owner explicitly
  authorizes nonoverlapping parallel worktrees.

## Task ledger

| Task | Title | State | Depends on |
| --- | --- | --- | --- |
| CLI-000 | Program orchestration and governance | active_orchestrator | — |
| CLI-010 | Desktop release isolation and CI classification | complete | CLI-000 |
| CLI-020 | Inert Rust CLI scaffold | complete | CLI-010 |
| CLI-030 | Rust protocol types and golden fixtures | complete | CLI-020 |
| CLI-040 | GitHub authentication and secure device identity | complete | CLI-030 |
| CLI-050 | Relay transport and workspace reads | active | CLI-030, CLI-040 |
| CLI-060 | MLS client state, storage, and outbox | waiting_for_orchestrator_approval | CLI-030, CLI-040 |
| CLI-070 | Room creation and local project association | waiting_for_orchestrator_approval | CLI-050, CLI-060 |
| CLI-080 | Secure invite codes and host-mediated admission | waiting_for_orchestrator_approval | CLI-070 |
| CLI-090 | Encrypted chat, presence, and safe rendering | waiting_for_orchestrator_approval | CLI-050, CLI-060, CLI-080 |
| CLI-100 | Reconnect, replay, history, and crash recovery | waiting_for_orchestrator_approval | CLI-090 |
| CLI-110 | UI-independent Codex host extraction | waiting_for_orchestrator_approval | CLI-020 |
| CLI-120 | Codex proposals, context, and hosted turns | waiting_for_orchestrator_approval | CLI-090, CLI-110 |
| CLI-130 | Privileged approvals and shared activity | waiting_for_orchestrator_approval | CLI-120 |
| CLI-140 | Desktop/CLI interoperability journeys | waiting_for_orchestrator_approval | CLI-100, CLI-130 |
| CLI-150 | Security hardening and threat-model update | waiting_for_orchestrator_approval | CLI-140 |
| CLI-160 | Signed CLI packaging and release isolation | waiting_for_orchestrator_approval | CLI-150 |
| CLI-170 | External-alpha readiness review | waiting_for_orchestrator_approval | CLI-160 |

## Release safety snapshot

- Desktop Cargo.lock changed by governance: no.
- Desktop release workflow changed by governance: no.
- Desktop updater/signing/notarization changed by governance: no.
- CLI included in desktop packaging: no.
- CLI implementation dependencies installed: protocol, authentication, secure
  storage, HTTPS, and existing `mls-core` path dependencies only.
- CLI release publication enabled: no.

## Update rules

An implementation task may update its state and evidence here after approval.
It may not mark dependencies complete without their accepted verification. Any
deviation from the plan is recorded as a blocker until the owner approves a
plan change.

CLI-000 owns routine status transitions. Only the owner may authorize a plan or
decision change, a merge to `main`, or a release.
