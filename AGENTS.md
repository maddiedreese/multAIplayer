# Repository instructions

## multAIplayer CLI work

These rules apply to any task involving the CLI, shared client core, Rust relay
protocol support, Codex host extraction, or CLI/desktop interoperability.

Before taking any implementation action:

1. Read `docs/cli/development-plan.md` completely.
2. Read `docs/cli/decisions.md` and `docs/cli/status.md` completely.
3. Read the applicable task file under `docs/cli/tasks/` completely.
4. State the task ID, allowed scope, protected scope, and required verification.
5. Wait for explicit approval in that task before editing files, creating a
   branch, installing dependencies, or running mutating commands. Approval may
   come directly from the project owner or from CLI-000 acting within the
   delegated orchestration authority below.

The approved plan and decisions are normative. Implementation work may update
`docs/cli/status.md`, but must not silently change the plan or a locked decision.
A material change requires explicit owner approval and a dedicated plan-change
commit or pull request.

CLI tasks must not modify desktop release metadata, updater configuration,
desktop signing or notarization, desktop Cargo.lock, release workflows, release
asset manifests, or desktop version synchronization unless the applicable task
explicitly authorizes the exact file and change.

Stop and request direction if work would:

- change the relay wire contract or MLS cryptographic policy;
- change existing desktop behavior outside the task's acceptance criteria;
- require an unplanned dependency or workspace boundary;
- touch a protected release surface;
- weaken GitHub authentication, device binding, invitation capabilities, host
  authority, approval binding, redaction, or local-state durability;
- conflict with the approved plan or another in-progress task.

Keep changes additive and independently reviewable. Shared-code extraction must
preserve desktop behavior and pass both desktop and CLI verification. Never run
two writing tasks against the same worktree, shared crate, protocol surface, or
release file concurrently.

## CLI-000 delegated orchestration authority

The project owner has authorized `[CLI-000] Program Orchestrator` to:

- monitor the CLI task threads and status ledger;
- approve exactly one dependency-ready implementation task at a time;
- require, inspect, and independently verify task evidence;
- merge verified task work into `codex/cli-integration` only;
- update CLI status and approve the next dependency-ready task automatically.

CLI-000 is never authorized to merge into `main`, publish releases, alter the
approved plan or locked decisions, waive verification, answer owner-only
product/security questions, or advance work after a stop condition. It must
pause and notify the owner when verification fails, protected desktop/release
scope is implicated, a material decision is required, or safe integration is
uncertain.
