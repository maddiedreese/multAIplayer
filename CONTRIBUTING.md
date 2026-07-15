# Contributing

Thanks for helping with multAIplayer. This project is a macOS-first open-source alpha for private group chat with a local Codex host, an end-to-end encrypted relay, GitHub workflows, terminals, file viewing, and browser approvals.

Participation is governed by [the Code of Conduct](CODE_OF_CONDUCT.md).

## Security-boundary changes

Keep changes to the Rust MLS core, `packages/protocol`, and `apps/desktop/src-tauri` small, explicit, and independently testable. Pull requests should identify AI-authored security-boundary changes and report the focused property, fuzz, mutation, or native checks that apply. This project currently has one maintainer, so it does not require a separate human or code-owner approval that the sole maintainer could never supply; required CI and branch protection remain the merge gate.

Dependency advisory handling, workflow purpose, merge impact, release operations, and native failure rules are maintained in this guide. Accessibility expectations and the honest localization status are in [Accessibility and localization](docs/using-the-app.md#accessibility-and-localization). Product security claims and residual risks belong only in the [threat model](docs/threat-model.md); contributing guidance must link there instead of paraphrasing a claim.

## Fast path

For the shortest reproducible on-ramp, open the repository in a Dev Container. Its Node 22 image plus Rust and Python features install the workspace and run the environment doctor automatically. For a local checkout, install Node.js 22 or newer and run `nvm use` when using nvm; the root `engines` field and `.nvmrc` match CI, and npm rejects unsupported runtimes through `engine-strict`. Then run:

```sh
npm install
node scripts/doctor.mjs
npm run dev
```

Start with the [architecture walkthrough](docs/product-architecture.md#architecture-walkthrough), then choose an open issue with a clear scope and acceptance criteria. Comment before starting to avoid duplicated work.

Use `npm run tauri:dev` when you need the native Tauri app. A normal browser shows only the native-app notice and cannot initialize workspace, identity, relay, project, diagnostic, or MLS behavior. GitHub authentication uses the public client id and exact relay origin compiled into native Rust; no client secret is required. Use the documented native compile-time overrides only when testing a deliberate self-hosted OAuth/relay pairing.

The supported alpha desktop release target is macOS. Tauri produces only `.app` and `.dmg` bundles, matching CI and the release workflow; Windows and Linux bundles are not currently tested or published.

Make a focused change, use the [fast development loop](#fast-development-loop) for the area you touched, then run the full gate before handoff:

```sh
npm run verify
```

An optional staged-file hook runs Prettier and ESLint before a commit. Enable it per clone with `npm run hooks:install`; contributors who prefer another hook manager can leave it disabled. CI remains authoritative.

Open a PR with a cohesive, outcome-specific commit. Before submitting, check the [engineering guidelines](#engineering-guidelines) and [area-specific test requirements](#area-specific-test-requirements) that apply to your change. Security concerns belong in [SECURITY.md](SECURITY.md), not a public issue.

## Contributor guide

### Development setup

The relay loads the repo root `.env`, a relay-local `apps/relay/.env`, or an explicit `MULTAIPLAYER_RELAY_ENV_FILE`; shell-exported variables take precedence.

Run the relay or Vite frontend separately with `npm run dev:relay` or `npm run dev:desktop`. Run both development servers with `npm run dev`, and launch the usable native application with `npm run tauri:dev`. The browser-served frontend intentionally remains a native-app notice.

### Code map

- `apps/desktop/src/lib/<domain>` contains pure desktop domain and platform modules, including native adapters under `lib/platform`; files may not be added directly to the `lib` root.
- `apps/desktop/src/application/<domain>` contains store-aware workflows, while `apps/desktop/src/presentation/<domain>` contains component-facing projections and view models. Components, hooks, and stores compose those layers without making the pure library depend on UI state.
- `apps/desktop/src-tauri/src` contains native Rust commands, split by capability; `lib.rs` wires those modules into Tauri. The MLS IPC boundary keeps command orchestration in `mls_native.rs`, serde records in `mls_native/types.rs`, and invite commands in `mls_native/invites.rs`.
- `apps/desktop/src-tauri/crates/mls-core` owns MLS and residual cryptography. `engine.rs` composes focused output/error, outbound, host-transfer, exporter, and validation modules; `storage.rs` composes the MLS transaction adapter, automatic staged-write rollback guard, and encrypted application store.
- `apps/relay/src/server.ts` composes the relay from focused `http`, `ws`, and `auth` handlers plus state, persistence, limits, and lifecycle modules.
- `packages/protocol` defines shared public wire records and defaults; the Rust MLS core owns group and pairwise cryptographic operations.
- `packages/codex`, `packages/git`, and `packages/github` isolate integrations used by the desktop and relay applications.
- `docs/message-lifecycles.md` traces chat messages and Codex turns vertically through the files they touch.
- `docs/decisions` records cross-cutting architecture and trust decisions that contributors must preserve or explicitly supersede.
- `scripts` contains the small set of day-to-day maintainer entry points. Scheduled/build helpers live under `tools`, while executable journeys and operational drills live under `e2e`; do not grow `scripts` back into a second application.
- Root workspace metadata owns cross-workspace npm controls, including the Monaco/DOMPurify security override described below.

### Fast development loop

Run the smallest relevant loop while iterating, then run `npm run verify` before opening a PR. Workspace commands are run from the repository root.

| Changing                                                                                              | Fast checks while iterating                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Relay HTTP, WebSocket, auth, persistence, or limits                                                   | `npm run check -w @multaiplayer/relay` and `npm run test -w @multaiplayer/relay`; run `npm run test:fuzz -w @multaiplayer/relay` after parser/schema changes. Mutation testing of authz, sessions, WebSocket admission, and room mutations is weekly/advisory; run it locally only to reproduce that report. |
| Desktop React UI, hooks, stores, or adapters                                                          | `npm run check -w @multaiplayer/desktop` and `npm run test:smoke -w @multaiplayer/desktop`; run `npm run test -w @multaiplayer/desktop` before handoff                                                                                                                                                       |
| Browser E2E journeys or the UI-contract harness                                                       | `npm run test:e2e -- e2e/<journey>.spec.ts`; run `npm run test:e2e` before handoff. Keep simulated relay/native boundaries visible and keep the harness outside the production desktop graph.                                                                                                                |
| Two-client native invite, MLS, or handoff composition                                                 | Run the focused relay process test while iterating, then `xvfb-run -a npm run test:e2e:native` in a Linux environment with the WebKit, Secret Service, and `tauri-driver` dependencies pinned by CI.                                                                                                         |
| One shared package                                                                                    | `npm run check -w @multaiplayer/protocol` and `npm run test -w @multaiplayer/protocol`, replacing `protocol` with `codex`, `git`, or `github` as needed                                                                                                                                                      |
| Native Tauri/Rust code                                                                                | `npm run fmt:rust:check` and `npm run test:native`                                                                                                                                                                                                                                                           |
| Native packaging, Tauri config, browser windows, Keychain, terminals, or Codex app-server integration | Native checks above, then `npm run tauri:build -w @multaiplayer/desktop`                                                                                                                                                                                                                                     |
| Cross-cutting TypeScript or workspace configuration                                                   | `npm run lint`, `npm run format:check`, and the affected workspace checks                                                                                                                                                                                                                                    |

Use `npm run format` to apply the repository's Prettier baseline. `npm run verify` lints and checks formatting for TypeScript and JavaScript, type-checks, tests, checks Rust formatting, runs native Tauri/Rust tests, and builds the workspaces.

The relay fuzz suite feeds seedable arbitrary bytes, recursive JSON values, and mutated valid MLS routing records/messages through the protocol schemas. It runs 100,000 cases by default; reproduce or tune a run with `MULTAIPLAYER_RELAY_FUZZ_SEED` and `MULTAIPLAYER_RELAY_FUZZ_ITERATIONS`.

### Engineering guidelines

- Keep relay plaintext minimal. The relay may route bounded metadata and public KeyPackages, but chat bodies, attachment contents, terminal output, Codex events, Git events, browser requests, and invite approval content must remain inside opaque MLS, HPKE, Welcome, or exporter-sealed payloads.
- Prefer small, testable security boundaries over broad trust assumptions.
- Keep native project file access confined to the selected project root.
- Treat browser pages, terminal output, `.env` files, credentials, and signed-in sessions as sensitive by default.
- Log stable error codes and bounded identifiers, never request/response bodies, decrypted plaintext, tokens, keys, secrets, passphrases, or other payload objects. The diagnostics object sanitizer is a safety net, not permission to log payloads.
- Avoid adding OpenAI API quota bridging. The desktop app talks to the user's local Codex app-server instead.
- Keep cross-workspace imports aligned with each package's declared dependencies and public entry point. ESLint rejects undeclared package edges, deep imports, and relative source-tree bypasses; declare and review an intentional boundary change before using it.
- Prefer compiler-, schema-, or established-tool checks over hand-rolled source scanning. When a repository policy genuinely needs a script, consume structured input, keep the rule narrowly scoped and tested, and source volatile facts from one manifest; for example, Codex range documentation is asserted against `contracts/codex-app-server/support-policy.json` rather than maintained as an independent policy value.
- A hook earns its own file only when it is reused or owns a real React lifecycle (such as subscriptions, effects, or refs). Otherwise, inline it at its call site so the hooks directory remains navigable.
- Use Conventional Commit subjects such as `feat:`, `fix:`, `docs:`, or `chore:` so Release Please can maintain the changelog and version. Keep each commit cohesive and reviewable; split unrelated or unusually broad changes when practical.

#### Monaco DOMPurify security pin

Monaco is consumed by the desktop editor, but its DOMPurify override and the direct `dompurify` pin intentionally live in the root `package.json`. npm applies workspace overrides only from the workspace root, and the direct dependency fixes the version referenced by that override. The desktop Vite resolver directs Monaco's sanitizer import to the patched package, while `tools/security/verify-desktop-security-deps.mjs` fails the desktop build if the vulnerable bundled DOMPurify version appears in the output. Keep these pieces aligned when upgrading Monaco or DOMPurify; do not move or remove the root pin without replacing and testing the security control.

### Area-specific test requirements

Add focused tests when changing:

- relay auth, membership, rate limits, persistence, CORS, WebSocket routing, or encrypted backlog behavior;
- crypto primitives or invite payloads;
- GitHub repo, branch, PR, or Actions validation;
- desktop encrypted history, invite handling, browser policy, Codex turn assembly, Markdown export, secret warnings, terminal approvals, or workspace creation;
- native Tauri file, Git, terminal, browser, Keychain, diagnostics, or Codex app-server commands.

#### Diagnostics changes

Diagnostics changes need tests on both sides of the IPC boundary. Frontend tests should cover capture-time redaction, compound sensitive-key omission, ordered writes, and proof that native export does not return persisted records. Rust tests should cover strict request shape, JSONL corruption recovery, file permissions, retention and size limits, concurrent writes, native bundle assembly, export-time re-redaction, and safe destination writes. Do not add a command that returns persisted diagnostic entries, bundle contents, or the selected export path to the webview.

### Security reports

See [SECURITY.md](SECURITY.md). Do not put live secrets, private repo contents, real transcripts, or decrypted room payloads in issues or PRs.

## Stabilization and release operations

### Active pre-v0.1.0 stabilization window

The repository is feature-frozen from **2026-07-15 through 2026-07-22 inclusive**. During that interval, merge only fixes, deletion/simplification, documentation corrections, dependency or security updates, test repairs, and release operations. A change that adds user-visible capability resets the seven-consecutive-day stabilization clock; it is not made acceptable by calling it hardening. Before tagging v0.1.0, record seven consecutive feature-freeze days in the release PR and repeat the complete release preflight.

Future releases use the same rule: declare a minimum seven-day stabilization window, name its start/end in the release PR, and reset it after any feature merge. The PR template makes the author state whether a stabilization exception applies; reviewers decide based on the diff.

### Continuous-integration policy

`ci.yml` contains fast blocking checks: workspace lint/type/test/build, coverage reports with a focused relay authorization floor, and Rust formatting/Clippy/tests. `journeys.yml` runs UI, deterministic security, native two-client, and macOS package evidence on `main`, tags, schedules, and security-relevant pull-request paths. The single CI routing job is explicitly informational; it does not impersonate a journey result. Only jobs that execute a journey are verification evidence.

Mutation testing, parser fuzzing, extended supply-chain scans, reproducibility comparisons, soak/restore drills, and the scheduled macOS two-client run are advisory or scheduled evidence. The relay mutation policy preserves the measured `authz.ts` 100%/zero-survivor baseline and the existing 60% score/survivor ceilings for session, WebSocket-admission, and room-route decisions, with an explicit 80% target. Each weekly shard fails visibly on tooling errors or regression below its checked-in baseline. The first run each month emits a reviewable candidate that advances score floors in five-point steps and never increases a survivor ceiling; maintainers review and commit justified advances rather than letting automation rewrite policy silently. Investigate regressions; do not turn them into a Tuesday bugfix blocker without deleting or demoting an existing blocking check. No new blocking check may be added without removing or demoting another one.

The deterministic security journey fails when its Rust production boundary is unavailable. It emits a machine-readable claims manifest only after the exercised trace passes, then checks the generated threat-model evidence table against that manifest. Missing prerequisites, a missing manifest, or documentation drift must never become a skipped-success artifact. Coverage artifacts describe what ran; only explicitly documented risk floors are merge gates.

### Dependency security

Dependencies remain exact-pinned for reproducibility. Dependabot batches npm, Cargo, GitHub Actions, and relay-container updates **weekly on Monday**. Review compatible batches first; isolate major upgrades when their migration surface obscures review. GitHub/Dependabot security advisories are handled immediately rather than waiting for the weekly batch: open a focused remediation PR, run the affected tests plus supply-chain policy, and record any temporary exception with owner and removal condition.

`npm audit`, the license policy, RustSec, `cargo-deny`, CodeQL, Semgrep, Trivy, and secret scanning run on their documented schedules. Advisory-policy exceptions must identify the exact advisory, affected package, actual reachability, expiry/review date, and replacement or upstream tracking link. “No fix available” is not a permanent rationale.

### Rust panic policy

Production Rust command paths return typed errors and keep internal dependency/storage/cryptographic causes out of webview IPC. `unwrap`, `expect`, and deliberate panic are limited to tests or initialization invariants that cannot continue safely; a new use in runtime code needs a written invariant and focused failure test. Redaction/diagnostic initialization fails closed: a sanitizer construction failure suppresses the value rather than emitting unredacted content.

### Signed update channel

The alpha uses `tauri-plugin-updater` for **explicitly user-initiated** installation. Its endpoint is pinned to `releases/latest.json` on this repository's HTTPS `update-channel` branch, which the release workflow advances atomically only after publishing all assets; this works for prereleases as well as stable releases. The workflow signs a canonical metadata payload that binds the manifest version, exact archive URL, archive signature, and human notes. Rust's updater comparator verifies that envelope with `apps/desktop/src-tauri/updater-public.key`, requires every bound field to match Tauri's parsed release, and requires a strict version increase before JavaScript can receive an update. Tauri separately verifies the archive signature before installation. GitHub can suppress or replay a valid manifest, but it cannot relabel an older signed archive as a newer version without the updater private key.

The release build fails closed unless `TAURI_SIGNING_PRIVATE_KEY` and a non-empty `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are present alongside the Apple signing/notarization secrets. The private updater key must never enter the repository, logs, release artifacts, or maintainer shell history. Keep an encrypted recovery copy offline; grant the GitHub Actions secret only to the release environment, and test recovery access before each release window.

The `release.yml` publish job has `contents: write` solely to attach release evidence and update `releases/latest.json` through GitHub's atomic Contents API. Repository rules for `update-channel` must allow that GitHub Actions identity to create the branch once and update this file, while continuing to deny force-pushes and branch deletion. A rule that blocks the workflow makes channel advancement fail visibly after release publication; do not bypass it with a maintainer-written manifest.

Routine rotation uses a bridge release signed by the old key that embeds the new public key. Do not sign later releases with the new key until the supported minimum version has advanced to that bridge; clients that skip it require a manual verified update. If the old key may be compromised, stop publishing `latest.json`, revoke release-environment access, publish the incident and new public-key fingerprint out of band, and require a manual Apple/Sigstore-verified recovery install. A release signed only by the suspect key is not a safe rotation mechanism.

Release artifacts come from a validated tag through `release.yml`. The release operator runs `npm run release:preflight`, confirms the feature-freeze record, Developer ID signing/notarization, authenticated `latest.json`, updater bundle signature, cold- and warm-start universal-link behavior, checksum/SPDX-SBOM/provenance/Sigstore publication, and the two-device acceptance journey. Before publication, the Rust release verifier checks both the metadata binding and the actual updater archive signature against the committed key. The workflow also publishes advisory normalized-payload comparison evidence from an isolated unsigned rebuild; a mismatch requires investigation but is not represented as a bit-for-bit failure of signed/notarized output. If any required artifact or verification bundle is missing, the release remains unsupported.

### Relay operational floor

Before inviting users outside the maintainer's controlled alpha, the hosted relay must expose and alert on:

- SQLite filesystem free space and database size;
- WAL size/growth;
- timestamp and outcome of the last successful backup;
- backup age and restore-drill age;
- rate-limit decisions by bounded reason/route class, without identity tokens or payloads.

Use the structured operational snapshot emitted by the relay rather than scraping prose logs. Alert thresholds and destinations are deployment configuration, not source-code secrets. A process-local metric is insufficient unless the platform collects it independently of the SQLite volume it monitors.

#### Backup and restore runbook

1. Stop or isolate the writer, identify the source SQLite file, and record the deployment revision and snapshot timestamp without copying credentials or user payloads into the ticket.
2. Run `node --import tsx e2e/relay/sqlite-backup-restore-drill.mjs --data-path=/path/to/snapshot.sqlite --evidence-path=/path/to/relay-store.sqlite.backup-evidence.json` on a protected operator machine. The drill opens the source read-only, uses SQLite backup, runs integrity checks, verifies the relay table set on the restored copy, and atomically writes the timestamp consumed by `multaiplayer_relay_sqlite_backup_last_success_timestamp_seconds`.
3. Start an isolated relay against the restored copy with outbound/public traffic disabled. Confirm deletion-ledger reconciliation completes before listen, a previously deleted synthetic/approved test identity remains denied, schema/version checks pass, and the operational snapshot reports bounded write latency, WAL size, and free disk capacity.
4. Record only commit, snapshot time, drill time, result, operator, and sanitized failure category. Store the snapshot and detailed logs under the production access policy, never in GitHub artifacts.
5. Delete the temporary restored copy according to the backup-retention policy and update the monitored last-success/last-drill timestamps.

The fixture drill is a CI regression check, not evidence that a production snapshot was restored. A real production-snapshot drill remains a release/operations blocker until an authorized operator records it; repository contributors must not manufacture that claim.

#### Hosted account restriction

Account restriction is a stopped-relay/operator action, not a public administration route. Stop the writer, back up the database, run the documented restriction CLI with a bounded reason code and optional expiry, restart, and verify session/device eviction plus denial of new/restored sessions. Preserve shared encrypted records unless a separately authorized deletion operation applies.

#### Hosted-to-self-hosted migration

Deploy and validate the replacement relay, build clients pinned to its HTTPS/WSS origins, recreate teams/rooms/membership with fresh invites, and keep original devices intact until the new rooms are verified. Migration does not transfer live MLS authority, group secrets, or exporter-derived history keys; encrypted display-history archives remain a separate inert import. Announce a cutoff, revoke or expire old sessions/invites, retain the old database only for its published backup/deletion horizon, and verify the hosted exit policy before shutdown.

### Compatibility inventory

Compatibility readers need an owner and deletion condition. Current intentional readers are limited to documented Codex app-server versions, one-way legacy relay JSON-to-SQLite import, accepted local-history/archive versions, and explicitly enumerated native state migrations. Do not add a fallback that silently accepts a previous cryptographic wire format. Remove a compatibility path after its support window and migration evidence expire; update the threat model only when the trust or security boundary changes.
