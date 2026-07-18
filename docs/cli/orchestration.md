# CLI-000 orchestration runbook

Status: Owner authorized  
Authority version: 1.0  
Integration branch: `codex/cli-integration`  
Heartbeat cadence: 15 minutes

CLI-000 is the sole automated program orchestrator. This delegation is bounded
by the approved plan, decisions, task specifications, and root `AGENTS.md`.

## Thread registry

| Task | Thread ID |
| --- | --- |
| CLI-000 | `019f76c9-8841-75c1-9b71-c7f8583b79a8` |
| CLI-010 | `019f76c9-8841-75c1-9b71-c7da987bcc77` |
| CLI-020 | `019f76c9-8d96-7f31-a993-d1b23166a167` |
| CLI-030 | `019f76c9-9c91-7b63-a134-2e74b91d22e2` |
| CLI-040 | `019f76c9-92ae-73f1-bc11-4f5208296c30` |
| CLI-050 | `019f76c9-a15f-7aa3-9e15-d5c807019eaf` |
| CLI-060 | `019f76c9-d002-76f1-bdbc-0d4526f0a1f1` |
| CLI-070 | `019f76c9-d003-75c3-9624-c4e23db9c855` |
| CLI-080 | `019f76c9-d475-7cf3-9cc2-481a3456accc` |
| CLI-090 | `019f76c9-da25-76c3-967f-d08c25d3634e` |
| CLI-100 | `019f76c9-e8ee-7c23-80af-1dbeb8a501de` |
| CLI-110 | `019f76c9-ee31-7631-b291-129e041f539e` |
| CLI-120 | `019f76ca-10de-70b0-ab93-71230a5a21a7` |
| CLI-130 | `019f76ca-19e9-7110-870b-5873eca50335` |
| CLI-140 | `019f76ca-10df-7553-92d5-9b8a93bec411` |
| CLI-150 | `019f76ca-1e78-7022-aeac-ae7e8e282976` |
| CLI-160 | `019f76ca-2d51-7ec2-8673-772d2a966b8a` |
| CLI-170 | `019f76ca-3609-7d71-ac15-f830671a522e` |

## Heartbeat algorithm

1. Sync and read the latest accepted integration baseline, `AGENTS.md`, plan,
   decisions, status, this runbook, and the active task specification.
2. Inspect all task-thread states. There must be zero or one active
   implementation task. Preparation-only or owner-discussion turns do not count.
3. If more than one writer is active, send stop instructions, preserve work, and
   notify the owner.
4. If one task is active, inspect its latest progress. Do not duplicate its work.
   If it is blocked on a genuine owner-only decision, notify the owner and stop.
5. When a task claims completion, inspect the actual diff, changed paths, commit
   ancestry, repository status, task acceptance criteria, required tests, and
   desktop release boundaries. Rerun the narrow verification needed to establish
   trustworthy evidence.
6. Reject or return the task for correction if evidence is incomplete, tests are
   failing or misleading, unrelated changes exist, integration is unsafe, or a
   stop condition applies.
7. If verification succeeds, ensure the task work is committed, merge it into
   `codex/cli-integration` without rewriting accepted history, rerun integration
   checks, and record the commit/test evidence in `status.md`.
8. Mark the task complete only after the integration branch is clean and verified.
9. Select the earliest task in the catalog whose dependencies are complete.
   Confirm no other implementation is active, then send that task an explicit
   approval containing the accepted integration commit, allowed/protected scope,
   required verification, and stop conditions.
10. If all tasks are complete, do not start new work. Notify the owner that the
    program awaits the final owner-controlled merge/release decision.

## Mandatory stop conditions

Pause advancement and notify the owner for:

- any proposed merge to `main` or release publication;
- plan, locked-decision, wire-contract, or MLS-policy change;
- unexpected desktop runtime, Cargo.lock, updater, signing, notarization,
  version, release workflow, or asset-manifest change;
- unresolved security, privacy, authorization, redaction, state-durability, or
  terminal-injection concern;
- failing, flaky, skipped, or non-executing required tests;
- unrelated work or unresolvable integration conflict;
- missing dependency, missing evidence, ambiguous task completion, or unsafe
  uncertainty;
- a question that requires owner product judgment or broader authority.

## Approval message contract

CLI-000 approvals must name exactly one task, the integration baseline commit,
the task file, dependencies, allowed scope, protected scope, verification, and
stop conditions. The message must explicitly say that no other task is approved.

## Main and release boundary

Automated integration ends at `codex/cli-integration`. Only the owner may merge
to `main`, mark a CLI pull request ready, publish an artifact, or authorize a
desktop release-surface change.
