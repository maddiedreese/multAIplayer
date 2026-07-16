# Contributing

Thanks for helping with multAIplayer. Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately through
[SECURITY.md](SECURITY.md), not a public issue.

This guide is progressive: most contributors need only **First pull request** and
**Checks by area**. Read **Repository contracts** for the boundary you are
changing. The final section is for maintainers operating CI, releases, or the
hosted relay. The [documentation map](docs/README.md) routes deeper reading.

## First pull request

Use the Dev Container for the shortest reproducible setup. For a local checkout,
install Node.js 22 or newer (`nvm use` uses the same version family as CI), then:

```sh
npm install
node scripts/doctor.mjs
npm run dev
```

`npm run dev` starts the relay and Vite frontend. The browser frontend is only a
native-app notice; use `npm run tauri:dev` to run the usable Tauri application.
The supported release target is Apple-silicon macOS, although many checks also run
on Linux CI.

Before coding:

1. Choose an issue with a clear scope and acceptance criteria; comment before
   starting to avoid duplicate work.
2. Read the [architecture walkthrough](docs/product-architecture.md#contributor-walkthrough).
3. If the change crosses a durable design or trust boundary, find the relevant
   record in the [ADR index](docs/decisions/README.md).

Run the smallest relevant checks while iterating, add focused tests, and finish
with:

```sh
npm run verify
```

The optional staged-file hook runs Prettier and ESLint. Enable it per clone with
`npm run hooks:install`; CI remains authoritative. Use a cohesive Conventional
Commit subject (`feat:`, `fix:`, `docs:`, or `chore:`), and split unrelated work.
The pull request template records the checks and any security or stabilization
impact.

## Where changes belong

The [architecture guide](docs/product-architecture.md) has the full repository
map. These placement rules are the ones most often missed:

- Pure desktop logic belongs under `apps/desktop/src/lib/<domain>`; store-aware
  workflows belong in `application/<domain>` and component-facing projections in
  `presentation/<domain>`. Do not bypass package entry points or make the pure
  library depend on UI state.
- Native capabilities live in focused modules under `apps/desktop/src-tauri/src`.
  Cryptographic state and operations belong in the `mls-core` crate, not the
  webview.
- Relay transport, persistence, limits, and lifecycle code live under
  `apps/relay/src`; public wire records and limits shared with clients belong in
  `packages/protocol`.
- Scheduled/build helpers belong under `tools`; executable journeys and drills
  belong under `e2e`; keep `scripts` for small day-to-day entry points.
- A React hook earns a separate file only when reused or when it owns a real
  lifecycle such as a subscription, effect, or ref. The
  [hook index](apps/desktop/src/hooks/README.md) records existing ownership.

## Checks by area

Run commands from the repository root.

| Change                                                          | Iteration checks                                                                        | Before handoff                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Relay HTTP, WebSocket, auth, persistence, or limits             | `npm run check -w @multaiplayer/relay`; focused relay test                              | `npm run test -w @multaiplayer/relay`; add `npm run test:fuzz -w @multaiplayer/relay` for parser/schema changes |
| Desktop React, hooks, stores, or adapters                       | `npm run check -w @multaiplayer/desktop`; `npm run test:smoke -w @multaiplayer/desktop` | `npm run test -w @multaiplayer/desktop`                                                                         |
| Browser journey or UI harness                                   | `npm run test:e2e -- e2e/<journey>.spec.ts`                                             | `npm run test:e2e`                                                                                              |
| Native invite, MLS, or handoff composition                      | focused relay process test                                                              | Linux native two-client journey in its pinned CI environment                                                    |
| Shared package                                                  | package `check` and focused test                                                        | package test suite                                                                                              |
| Native Tauri/Rust                                               | `npm run fmt:rust:check`; focused Cargo test                                            | `npm run test:native`                                                                                           |
| Native packaging, windows, Keychain, terminal, or Codex process | native checks above                                                                     | `npm run tauri:build -w @multaiplayer/desktop`                                                                  |
| Cross-cutting TypeScript or workspace configuration             | affected workspace checks                                                               | `npm run lint`; `npm run format:check`                                                                          |

`npm run verify` runs the complete workspace lint, format, type, test, build, and
Rust gate. Use `npm run format` to apply the repository baseline. The relay fuzz
suite defaults to 100,000 cases; reproduce a failure with
`MULTAIPLAYER_RELAY_FUZZ_SEED` and tune local iteration with
`MULTAIPLAYER_RELAY_FUZZ_ITERATIONS`.

Add focused tests for changed authorization, persistence, cryptography, invite,
GitHub, encrypted-history, browser, terminal, diagnostics, or native-command
behavior. Simulated native/relay boundaries in the browser harness must remain
explicit and outside the production desktop graph.

## Repository contracts

### Security-boundary changes

Keep changes to `packages/protocol`, `apps/desktop/src-tauri`, and the Rust MLS
core small and independently testable. A pull request must identify AI-authored
security-boundary changes and name the focused property, fuzz, mutation, native,
or journey evidence that applies. This single-maintainer project does not require
a second approval that cannot exist; required CI and branch protection are the
merge gate.

Security claims and residual risks belong only in the
[threat model](docs/threat-model.md). Durable architecture constraints belong in
ADRs. Contributor prose should link to those sources rather than creating a
second policy.

### Engineering rules

- Keep relay plaintext minimal. Chat, attachment contents, terminal output,
  Codex/Git/browser events, and invite approval content stay inside the documented
  MLS, HPKE, Welcome, or exporter-sealed boundaries.
- Confine native project access to the selected project root. Treat browser pages,
  terminal output, `.env` files, credentials, and signed-in sessions as sensitive.
- Log stable error codes and bounded identifiers, never bodies, plaintext,
  credentials, keys, tokens, passphrases, or payload objects.
- Do not add OpenAI API quota bridging. The desktop uses the host's standard local
  Codex app-server.
- Respect declared workspace dependencies and public entry points. ESLint rejects
  undeclared package edges, deep imports, and relative source-tree bypasses.
- Prefer compiler-, schema-, or established-tool checks over source regexes. If a
  narrow repository script is unavoidable, consume structured input, test it, and
  source volatile facts from one manifest.
- Keep a repository-owned `.mjs` helper only while it is an active package or
  workflow entry point, supports one through an import, or is focused coverage for
  one. Prefer an established tool when it expresses the same contract, and delete
  orphaned generators, comparators, and policy checks with their stale outputs.

### Native failures and diagnostics

Fallible Tauri commands use the compiler-enforced typed-command contract and
return bounded public error codes without dependency, storage, or cryptographic
causes. Runtime `unwrap`, `expect`, or deliberate panic requires a documented
initialization invariant and focused failure test.

Diagnostics changes need tests on both sides of IPC: frontend capture/redaction
and ordered-write behavior, plus Rust request validation, permissions, retention,
corruption recovery, re-redaction, and safe export writes. Never add a command
that returns persisted diagnostic entries, bundle contents, or the selected
export path to the webview.

### Monaco DOMPurify pin

The Monaco sanitizer override and direct `dompurify` pin intentionally live in
the root `package.json`, because npm applies workspace overrides only there. Vite
routes Monaco to that patched package, and the desktop security-dependency check
rejects vulnerable bundled output. Upgrade or remove these pieces only together
and with the focused build check.

## Maintainer operations

This section is not required reading for an ordinary contribution. Operators
should also use [Self-hosting](docs/self-hosting.md); release reviewers should use
[Reproducing release builds](docs/reproducible-builds.md). The
[external review preparation packet](docs/design/external-review-packet.md) is
planning material for a future independent engagement, not a merge gate.

### Stabilization

The repository is feature-frozen from **2026-07-15 through 2026-07-22 inclusive**.
During that window, merge only fixes, deletion/simplification, documentation
corrections, dependency/security updates, test repairs, and release operations.
A user-visible feature resets the seven-consecutive-day clock. Future release PRs
declare the same minimum window and record any reset.

### Continuous-integration policy

`ci.yml` contains fast blocking checks: workspace lint/type/test/build, relay authorization coverage, per-file desktop invite and host-handoff coverage floors, and Rust formatting/Clippy/tests. `journeys.yml` runs UI, deterministic security, native two-client, and macOS package evidence on `main`, tags, schedules, and pull requests that change executable product or journey code. Documentation-only edits do not start product journeys, and generated prose is not a merge gate. Coverage and journey jobs are controls that can fail; CI does not create report-only or routing-only jobs that look like verification.

Desktop source files have an advisory 400-line ESLint ceiling. A warning names the
specific file and overage so the next related change can extract a cohesive
component or application action; warnings are visible but do not fail CI. Do not
silence the warning by excluding or renaming a file. Journey path filters stay
broad for executable product changes: timing failures are fixed at their
polling/state boundary rather than worked around by narrowing triggers or blind
reruns.

Mutation testing, parser fuzzing, extended supply-chain scans, reproducibility comparisons, soak/restore drills, and the scheduled macOS two-client run are advisory or scheduled evidence. The relay mutation policy preserves the measured `authz.ts` 100%/zero-survivor baseline and the existing 60% score/survivor ceilings for session, WebSocket-admission, and room-route decisions, with an explicit 80% target. Each weekly shard fails visibly on tooling errors or regression below its checked-in baseline. The first run each month emits a reviewable candidate that advances score floors in five-point steps and never increases a survivor ceiling; maintainers review and commit justified advances rather than letting automation rewrite policy silently. Investigate regressions; do not turn them into a Tuesday bugfix blocker without deleting or demoting an existing blocking check. No new blocking check may be added without removing or demoting another one.

The deterministic security journey fails if its Rust production boundary or
the tested relay lifecycle is unavailable. It retains the executed test report
as an artifact. The threat model summarizes that test by hand and is not
regenerated from CI output. Coverage artifacts describe execution; only named
floors are merge gates.

### Dependencies and releases

Dependencies remain exact-pinned. Dependabot batches routine npm, Cargo, Actions,
and container updates weekly; handle security advisories immediately in focused
PRs. A temporary exception must name the advisory, reachability, owner, expiry,
and removal condition.

Release artifacts come only from a validated tag through `release.yml`. Run
`npm run release:preflight` and require the signed/notarized app, authenticated
metadata and updater archive, cold/warm universal-link checks, checksums, SBOM,
provenance, Sigstore evidence, reproducibility evidence, and two-device acceptance
journey. Missing required evidence leaves the release unsupported.

The updater key fingerprint, manual verification, and release-channel mechanics
are maintained in [Reproducing release builds](docs/reproducible-builds.md). Keep
the private updater key out of the repository, logs, artifacts, and shell history;
keep an encrypted offline recovery copy. Before the first public build, verify the
committed key fingerprint against the project website and a maintainer-controlled
channel independent of GitHub. Routine rotation requires an old-key-signed bridge;
suspected compromise requires stopping the manifest and publishing a manual
verified recovery through the independent anchors.

### Hosted relay operations

Monitor SQLite free space/database size, WAL growth, backup and restore-drill age,
and bounded rate-limit decisions through the relay's structured operational
snapshot. A repository fixture drill is not evidence that production data was
restored. The full storage, edge, backup, deletion-ledger, and recovery procedures
live in [Self-hosting](docs/self-hosting.md).

#### Hosted account restriction

Account restriction is a stopped-relay operator action, not a network endpoint:
fence the sole writer, back up the database, run the restriction CLI with a
bounded reason and optional expiry, restart, then verify session/device eviction
and denial of new or restored sessions. Restriction denies service; it does not
erase shared ciphertext or revoke material already delivered to another device.

#### Hosted-to-self-hosted migration

Deploy and validate the replacement relay and clients pinned to its HTTPS/WSS
origins. Recreate teams, rooms, membership, sessions, and invites; live MLS
authority, group secrets, exporter history keys, local processes, and credentials
do not transfer. Keep original devices and encrypted display-history archives
until new rooms, chat, attachments, host approval, and local history are verified.
Then announce a cutoff, revoke old sessions/invites, and retain or remove the old
database under its published backup and deletion horizons.

### Compatibility inventory

Every compatibility reader needs an owner and deletion condition. Supported
readers are limited to the documented Codex range, one-way legacy relay import,
enumerated local-history/archive versions, and explicit native migrations. Never
silently accept an old cryptographic wire format. Update
[the inventory](docs/compatibility-inventory.md) when a reader is added or removed;
update the threat model only if the trust boundary changes.
