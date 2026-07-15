# Engineering practices

multAIplayer is developed with AI acceleration. Fuzzing, mutation testing, cross-language contract tests, and end-to-end security journeys are compensating controls for that velocity. They make important claims falsifiable and reviewable; they do not replace maintainer judgment or an independent security audit.

## Agent-assisted maintainer workflow

MultAIplayer is maintained through an agent-assisted, policy-driven workflow. The maintainer does not treat generated code as trusted merely because it compiles or because an agent reports success. Product intent is translated into explicit repository policy, independent gates, and reviewable evidence.

### From prompt to policy

1. **Specify the outcome and threat boundary.** A work request names the user-visible behavior, protected assets, attacker capabilities, and non-negotiable invariants. Security claims are phrased as properties that can fail, not aspirations.
2. **Inspect before changing.** The agent reads repository guidance, the current implementation, prior ADRs, tests, CI, dependency state, and the working tree. Existing maintainer work is preserved.
3. **Decompose by independent evidence.** Parallel work is used only for bounded streams. One integration owner reconciles shared files and is responsible for the final result.
4. **Implement the smallest coherent boundary.** Production changes include tests, failure behavior, limits, and documentation in the same pull request. Secrets, shell authority, cryptographic state, and publishing credentials stay outside model-controlled/webview boundaries.
5. **Turn claims into gates.** Important invariants become deterministic unit/property tests, mutation policies, cross-implementation vectors, scripted journeys, static analysis, or artifact verification. Generated reports are retained when reviewers need more than pass/fail.
6. **Review the diff as hostile input.** The maintainer checks authorization placement, fallback behavior, parser ambiguity, unbounded resources, workflow permissions, dependency scripts, binary additions, and documentation drift.
7. **Verify in layers.** Fast focused checks run first, followed by repository-wide format, lint, type, test, build, Rust, security, and packaging checks. A failure is fixed or explicitly documented; gates are not weakened to obtain green status.
8. **Publish through a pull request.** Only scoped files are staged. The PR states why, impact, root cause where relevant, and exact validation. Required checks and review conversations must resolve before merge.
9. **Record durable decisions.** Architecture or security choices become ADRs. Operational limits, advisories, supported platforms, and incident expectations go in maintained documents with review dates.

### Maintainer review questions

- Can untrusted room, attachment, webpage, repository, tool, or model output reach native authority without a fresh native decision?
- Is identity, room, workspace, epoch, exact bytes, expiry, and one-time use bound at the enforcement point?
- Does normalization preserve security markers and reject ambiguous encodings?
- Are network, process, PTY, preview, and model-output paths bounded by time and size?
- Is encrypted state authenticated with canonical context, and is interoperability checked outside the implementation language?
- Does CI use locked inputs, commit-pinned actions, least privilege, and trusted artifact handoffs?
- Would a skeptical reviewer be able to reproduce the evidence from a clean checkout?

### Evidence hierarchy

Passing examples are the baseline. Property tests explore input classes; mutation tests show whether assertions distinguish security-relevant code changes; deterministic journeys prove lifecycle behavior across components; independent implementations prove wire agreement; external analyzers and supply-chain attestations add signals not authored by the same agent that wrote the feature. None of these substitutes for professional security review.

### Exceptions and follow-up

An exception must name its dependency or code path, affected platform, exposure, compensating control, rationale, owner, and review date. It must not be hidden by suppressing a scanner solely to improve a score. Deferred work is tracked in docs or issues with a concrete trigger for reconsideration.

## Rust panic policy

The Tauri backend treats data, filesystem, process, lock, and protocol failures as recoverable. Every fallible production Tauri command returns `CommandResult<T>` with the serialized `{ code, message }` contract; internal helpers may retain narrower domain errors or `Result<_, String>` until the command boundary assigns a stable code. `npm run check:tauri-command-errors` scans the complete command inventory, rejects a direct `Result<_, _>` return before it can silently bypass that contract, and verifies that the Rust serde enum exactly matches the TypeScript code union. Commands must not use `unwrap()` or `expect()` to handle runtime input or mutable external state. Frontend recovery branches on validated codes through `invokeNative`, never on message prose.

An audit on 2026-07-12 found no runtime-input `unwrap()` or `expect()` calls. A session-cache ownership assertion in `codex.rs` was converted to a non-panicking conditional, and the outer Tauri bootstrap now reports its fatal error and exits unsuccessfully without unwinding. The seven constant redaction expressions are compiled once into fallible `LazyLock` values. If any expression cannot compile, the applicable redactor replaces the entire value with a failure marker; it never returns potentially sensitive input and never panics.

The crate denies Clippy's `unwrap_used` and `expect_used` lints in every non-test build, with no exception list. This compiler-aware guard excludes `#[cfg(test)]` code without relying on a textual source scanner. Any future fallible expression, including one sourced from configuration or input, must propagate an error or fail closed without reflecting the unredacted value.

Occurrences in modules guarded by `#[cfg(test)]`, `lib_tests.rs`, and dedicated `tests.rs` files are test assertions, not shipped paths. Test fixtures may continue using `unwrap()` and `expect()` when a failure should abort the test with local context.

Review production additions by asking whether the failed condition can depend on input, external processes, the filesystem, synchronization, persisted state, or protocol peers. If it can, propagate or handle the failure. Reserve a process-level panic for an unrecoverable bootstrap failure or a repository-owned compile-time-style invariant whose fallback would weaken security.

## Continuous-integration policy

GitHub branch protection is the enforcement source; keep required checks aligned with this table.

| Workflow               | Runs                                                 | Failure means                                                                                | PR blocking                                                                                        |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| CI                     | pull requests, `main`, weekly, manual, and `v*` tags | lint, formatting, types, tests, builds, security journeys, or packaging failed | Yes for configured core checks                                                                     |
| CodeQL                 | schedule, release, manual                            | candidate vulnerability or analysis failure                                                  | No for ordinary PRs; a release-triggered failure requires immediate triage and possible withdrawal |
| npm advisory audit     | schedule, release, manual                            | high-severity advisory or integration failure needs triage                                   | No for ordinary PRs; a release-triggered failure requires immediate triage and possible withdrawal |
| Rust dependency policy | schedule, release, manual                            | either native lockfile has an advisory, or advisory/source policy failed                     | No for ordinary PRs; a release-triggered failure requires immediate triage and possible withdrawal |
| Supply-chain security  | schedule, release, manual                            | heavyweight SBOM/container scan or provenance control failed                                 | No for ordinary PRs; a release-triggered failure requires immediate triage and possible withdrawal |
| Latest Codex contract  | schedule, manual                                     | supported-latest integration drifted                                                         | No; triage compatibility work                                                                      |
| Release                | version tags, manual                                 | preflight, reproducibility, signing, packaging, or publication failed                        | Not a PR check; blocks release                                                                     |

The `Prepare release` workflow runs on `main`, opens or updates the Release Please pull request, and signs a deterministic lock-metadata synchronization commit when required. It works with the built-in Actions token; because GitHub suppresses recursive pull-request workflows for that token, a maintainer must close and reopen the generated pull request to trigger its required CI checks. An optional `RELEASE_PLEASE_TOKEN` with Contents and Pull requests read/write permissions removes that step. When the built-in token creates a version tag, the workflow explicitly dispatches the signed `Release` workflow because tag events created by that token do not implicitly start another workflow.

End-to-end evidence has four explicit tiers. `web-shell-e2e` runs Chromium UI contracts whose visible boundary banner identifies simulated relay, MLS, persistence, and native execution. The ordinary relay suite adds two independently stateful `mls-core` processes to a real validator, relay, SQLite store, and WebSocket path, but does not claim Tauri-command or durable credential-store coverage. `native-shell-e2e` runs two isolated real Linux Tauri applications through production admission, requester-process termination, a relay/SQLite recovery boundary between Commit acceptance and Welcome delivery, messaging, signed host handoff, and successor messaging with the real validator and relay. A loopback gate makes the restart boundary deterministic without fabricating responses or persisted state. After reconnect, the desktop attempts relevant durable admissions before resuming the selected boundary and blocks that continuation only while the selected room (or roomless selected team) remains unresolved; focused tests pin that ordering and isolation, and the real journey exercises it against relay and requester-process restart timing. That job mocks only GitHub authentication through the relay's test-only debug endpoint; its two identities are already team members, so it covers device MLS admission rather than GitHub OAuth or team invitation. Its JSON timing artifact and job-summary table provide operational history; CI does not encode today's stage sequence or shared-runner duration as a source contract.

`Real two-client native MLS journey` remains one stable CI job and required-check name. It always executes on `main`, scheduled/manual CI, and `v*` release tags. On pull requests it skips the expensive setup only when every changed path is narrowly classified as Markdown documentation at the repository root, under `docs/`, or at `e2e/README.md`; UI, assets, workflows, dependencies, desktop/native code, relay authorization or persistence, protocol/crypto packages, onboarding, invitations, and the journey itself all run. The successful job summary says **Not applicable** when safely skipped, so branch protection does not gain a conditional status. An absent or unclassified change list runs conservatively. Do not paper over intermittent failures with blind reruns: treat them as product races until the named stage, timing report, screenshots, and logs establish another cause.

Desktop TypeScript coverage is a separate visible CI job. It reports the complete `apps/desktop/src` surface, retains LCOV and JSON summaries, and enforces rounded full-surface minimums of 50% lines/statements, 60% functions, and 75% branches. A stricter scoped floor covers invite-link parsing/policy/approval, native invite intake, onboarding invite admission, MLS join admission, and pending-invite recovery: 95% lines/statements, 90% functions, and 80% branches. A second focused gate holds the host-side file, terminal, Codex-turn, Git workflow, and workspace-client action surface to 65% lines/statements/branches and 70% functions. Its adversarial tests emphasize project confinement, stale and symlink rejection, room/host authority races, terminal authorization and redaction, hostile identifiers, and Git/PR failure paths. These rounded floors prevent material regressions without coupling review to exact per-file fractions; they remain scoped evidence rather than a claim of uniformly deep React coverage. Lowering a floor requires an explicit reviewed policy change.

Direct `tauri-driver` 2.0.6 remains limited to Linux WebKitWebDriver and Windows EdgeDriver. The `macos-desktop` job instead uses the pinned WebdriverIO Tauri service's embedded driver in a test-only build to launch the packaged application in a real WKWebView, operate a visible Profile control, observe the Account surface, and complete a real `app_version` Tauri IPC call. It then rebuilds the production frontend without the test driver, reruns the native-core/relay/validator composition, and packages ad-hoc-signed inspection artifacts. The ad-hoc identity uses no Apple account or Developer ID certificate and allows CI to verify packaged entitlements; it does not make those artifacts trusted for distribution. WebKitGTK and WKWebView are ports of the same engine family, so frontend UI-contract evidence transfers more directly than Chromium evidence would; the IPC implementation, Keychain-versus-Secret-Service behavior, window/process lifecycle, and code-signing or entitlement effects do not transfer. The macOS composition and package lane separately cover process spawning, child stdio, validator invocation, relay networking, and bundle assembly. The smoke is boot, visible-control, and handler-level IPC evidence, not a macOS equivalent of the full Linux two-shell journey. The [end-to-end coverage matrix](../e2e/README.md) maps the boundaries and gates.

First-run onboarding enters CI through both the ordinary desktop unit/component suite and a six-case Chromium UI contract in `web-shell-e2e`. The desktop runner includes `.test.tsx` component suites. Exact-pinned axe-core WCAG 2.0/2.1/2.2 A/AA assertions gate the main chat, onboarding, and invite harness states. The focused tests cover persisted-state allowlisting and migration, readiness/error projection, create retry semantics, delegation to production invite admission with no optimistic unlock, and assistant/checklist/first-turn contracts. Playwright additionally covers equal keyboard-accessible create/join entry, persisted Explore/checklist state and Help recovery/reset, direct readiness repair, partial-create retry and safe-default disclosure, blocking join verification, and starter-prompt insertion without sending. Its visible boundary banner labels relay/authentication/native/MLS/persistence/Codex behavior as simulated, so it does not add a fifth evidence tier or prove onboarding end to end. The Linux two-shell journey now starts from focused clean-profile Welcome surfaces, selects create and join, checks intent-specific relay/GitHub/Codex readiness, submits the production workspace/room form, accepts safe defaults, submits the official HTTPS invitation through the production onboarding form, and observes real blocking device-verification guidance before host denial. The host's third-party ChatGPT readiness is deliberately advanced through an in-app test transition, GitHub uses the relay's loopback debug substitute, and the project path is entered directly rather than chosen through a platform folder picker. The macOS packaged smoke still chooses Explore and does not complete create or join. The native claims therefore remain bounded to the production handlers and real relay/MLS/storage paths actually exercised, not live provider authorization, macOS onboarding, or input-level folder selection.

Scheduled/manual CI restores and saves the native fuzz corpus across runs, then gives both the MLS KeyPackage/document parser and the Codex app-server activity projection 120 sanitizer seconds. Validator correctness, bounded execution, timeout, malformed-input, and fail-closed behavior are tested directly; the project does not maintain a shared-runner microbenchmark gate before production usage data exists.

The scheduled/manual `Relay restart and backup chaos soak` is deliberately outside ordinary pull requests. Its fixed profile runs for five minutes with 32 concurrent reconnecting clients while MLS messages continue to publish, takes a live SQLite backup, and alternates graceful and forced process restarts. Only after the source stops does it start an isolated relay from the fenced backup. It fails on SQLite integrity errors, duplicate message ids, an unexpected MLS epoch, missing newest retained traffic, unbounded metrics output, operational errors, or leaked sockets. The retained JSON reports publish and reconnect p95/p99 latency, peak active sockets, WAL growth, metrics size, restart count, and source/restore record counts. The short default command is a local smoke; neither profile is a throughput benchmark or a multi-node availability claim.

Invitation delivery and authentication add narrower automated gates. Rust and desktop tests cover the strict HTTPS invitation parser, one-shot in-memory native intake, cold/warm event ordering, intent-specific readiness, GitHub Device Flow presentation, local Codex login presentation, and provider-specific trusted-URL validation. JavaScript validation runs before requesting a browser launch and Rust validates again before the native opener invokes the system browser. Package checks require the macOS associated-domain entitlement; the release workflow also validates the live AASA documents before signing and rechecks the packaged entitlement afterward. These checks do not emulate Launch Services or prove a signed universal link reaches a cold or warm WKWebView, so that dispatch remains a manual signed-release gate. The Linux native journey's relay debug authentication remains an explicit substitution for GitHub OAuth and does not test either provider's live login.

The sole mutation job in `CI` targets relay authorization and runs only on the weekly schedule or manual dispatch, not ordinary pull requests. Relay parser fuzzing and the restart/backup chaos soak run in the same scheduled depth lane, while native parser fuzzing remains a separate scheduled job. A surviving or timed-out in-scope relay authorization mutant blocks a release-quality claim and must be fixed or explicitly reviewed. Scanner findings are not dismissed solely to make checks green: record evidence and the narrowest time-bounded suppression. Scheduled failures should create or update a maintenance issue and do not retroactively invalidate unrelated merges.

The relay security-journey tests may skip locally when Cargo is absent. CI installs pinned Rust and then inspects the JUnit evidence: both named Rust-backed journeys must be present and no skipped testcase may exist. This prevents a green but permanently skipped matrix cell.

The ordinary lint gate holds production TypeScript/JavaScript functions to the default ESLint complexity ceiling of 20. Large Rust boundaries are split by domain and reviewed through formatting, clippy, tests, dependency policy, and the structured Rust advisory ledger rather than a per-file line ratchet. The advisory workflow scans both the application/release lockfile and the separate MLS fuzz-target lockfile. Workflow tokens otherwise default to read-only: issue creation, CodeQL upload, release preparation, and artifact publication retain only their explicitly required job or single-job workflow permissions.

## Dependency security

The repository checks JavaScript and native dependency advisories independently. `npm audit --audit-level=high` evaluates the committed npm lockfile, including development dependencies used to build and package the app. It runs every Monday and on releases so newly published high or critical advisories fail CI even when the lockfile has not changed. Rust dependencies are checked against RustSec on the same cadence. The native audit scans both the release/application `Cargo.lock` and the independent MLS fuzz-target lockfile; `cargo-deny` enforces advisory and source policy against both manifests.

The desktop release target is macOS. Linux is a development and CI compatibility target, not a supported alpha release target. Cargo's target-independent lockfile nevertheless records the Linux GTK/WebKit dependency graph. In the current Tauri 2.11 line, `glib 0.18.5` is pulled through `gtk 0.18.2` by Tauri, Wry, WebKitGTK, and their menu/runtime crates; it is not a direct dependency and cannot be upgraded independently. Recheck that path with `cargo tree --locked --target all --manifest-path apps/desktop/src-tauri/Cargo.toml -i glib@0.18.5` whenever Tauri/Wry are updated and at least monthly while an advisory remains open. Do not suppress a GTK-family advisory merely because Linux is not shipped: record its RustSec id, full dependency path, platform exposure, rationale, owner, and next review date in the tracking issue, and continue the scheduled Rust audit.

The versioned [`deny.toml`](../deny.toml) contains the narrowly named cargo-deny exceptions. The structured [Rust advisory policy](../.github/rust-advisory-policy.json) is their review ledger: it records the owner, exact packages and RustSec ids, dependency paths, platform exposure, reachability assessment, disposition, and next review date. Repository hygiene requires the ledger to cover exactly every cargo-deny exception, separately track the visible glib warning, contain the required assessment fields, and have a review date that has not expired. Its GTK3 entries (`RUSTSEC-2024-0411` through `RUSTSEC-2024-0420`) are confined to the Linux Tauri/Wry/WebKit graph. `cargo audit` separately reports the glib unsoundness (`RUSTSEC-2024-0429`); neither multAIplayer nor its downloaded transitive dependencies call the affected `VariantStrIter` API. The proc-macro and `rust-unic` entries (`RUSTSEC-2024-0370`, `RUSTSEC-2025-0075`, `RUSTSEC-2025-0080`, `RUSTSEC-2025-0081`, `RUSTSEC-2025-0098`, and `RUSTSEC-2025-0100`) are unmaintained transitive build/URL-pattern crates with no safe application-selectable replacement. These are explicit, reviewable exceptions—not a lower advisory severity—and expire for maintainer review on 2026-08-01 or sooner when Tauri/Wry changes. `cargo audit` runs first so the complete advisory signal remains visible in every CI log.

During the public alpha, direct npm and Cargo dependencies are exact-pinned to the versions in their committed lockfiles. Monthly Dependabot version-update batches cover routine compatible and major review work; they are not the vulnerability-response control. Repository-level Dependabot security updates must remain enabled so an eligible vulnerable dependency can receive an immediate security PR, while the independent Monday npm/Rust advisory jobs detect lockfile findings whether or not Dependabot can generate an update. GitHub Actions updates are also batched. A major batch is an owner decision, not routine maintenance: inspect upstream migration notes and transitive changes, update affected compatibility documentation and fixtures, and run the complete CI/release-relevant gate before merging. This is not a second-person approval requirement—the project has one maintainer—but major batches must remain visibly distinct from compatible updates. Security fixes may be split out and expedited when waiting for a major batch would leave a reachable vulnerability.

High and critical npm findings are blocking. Prefer upgrading, replacing, or removing the affected dependency. If no remediation exists and the vulnerable code is demonstrably unreachable, open a public tracking issue that records the advisory, affected dependency path, reachability analysis, compensating controls, owner, and an expiry no more than 30 days away. Any temporary CI exception must reference that issue, name only the specific advisory, and be removed at expiry; lowering the repository-wide audit level is not an acceptable exception.

The relay container is scanned without `ignore-unfixed`. Temporary Trivy exceptions live in the versioned `.trivyignore.yaml`, name each advisory, state why the affected base-image code is not reachable from the non-root Node relay, and expire within 30 days. The current entries cover Debian utilities and Node-bundled Undici in the latest verified `node:24-bookworm-slim` digest; they must be removed when a patched Node 24/Debian digest is available and may not be replaced with a blanket severity or unfixed-advisory suppression.

Coverage is measured for every shared TypeScript package, the relay's security-critical authorization and limit modules, and the complete desktop TypeScript surface. Each package has explicit line, function, branch, and statement floors appropriate to its current test surface. Desktop-wide coverage is reported without an artificial whole-app gate; invite-link, native-intake, onboarding admission, MLS join-admission, and pending-invite recovery modules share a focused 95% line/statement, 90% function, and 80% branch floor. Rust MLS behavior is covered by its native lifecycle, persistence, HPKE, and crash-safety tests. Generated reports are retained as CI artifacts. Threshold reductions require an explicit rationale in the pull request and must pass the repository's required checks.

The native Codex JSON-RPC classifier is exercised generatively in the ordinary locked Rust suite. The pure bounded activity projector also lives behind the lightweight `codex-activity-projection` workspace crate so cargo-fuzz can feed arbitrary app-server method/value pairs through the exact production implementation without compiling Tauri/GTK into the sanitizer target. Its committed command-completion seed starts beyond the outer JSON shape; accepted output is serialized and unknown fields or secret sentinels must not be reflected.

The relay boundary has deterministic seeded parser fuzz targets in the weekly/manual relay security-depth workflow. Fast-check calls the real WebSocket parser and the exact strict HPKE-directed invite-request parser with raw UTF-8, recursive JSON, structure-aware canonical records, and truncated, reordered, extra-key, or bit-flipped variants. Canonical messages must survive unchanged; malformed inputs may be rejected but must not crash. Checked-in corpora fix representative accepted and rejected frames. The store codec separately normalizes arbitrary record-shaped decoded documents and verifies idempotence. Replay a failure with `MULTAIPLAYER_RELAY_FUZZ_SEED` and `MULTAIPLAYER_RELAY_FUZZ_PATH`, tune the run count with `MULTAIPLAYER_RELAY_FUZZ_ITERATIONS`, and preserve minimized failures as fixed regression cases.

The native fuzz package has two targets: the exact bounded raw JSON/credential/RFC 9420 KeyPackage path used by `mls-keypackage-validator`, and the production Codex app-server activity projector described above. Scheduled/manual CI restores the lockfile-keyed corpus, runs each target for 120 seconds, saves the grown corpus under a unique immutable cache key, and uploads crash artifacts. Only trusted scheduled/manual runs write that cache. Periodically minimize valuable growth with `cargo +nightly fuzz cmin <target>` and commit durable seeds. Run either target locally from `apps/desktop/src-tauri/crates/mls-core` with `cargo +nightly fuzz run <target>`. OSS-Fuzz enrollment is maintainer-owned and triggered before the first non-alpha release in the compatibility inventory.

The relay keeps KeyPackage validation in a separate process for each low-frequency upload. Functional, timeout, malformed-input, and fail-closed tests guard that boundary. The project deliberately does not maintain a validator microbenchmark gate before real usage data exists; if upload latency becomes material, production measurements should drive whether a stateful framed process is justified.

Large native boundaries keep their public composition modules stable while placing focused implementation seams beside them: Codex version/manifest compatibility lives in `codex_account/compatibility.rs`, diagnostic validation and redaction in `diagnostics/redaction.rs`, and each large boundary's tests in its adjacent `tests.rs`. This keeps process/lifecycle orchestration separate from pure policy code and makes security-relevant changes easier to review without changing Tauri command APIs.

Large Rust security boundaries are split into cohesive submodules for protocol, persistence, and native-integration review. The repository deliberately avoids a per-file line ratchet: physical length is not a semantic invariant, and a threshold pinned to today's files invites threshold-only maintenance. Formatting, clippy, focused tests, dependency policy, and human review guard these modules instead.

The root Stryker override forces its development-only `typed-rest-client` dependency to resolve `qs` 6.15.3, patched for GHSA-q8mj-m7cp-5q26. Upstream currently pins vulnerable `qs` 6.15.1 exactly, so npm may label the deliberately overridden edge as outside that stale constraint even though the lockfile and installed code contain the compatible patched release. Express resolves through the same patched `qs` line. Keep the override until `typed-rest-client` accepts 6.15.2 or newer; verify the resolved lockfile, `npm audit`, and the relay authorization mutation suite before removing or changing it.

The scheduled latest-Codex job installs the current published Codex CLI, generates its app-server schema, and compares its contract with the supported 0.144.0 baseline. It also starts the real app-server with a bounded timeout, completes the JSON-RPC initialization handshake, and exercises `model/list`. Removed request ids, methods, capabilities, authentication modes, approval modes, or thread-item types, as well as runtime handshake or response-shape failures, fail the job. A failure opens one marker-deduplicated issue with the observed version and run output. The workflow has read-only repository access except for issue creation; passing this forward-compatibility check does not automatically expand the supported version range.

## Compatibility inventory

Last audited: 2026-07-14

This inventory covers runtime code labelled `legacy`, `deprecated`, or `compat`. General statements about platform or Codex-version compatibility and historical ADRs are not compatibility shims. A compatibility path needs an explicit retained contract and a removal condition; a reject-only parser is distinguished from a reader that accepts old data.

| Boundary | Current decision | Removal condition |
| --- | --- | --- |
| Encrypted history flat `codexThreadId` | Read once in `localRoomHistoryPayload.ts`, normalize to `codexThreadGraph`, and never write the flat mirror again. Runtime state is graph-only. | Remove the one-way reader at the next announced encrypted-history reset or stable-format break after all supported alpha builds have emitted graph-only history. |
| Browser auto-approval helper | Removed. The unused legacy helper could still return `true`, despite the current product requiring an explicit browser approval. | Complete in this audit. |
| Pre-v3 invite URL shapes | `inviteUrl.ts` recognizes the bounded old shape only so onboarding can reject it with a useful error. It never joins or derives secrets from it. | Replace with the generic invalid-invite error after the public-alpha invite transition window closes; no security reader must be reintroduced. |
| Pre-v2 debug chat records | `isLegacyDebugChatMessage` drops old diagnostic records during history normalization and relay receipt. | Remove with the same encrypted-history reset as the flat thread-id reader. |
| Pre-activity encrypted history | A history payload without `codexActivities` normalizes to an empty timeline; no activity or raw upstream object is fabricated. | Make the field required and remove the fallback at the same encrypted-history reset as the other history readers. |
| Missing Codex catalog-policy fields | Room, relay-store, and handoff normalizers interpret an absent policy as `pinned`, preserving the selection an old record actually made. | Remove when the room/store wire schema requires all three policy fields and the hosted relay no longer accepts records created before that schema version. |
| Former member-approval policy values | The protocol still decodes `members_can_approve` and `trusted_members_only`, but the authorization boundary treats them as display-only and only the active host can approve. | Delete the enum values and labels in the next breaking room-wire version after persisted records are normalized to `host_only` or `members_can_request`. |
| Browser-origin room metadata | `browserAllowedOrigins` remains a decoded room setting and room-event display value, but it cannot restore the removed browser auto-approval behavior. | Remove the setting and event discriminant in the next breaking room-wire version if restricted browser context no longer uses the origin list for Codex risk/context projection. |
| Older Codex approval request methods | `execCommandApproval` and `applyPatchApproval` remain in native validation/projection and the dialog because they occur in the declared supported app-server fixtures. | Remove each method when `minimumSupportedVersion` advances past the last checked-in fixture that exposes it; the schema-contract test is the gate. |
| Relay JSON-to-SQLite import | A former default JSON store is imported transactionally once, marked, and renamed. Explicit JSON storage remains a development/migration option. | Remove implicit import after an announced release has required SQLite for one full migration window and operator documentation no longer promises automatic import. Explicit development JSON support is a separate product decision. |
| Relay HTTP error adapter | `http/errors.ts` adapts handlers that have not yet moved to the typed error contract. | Remove when every relay HTTP handler returns the typed error shape directly and route tests cover every error code. |
| Display-name authorization fallbacks | A few room/host records retain names for presentation while stable user ids remain authoritative. | Remove authorization fallback fields in the next breaking room-wire version once every producer and persisted relay record requires stable user ids. Display names may remain presentation metadata. |
| Xterm module export adapter | `TerminalPanel.tsx` accepts the package's named/default export layouts; this is dependency-module interop, not stored-product compatibility. | Remove after the exact-pinned xterm package exposes one verified export shape on every supported bundler/runtime target. |
| Codex version range | Generated fixtures and `support-policy.json` define the supported app-server range. User-facing docs are asserted against that manifest by `codex-schema-contract.test.mjs`. | Advance deliberately with new fixtures and review; do not remove the compatibility boundary while app-server is upstream and versioned independently. |
| OSS-Fuzz enrollment | Deferred while the project remains alpha; scheduled sanitizer runs retain corpus continuity for the native KeyPackage and Codex projection targets in the meantime. Owner: maintainer. | Prepare and submit the OSS-Fuzz integration before the first non-alpha release, with reproducible builds, seed corpora, and disclosure routing reviewed. |

### Compiler migrations

`noUncheckedIndexedAccess` is enabled repository-wide. The initial migration fixed every indexed lookup surfaced by TypeScript and the workspace check is the enforcement gate.

`exactOptionalPropertyTypes` remains staged rather than silently enabled. The maintainer owns the migration, triggered before protocol/store schema v2 or the first stable release, whichever comes first. The prerequisite inventory must define omitted, explicit `null`, and `undefined` semantics across HTTP JSON, WebSocket records, encrypted history, JSON/SQLite persistence projections, and Tauri IPC. Completion means enabling the flag in the base configuration and every applicable override with serialization compatibility tests green; this paragraph is removed when that gate lands. Until then, `strict` plus `noUncheckedIndexedAccess` provides the highest-leverage record-map protection without an ambiguous wire change.

### Relay normalizer consolidation assessment

`store-codec-normalizers.ts` already uses protocol Zod schemas at leaf wire boundaries. Its remaining manual code performs ordered cross-record checks, expiry and pruning, canonical base64/SPKI/HPKE validation, relational compatibility defaults, and store-wide consistency decisions. Moving those behaviors into stateful transforms or `superRefine` closures would obscure which fallback protects which compatibility boundary and is unlikely to shrink the implementation. A wholesale Zod rewrite is therefore deferred. Reconsider only a small pure leaf extraction when it demonstrably reduces lines and improves readability while the existing property/idempotence tests remain unchanged; owner: maintainer.

## Release and relay operations

This is the living maintainer runbook for release readiness, public alpha publication, official relay deployment, and hosted-to-self-hosted migration. Keep operational changes here instead of creating another launch checklist. User deployment details remain in [self-hosting.md](self-hosting.md); security claims remain in [threat-model.md](threat-model.md).

### Release readiness

Before opening a release candidate PR, tagging, or publishing artifacts, run:

```bash
npm run release:preflight
```

This covers the TypeScript and Rust verification suites, package/application builds, license checks, environment/toolchain checks, and a fixture SQLite backup/restore drill. The exact blocking and scheduled jobs are documented in [Continuous-integration policy](#continuous-integration-policy).

Release Please maintains [the project changelog](../CHANGELOG.md), workspace versions, release pull request, version tag, and GitHub Release from Conventional Commit subjects. Its `extra-files` configuration updates exact internal npm pins together with the Tauri Cargo version; the Codex app-server client reads its own package version directly. The workflow then deterministically regenerates npm lock metadata, synchronizes the native Cargo lock package version, and signs that follow-up commit. Repository contracts cover the JSON targets, while `npm run check:release-versions` uses Cargo metadata with the locked dependency graph to verify the native package and lockfile semantically. Review the resulting diff on every generated release pull request. With the built-in Actions token, GitHub suppresses recursive pull-request workflows, so a maintainer must close and reopen the generated pull request to create the required CI event. An optional fine-grained `RELEASE_PLEASE_TOKEN` with repository Contents and Pull requests read/write access removes that step. When the built-in token creates the tag, the preparation workflow explicitly dispatches the signed-artifact workflow. Merging the generated pull request attaches the notarized app, checksums, SBOM, and attestations to the generated release. Do not maintain point-in-time release-note drafts in `docs/`.

Before a wider alpha, manually verify on two Apple silicon Macs running macOS 11 or later and two GitHub accounts:

- first-run create and join readiness, GitHub Device Flow in the system browser, local Codex/ChatGPT browser or device login, cancellation, and copy-link recovery when the browser cannot open;
- a signed, installed build receiving the official HTTPS invitation as both a cold start and a warm-app activation, including the explicit alternate-host retry after installation; confirm that neither app nor website logs, storage, analytics, or network requests contain the fragment;
- KeyPackage publication, capability invite approval, Welcome join, encrypted chat, attachments, MLS removal, epoch advancement, and removed-device exclusion;
- project selection, file/diff inspection, Codex approval, terminal and browser approval;
- Git branch, commit, push, draft PR, and Actions status;
- active-host handoff, including a simulated Codex usage limit;
- a relay restart with durable encrypted sessions; and
- the limitations in [alpha-limitations.md](alpha-limitations.md) against the release notes; and
- the bundled Rust KeyPackage validator path and fail-closed production startup.

Do not present the alpha as externally audited, production-ready, enterprise compliant, or capable of retroactive erasure or synchronized identity recovery.

### Maintainer-owned launch decisions

Decide and record the official website, relay HTTP origin, relay WebSocket URL, GitHub OAuth owner/scopes, hosting provider, release cadence, support expectation, disclosure contact, and Apple signing identity. Do not ship a desktop build until these operator-owned values are configured. Use this shape when recording the final values:

```text
Website: https://multaiplayer.com
Relay provider: Railway
Relay API: https://relay.multaiplayer.com
Relay rooms: wss://relay.multaiplayer.com/rooms
GitHub scopes: read:user repo
Desktop support: Apple silicon, macOS 11 or later
```

The official alpha deliberately supports both public and private repositories. Disclose that GitHub's broad `repo` scope covers repositories the signed-in user can access. Codex/OpenAI credentials never belong in the relay: Codex uses the active host's local app-server.

The desktop release build should set `VITE_RELAY_HTTP_URL` and `VITE_RELAY_URL` to the final hosted endpoints, and its CSP must allow exactly those origins. Publish `https://<official-site>/releases/latest.json` for each release; set `security: true` for security fixes.

The official invitation transport is an HTTPS universal link, not a custom URL scheme. Before signing, publish no-redirect Apple App Site Association files on both `multaiplayer.com` and `open.multaiplayer.com` for exactly `/invite` and `/invite/`, with the release Team ID and bundle id `com.multaiplayer.desktop`. The canonical link is `https://open.multaiplayer.com/invite#invite=<id>&multaiplayerJoin=<capability>&approval=request`; all invite material stays in the fragment. The apex host is the explicit retry target after installation. `npm run verify:aasa` checks the live association files, and the package checks verify that the associated-domain entitlement is present. Those checks establish configuration shape, not operating-system dispatch: the cold-start and warm-app cases above remain signed-release manual checks.

### Official relay deployment

The official free-alpha relay is deployed on Railway at `https://relay.multaiplayer.com` (`wss://relay.multaiplayer.com/rooms`). It is not release-ready until this runbook's persistence, secrets, TLS/WSS, monitoring, OAuth, and backup/restore gates pass. Railway builds `apps/relay/Dockerfile` from `main`; `railway.json` disables Serverless sleeping and pins the deployment health check, restart policy, drain timing, and the single San Francisco replica. Keeping the relay warm removes wake-up latency but bills its continuous actual CPU and memory use; the Railway project-level hard spending limit remains the cost backstop. The service uses Railway-managed secrets and a 5 GB persistent volume mounted at `/data`, with SQLite at `/data/relay-store.sqlite`. Railway is an infrastructure processor, not an additional identity provider or plaintext room-content service. The official relay is a stronger operational commitment than a local self-hosted instance: retain rollback support, health checks, backups, and logs with redaction controls. It deliberately runs one writer and one process; scale vertically or shard whole teams across independent relays under the [single-node relay decision](decisions/single-node-relay.md). A second replica is blocked on shared persistence/attachment coordination and both the implementation and required adversarial acceptance suite in the accepted [edge plus atomic shared-store rate-limiting contract](decisions/multi-instance-rate-limiting.md).

Railway's public edge must be the only public path to the service. It terminates TLS/WSS and supplies the trusted client IP; the service must not expose a bypass domain or public origin that accepts direct traffic. Configure coarse IP request/connection controls at the platform edge, strip incoming forwarding headers, and test that a client-supplied `X-Forwarded-For` cannot select its limiter identity. The in-process limiter remains enabled as defense in depth.

Start from `.env.example` and set production values in the same environment that launches the relay. The critical shape is:

```bash
NODE_ENV=production
PORT=8080
RAILWAY_RUN_UID=0
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT=https://t3.storageapi.dev
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET=...
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION=auto
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID=...
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY=...
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_URL_STYLE=virtual-host
MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_PREFIX=relay-deletions/v1
MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY=...
MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS=7776000
MULTAIPLAYER_RELAY_STORAGE=sqlite
MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite
MULTAIPLAYER_MLS_VALIDATOR_PATH=/app/bin/mls-keypackage-validator
MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://multaiplayer.com,https://open.multaiplayer.com
MULTAIPLAYER_RELAY_REQUIRE_AUTH=true
MULTAIPLAYER_RELAY_DEBUG=false
MULTAIPLAYER_RELAY_STRUCTURED_LOGS=true
MULTAIPLAYER_RELAY_RATE_LIMITS=true
MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS=true
MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED=true
```

The relay stores token-free identity sessions; it has no OAuth-token encryption secret to generate or rotate. Configure all size, retention, upload, rate, connection, and room quotas from `.env.example`; do not copy a stale second list into this guide.

Pin `PORT=8080` and target both the generated and custom Railway domains at port `8080`; otherwise a stale domain target can pass Railway's internal health check while returning `502` publicly. Railway volumes are mounted as `root`, so Railway's documented `RAILWAY_RUN_UID=0` override is required for the relay to write SQLite data under `/data`. This grants root only inside the isolated service container; it does not grant host or Railway control-plane access. Reassess the override if Railway adds managed non-root volume ownership or the image gains a verified privilege-dropping entrypoint.

Run in the deployed environment:

```bash
NODE_ENV=production node scripts/doctor.mjs --production-relay
```

The doctor must pass before the endpoint is advertised. Also verify:

- `/healthz` reports process health and `/readyz` becomes not-ready during shutdown;
- WebSocket upgrades reach `/rooms` and enforce the exact browser origin;
- a staged drain rejects new HTTP/WS work, closes sockets with `1012`, and flushes storage;
- `/metrics` contains bounded counters and publish, WebSocket-send, and SQLite-write latency histograms rather than room content;
- SQLite is mounted persistently outside `/tmp` and a staged backup restores successfully;
- the Railway Bucket deletion ledger is outside the SQLite volume/backup set, startup reconciliation succeeds, and a staged pre-deletion backup cannot resurrect the deleted identity;
- rate and quota failures are observable without plaintext payloads; and
- relay storage and traffic contain no plaintext transcripts, attachments, repo files, terminal output, Codex/OpenAI credentials, or plaintext GitHub tokens.

Trust proxy headers only when a documented reverse proxy strips client-supplied forwarding headers and writes its own. Railway documents `X-Real-IP` as the client address supplied by its public edge, so the official Railway deployment sets both proxy variables true. Other deployments must keep both false unless their proxy provides an equivalent guarantee.

#### Backup restore and deletion replay

Never restore directly into the public service. Create an isolated Railway service/environment with no public domain, attach the restored SQLite copy, and inject the same deletion-ledger bucket plus HMAC key. Run `npm run build -w @multaiplayer/relay` and then `npm run deletions:reconcile -w @multaiplayer/relay`. The command must exit zero before any domain or traffic is attached. It authenticates every active tombstone, compares all primary-state identities regardless of local applied markers, reapplies deletion, and commits the resulting state. A blocker means the restored snapshot predates required ownership transfer or host handoff; keep it isolated and use a safe snapshot or resolve ownership before retrying. Record the Railway snapshot id, SQLite integrity result, tombstone/pending/deleted/pruned counts, and operator. Start normally and verify readiness only after that evidence is retained.

The production snapshot maximum is 7,689,600 seconds (89 days); every tombstone uses a 7,776,000-second (90-day) protection horizon to provide scheduling/clock margin. A delayed reconciliation appends a fresh tombstone before primary cleanup, extending coverage from the time data is actually removed rather than relying on the original request date. Startup deletes each external tombstone and its matching primary applied marker only after that object's `protectUntil`. Until the newest object expires, the deleted GitHub identity cannot sign back in. Do not reduce the horizon below the longest backup retention or rotate/lose the HMAC key while protected backups exist.

#### Relay rollback

Keep the previous artifact and a pre-deploy SQLite backup. A rollback that restores SQLite must follow the isolated deletion-replay procedure above before traffic resumes; restoring SQLite alone is prohibited because it can resurrect deleted identity data. If authentication, storage, or WebSocket routing fails, remove the official relay from public copy and direct users to self-hosting. If plaintext leakage is suspected, stop the relay, preserve evidence privately, and follow `SECURITY.md` instead of opening a public issue.

### Hosted account restriction

Account restriction is an operator denial control, not deletion or moderation of encrypted history. It prevents a GitHub identity from creating a new relay session, invalidates restored session cookies at startup, and leaves shared teams, rooms, MLS ciphertext, encrypted attachments, and device-local copies unchanged. Use a short non-sensitive reason code; do not put reports, names, or support notes in the relay database.

The CLI is deliberately offline because the relay has one authoritative writer. Stop and fence the relay, back up SQLite, build the relay, then run:

```bash
npm run build -w @multaiplayer/relay
npm run restrictions:manage -w @multaiplayer/relay -- \
  restrict github:123456 abuse \
  --data-path=/data/relay-store.sqlite \
  --storage=sqlite \
  --confirm-relay-stopped
```

An optional `--expires-at=2026-08-01T00:00:00.000Z` makes the restriction temporary. Expired restrictions fail open to normal authentication and are omitted when state is normalized. To remove a restriction:

```bash
npm run restrictions:manage -w @multaiplayer/relay -- \
  unrestrict github:123456 \
  --data-path=/data/relay-store.sqlite \
  --storage=sqlite \
  --confirm-relay-stopped
```

Restart one relay writer, verify `/readyz`, and confirm the affected identity receives `account_restricted` from GitHub verification while another test identity can still authenticate. The in-process restriction control performs immediate socket, presence, auth-session, device-session, and challenge eviction when an embedded operator invokes it; no public or loopback HTTP administration route exists.

### Signing, provenance, and publication

Release tags should be signed with `git tag -s` and verified with `git tag -v`. The release workflow requires these GitHub secrets:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
KEYCHAIN_PASSWORD
```

It builds only `aarch64-apple-darwin`, verifies that the executable is arm64-only and declares `LSMinimumSystemVersion` 11.0, then verifies Developer ID signing and stapled notarization, runs Gatekeeper checks, writes checksums, emits an SPDX SBOM, records build-provenance attestations, and keyless-signs the checksum manifest and SBOM with Sigstore. Missing signing secrets fail the release; do not publish ad hoc or unsigned local builds as public artifacts.

The release lane validates the live AASA documents before the Developer ID build and verifies the packaged associated-domain entitlement afterward. Keep `APPLE_TEAM_ID` synchronized across signing, the AASA application identifier, and the ten-character Team ID validation. The ordinary macOS CI package uses Tauri's ad-hoc (`-`) identity, which requires no Apple account or personal certificate and proves that the entitlement was assembled into the code signature. Only a Developer ID-signed, installed application whose Team ID matches the live domains can prove macOS universal-link routing.

Use [reproducible-builds.md](reproducible-builds.md) to compare the unsigned application payload. Signed/notarized archives are not claimed to be bit-for-bit reproducible.

Before announcement, verify the update manifest, release notes, artifact digests, signature/notarization status, SBOM/provenance attachments, hosted relay, and two-person dogfood result. Ordinary bug reports should use the bounded redacted diagnostics export; never request invite fragments, credentials, transcripts, terminal output, browser content, or private source by default.

### Hosted relay exit policy

Give at least 30 days' public notice before a planned official hosted relay shutdown. During the notice window, keep sign-in, relay connectivity, and these instructions available unless an emergency security, legal, provider, or private-data incident makes that unsafe. Emergency notice may be shorter only for those reasons and should preserve the minimum safe migration path.

The relay is not the source of truth for project folders, Git history, MLS private state, or device-local encrypted history. Migration recreates relay-side teams, rooms, memberships, sessions, invites, backlog, and blobs.

### Hosted-to-self-hosted migration

Choose a quiet window and keep every original device intact. Before cutover:

1. Deploy the destination using [self-hosting.md](self-hosting.md), persistent storage, HTTPS/WSS, and a passing production doctor.
2. Build a desktop whose CSP allows the destination HTTPS and WSS origins.
3. Back up the destination relay and verify `/healthz`, `/readyz`, `/rooms`, restart persistence, and content-free logs.

On the coordinating device, change the Settings relay HTTP and WebSocket URLs, sign in again, and recreate the team and rooms. Generate fresh capability-authenticated invites; never copy old invite links or fragments into public logs, issues, or chat.

For every member/device:

1. Keep the old room locally until the replacement works.
2. Switch relay URLs and sign in to the new origin.
3. Join with a fresh private invite.
4. Send and receive an encrypted test message and attachment.
5. Confirm retained local history remains readable.

With two members, verify the active host, Codex approval, session persistence, member removal, and future-traffic exclusion. After all members join, issue an MLS Update Commit and verify every eligible device advances while removed or stale devices do not.

If a device cannot read retained history, stop before clearing rooms or reinstalling: the relay cannot reconstruct MLS state or exporter-derived history secrets. Until encrypted export/import ships, preserved devices are the continuity mechanism.

#### Migration rollback

Before final cutover, members can switch Settings back to the hosted origins and continue in the original rooms. Messages sent only through the destination are not copied back automatically. Keep the hosted rooms quiet during observation, then publish the cutover time and retain the old service for the promised notice window.

### Maintenance rules

- Update this guide when a release workflow, production doctor check, relay default, or migration behavior changes.
- Keep exact environment defaults in `.env.example` and [self-hosting.md](self-hosting.md), not duplicated here.
- Keep CI, dependency/security automation, compatibility decisions, and release operations together in this guide; keep security boundaries in [threat-model.md](threat-model.md).
- Run `npm run verify` before release handoff.
- Before a non-alpha claim, require independent cryptography review, production-scale persistence/rate limiting, recurring multi-device adversarial journeys, and documented release-key custody.
