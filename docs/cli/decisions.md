# multAIplayer CLI locked decisions

Status: Approved
Owner: Maddie D. Reese
Decision set: 1.1
Last material update: 2026-07-18

These decisions remain in force until the owner explicitly approves a change.

| Area | Decision |
| --- | --- |
| Binary name | `multAIplayer` |
| Repository | Existing multAIplayer monorepo |
| Development checkout | Dedicated CLI worktree, separate from desktop release work |
| Interoperability | CLI and desktop clients must join the same rooms |
| Authentication | Retain existing GitHub authentication and device binding |
| Encryption | Reuse the existing MLS implementation and policy |
| Relay | Reuse the existing hosted or self-hosted relay |
| Hosting | One active participant hosts Codex on their machine and account |
| Proposals | Any current room member may propose a Codex turn |
| Turn authority | Only the active host may approve and start a turn |
| Privileged requests | Only the active host answers Codex command, file, tool, authentication, and elicitation requests |
| Shared Codex data | Assistant transcript and the existing normalized activity projection |
| Private host data | Credentials, environment details, raw app-server objects, and unintended raw output remain local |
| Invitation UX | Pasteable secure codes representing the existing capability-based admission model |
| Admission | The host must be online and approve the joining GitHub identity and device |
| Initial UI | Line-oriented CLI; no full-screen TUI requirement |
| Initial scope | Rooms, encrypted chat, proposals, hosted Codex turns, and host approvals |
| Deferred surfaces | Browser, shared terminal, file editor, attachments, GitHub panels, goals, thread graph, and rich diffs |
| Initial host handoff | Deferred; unsupported transitions fail explicitly |
| Automation | Human-interactive only; no global auto-approval or unattended host mode |
| Initial platform | Apple-silicon macOS, matching the desktop alpha |
| Release coupling | CLI source may coexist on `main`, but packaging, versions, locks, and artifacts remain isolated until launch |
| Program orchestration | CLI-000 may verify, integrate, and advance tasks automatically under bounded delegated authority |
| Integration target | Automated task merges may target only `codex/cli-integration`; `main` remains owner-controlled |
| Concurrency | At most one implementation task may be active unless the owner explicitly authorizes nonoverlapping parallel work |
| Automation cadence | CLI-000 receives a 15-minute heartbeat while the program is active |

## Recommended defaults

- Invitation codes are versioned, checksummed, high entropy, redacted, revocable,
  single-use initially, and expire after 24 hours by default.
- A room allows one active Codex turn and at most one pending proposal initially.
- Host authority is rechecked immediately before a turn or privileged response.
- Host loss safely cancels an active turn; resumable execution is deferred.
- One Codex thread is retained per room initially.
- Model selection defaults to host-resolved `auto` under the existing compatibility
  policy.
- Relay backlog supports reconnect but is not permanent history.
- Local room history is bounded and encrypted.
- Unsupported desktop event types render a safe placeholder in the CLI.
- No `--yes` flag may bypass human approval.
