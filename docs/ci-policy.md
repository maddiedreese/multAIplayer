# Continuous-integration policy

GitHub branch protection is the enforcement source; keep required checks aligned with this table.

| Workflow | Runs | Failure means | PR blocking |
| --- | --- | --- | --- |
| CI | pull requests and `main` | DCO sign-off, lint, formatting, types, tests, builds, security journeys, or packaging failed | Yes for configured core checks |
| CodeQL | schedule, release, manual | candidate vulnerability or analysis failure | No for ordinary PRs; a release-triggered failure requires immediate triage and possible withdrawal |
| npm advisory audit | schedule, release, manual | high-severity advisory or integration failure needs triage | No for ordinary PRs; a release-triggered failure requires immediate triage and possible withdrawal |
| Rust dependency policy | schedule, release, manual | advisory, ban, source, or license policy failed | No for ordinary PRs; a release-triggered failure requires immediate triage and possible withdrawal |
| Supply-chain security | schedule, release, manual | heavyweight SBOM/container scan or provenance control failed | No for ordinary PRs; a release-triggered failure requires immediate triage and possible withdrawal |
| Latest Codex contract | schedule, manual | supported-latest integration drifted | No; triage compatibility work |
| Release | version tags, manual | preflight, reproducibility, signing, packaging, or publication failed | Not a PR check; blocks release |

Mutation jobs in `CI` are gated to scheduled or manual execution, not ordinary pull requests. A surviving in-scope security-boundary mutant blocks a release-quality claim and must be fixed or explicitly reviewed. Scanner findings are not dismissed solely to make checks green: record evidence and the narrowest time-bounded suppression. Scheduled failures should create or update a maintenance issue and do not retroactively invalidate unrelated merges.

The core script tests also resolve every local inline link in tracked Markdown. Fragment-only, external, and generated placeholder destinations are outside that filesystem check; local paths with fragments still have to name an existing repository file. This keeps contributor and release documentation from silently pointing at removed or renamed files without making untracked working notes part of CI.
