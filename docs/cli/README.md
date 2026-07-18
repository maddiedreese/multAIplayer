# multAIplayer CLI program

This directory is the durable source of truth for the planned `multAIplayer`
command-line client.

Read in this order:

1. [Development plan](development-plan.md)
2. [Locked decisions](decisions.md)
3. [Current status](status.md)
4. [Task catalog](task-catalog.md)
5. [Orchestration runbook](orchestration.md)
6. The applicable file under [tasks](tasks/README.md)

The [CLI and desktop release boundaries](release-boundaries.md) describe the
path-aware CI contract and protected desktop release surfaces.

Implementation agents must also follow the repository-root `AGENTS.md`. The CLI
is intentionally not implemented by this governance setup. Every implementation
task begins in a waiting-for-owner-approval state.

## Authority order

When sources disagree, use this order:

1. An explicit current instruction from the project owner.
2. The approved decisions and development plan in this directory.
3. Accepted architecture decision records.
4. The current task specification.
5. `status.md` and GitHub issue tracking.
6. Pull-request descriptions and Codex conversation history.

Material plan changes require explicit owner approval. Routine implementation
progress belongs in `status.md`; historical detail belongs in Git history.
