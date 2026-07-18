# multAIplayer CLI development status

Plan version: 1.1
Decision set: 1.1
Baseline: `156c55e51ab2db9d00c8eb418c4443a55ddb739e`  
Current phase: Orchestrator activation; CLI-010 is next
Implementation authorization: Delegated to CLI-000 within the approved runbook
Last update: 2026-07-18

## Current state

- Desktop pre-release `v0.1.0-alpha.7` exists.
- CLI governance worktree: `/Users/maddiedreese/Documents/MultAIplayer-cli`.
- Codex project: `MultAIplayer-cli`.
- Governance branch: `codex/cli-governance`.
- No CLI product code has been authorized or implemented.
- CLI-000 is the authorized program orchestrator.
- Every implementation task is `waiting_for_orchestrator_approval` until CLI-000
  confirms dependencies and grants exact task approval.
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
| CLI-010 | Desktop release isolation and CI classification | waiting_for_orchestrator_approval | CLI-000 |
| CLI-020 | Inert Rust CLI scaffold | waiting_for_orchestrator_approval | CLI-010 |
| CLI-030 | Rust protocol types and golden fixtures | waiting_for_orchestrator_approval | CLI-020 |
| CLI-040 | GitHub authentication and secure device identity | waiting_for_orchestrator_approval | CLI-030 |
| CLI-050 | Relay transport and workspace reads | waiting_for_orchestrator_approval | CLI-030, CLI-040 |
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
- CLI implementation dependencies installed: no.
- CLI release publication enabled: no.

## Update rules

An implementation task may update its state and evidence here after approval.
It may not mark dependencies complete without their accepted verification. Any
deviation from the plan is recorded as a blocker until the owner approves a
plan change.

CLI-000 owns routine status transitions. Only the owner may authorize a plan or
decision change, a merge to `main`, or a release.
