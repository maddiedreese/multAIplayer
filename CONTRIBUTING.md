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
npm install --global npm@11.16.0 --ignore-scripts
npm ci
npm run doctor
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
The pull request template records the checks and any security or release impact.

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
core small and independently testable. A pull request changing a security
boundary must name the focused behavior, property, fuzz, native, or journey
evidence that applies. This single-maintainer project does not require
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
[Verifying releases](docs/reproducible-builds.md).

### Continuous-integration policy

`ci.yml` contains blocking workspace lint, type, behavior-test, build, Rust
formatting, Clippy, and native-test checks. `journeys.yml` always reports one
required aggregate: executable product changes run the UI, native two-client,
and packaged macOS journeys, while documentation-only changes report that there
was no executable product change. Repository settings should require the
always-present `Required product journeys` aggregate rather than path-filtered
individual jobs.

Scheduled parser/native fuzzing, relay churn/restore exercises, container
scanning, dependency review, and the macOS two-client run cover expensive or
platform-specific boundaries. Promote a check to pull-request CI only when it
reliably enforces a user-visible or security-critical property at a cost
appropriate for every pull request.

### Dependencies and releases

Dependencies remain exact-pinned. Dependabot batches routine npm, Cargo, Actions,
and container updates weekly; handle security advisories immediately in focused
PRs. A temporary exception must name the advisory, reachability, owner, expiry,
and removal condition.

Release artifacts come only from a validated tag through `release.yml`. The
workflow keeps the GitHub Release in draft state until the blocking native
two-client journey, signed/notarized build, authenticated metadata and updater
archive, checksums, and release-asset contract all pass. The protected
`public-alpha-release` environment gates the
publishing deployment. GitHub records deployment status, timestamps, and reviewer
identity when required reviewers are configured; it does not durably capture the
contents of the cold/warm universal-link, accessibility, or two-device exploratory
checklists. The maintainer completes those manual checks against the tagged build
before approving the protected environment; approval is the publication decision,
not evidence that GitHub executed or archived the checklist. Leave the release in
draft state if any required manual check is incomplete or fails, and do not make
the website call that build supported.

If publication succeeds but updater-channel advancement fails, open the original
release workflow run and choose **Re-run failed jobs**. That preserves the tagged
build and retries only the failed channel job plus its dependents. Do not dispatch
a new full workflow for an already-public tag: the workflow rejects that before
rebuilding or replacing it. If GitHub reported the publish
job as failed after it actually made the release public, re-running failed jobs
authenticates the retained build subset and the required public asset
set, leaves the public release unchanged, and then permits the channel retry.

The root `packageManager` field is authoritative. CI and release workflows use
the repository composite setup action to install that exact npm version. The root
`allowScripts` policy exact-pins the install scripts required by native SQLite and
the frontend build, explicitly denies unused downloaded browser drivers and
optional file watchers, and `.npmrc` fails on any newly introduced unreviewed
install script. Do not bypass it with a blanket allow-all or ignore-scripts policy
for a normal install. Run `npm ci` and then `npm run doctor` to verify the
toolchain. `--ignore-scripts` is used only for metadata-only lockfile or
package-manager installation operations that do not execute repository code.

Pull requests are squash-merged. Their title becomes the sole commit title and
must use Conventional Commit form so Release Please receives one unambiguous
change record. Before merging a release PR, review the generated section as
customer-facing copy; manually remove duplicate merge-history entries and
internal implementation noise rather than publishing raw automation output.
Repository settings should disable merge commits and rebase merges, use the PR
title for squash commits, and delete merged branches.

The updater key fingerprint, manual verification, and release-channel mechanics
are maintained in [Verifying releases](docs/reproducible-builds.md). Keep
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
