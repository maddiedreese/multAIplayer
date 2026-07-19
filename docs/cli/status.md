# multAIplayer CLI development status

Plan version: 1.1
Decision set: 1.1
Baseline: `156c55e51ab2db9d00c8eb418c4443a55ddb739e`  
Current phase: CLI-170 external-alpha readiness review
Implementation authorization: Delegated to CLI-000 within the approved runbook
Last update: 2026-07-19

## Current state

- Desktop pre-release `v0.1.0-alpha.7` exists.
- CLI governance worktree: `/Users/maddiedreese/Documents/MultAIplayer-cli`.
- Codex project: `MultAIplayer-cli`.
- Governance branch: `codex/cli-governance`.
- The CLI scaffold, strict Rust protocol parity layer, GitHub authentication,
  secure device identity, authenticated relay transport/workspace reads,
  durable MLS client state/outbox, room creation with host-local project
  association, secure host-mediated admission, encrypted chat, durable
  reconnect/replay/history recovery, and approved host-local Codex turns are
  present; privileged request approvals, bounded shared activity, mixed
  desktop/CLI interoperability, and security hardening are complete, while
  signed CLI packaging and external-alpha readiness remain.
- CLI-000 is the authorized program orchestrator.
- CLI-010 is complete and integrated. Its accepted task commit is
  `2490d71fa71696ffdd692e9950b4c93327c959be`; integration merge
  `d7fd5d73e9f6b612a904cc8f4e639be9b89751fb` passed 23 CI tests, 21 release-tool
  tests, documentation checks, the CLI isolation check, and the protected-path
  audit. The task's full `npm run verify` also passed before integration.
- CLI-020 is complete and integrated. Its accepted task commit is
  `fc54881490473d9f2aab7ff822c5560041315af6`; integration merge
  `9d0e71b154fc59c9bdfc783da9f8df36ff699b0c` passed CLI formatting, Clippy,
  two unit tests, bounded help/version checks, 18 classification/isolation tests,
  and the protected desktop-release audit.
- CLI-030 is complete and integrated. Its accepted task commit is
  `09cddb0c6734844e6457a86ccd9d24f601b0e055`; integration merge
  `c9471059b0ee06a25e3be2f050a884069c1af566` passed Rust formatting,
  warnings-denied Clippy, 11 locked CLI/protocol tests, protocol typecheck and
  build, 27 TypeScript protocol tests, fixture drift verification, the CLI
  runner, 18 classification/isolation tests, and the protected desktop-release
  audit. The task's full `npm run verify` also passed before integration.
- CLI-040 is complete and integrated. Its accepted task head is
  `3ac746dd3de9f4ca310624911c7450a8436b3629`; integration merge
  `8f2e0016f8a0a0c0adee875e005cd10fc5a5980f` passed the CLI runner with 30
  locked CLI/protocol tests, 18 classification/isolation tests, focused relay
  device compatibility, 33 `mls-core` tests, the durable identity lifecycle
  test, dependency advisories/sources/license audits, Apple Keychain selection,
  origin-binding/redaction/logout audits, and the protected desktop-release
  audit.
- CLI-050 is complete and integrated. Its accepted task commit is
  `27cf278d2c35a10047da1e41dfe79b25d1a46a32`; integration merge
  `f7abf8d92fd570d41d99edb8ded5991d39cda6d0` passed the CLI runner with 48
  locked CLI/protocol tests, 90 focused existing relay/desktop compatibility
  tests, 18 classification/isolation tests, protocol build, advisories and
  source checks, RustSec and license audits, Apple-silicon Rustls dependency
  verification, acknowledgement/origin/redaction audits, and the protected
  desktop-release audit.
- CLI-060 is complete and integrated. Its accepted corrected task head is
  `18bed5501c4e9204a58432810318ae790d9d8272`; integration merge
  `6f97a247fd9889a2dee59681ed41382e13b14367` passed the CLI runner with 63
  locked tests, all 52 `mls-core` tests, 25 focused desktop MLS tests, 25
  focused relay tests, 27 protocol tests, 18 classification/isolation tests,
  dependency advisories/source/license audits, durable state/outbox and
  crash-replay review, secret-lifetime review, and the protected
  desktop-release audit.
- CLI-040-R1 is complete and integrated. Its accepted task commit is
  `58207abb3f8ca53c14b377a1483b42257e19d59b`; integration merge
  `a20836f6f67ff98e7b9275797f2b7e0a34697958` passed the CLI runner with 65
  executed tests, all 52 `mls-core` tests, 18 classification/isolation tests,
  and the protected release audit after independent review. The task also
  passed 1,000 serial identity runs, 12,800 parallel generation/restoration
  cycles, repeated durability/rollback matrices, 695 desktop frontend tests,
  244 desktop native tests, relay/protocol compatibility, and dependency audits.
  The correction left-pads minimally encoded valid P-256 scalars without retry,
  entropy replacement, public-key change, contract change, or dependency change.
- CLI-070 is complete and integrated. Its accepted corrected task head is
  `1485adc99ebea9987c601c82065223dd396a38ef`; integration merge
  `51ac49197762c0a31def280a58b6e084b4398048` passed the locked CLI runner with
  76 executed tests, including a genuine production `RoomService` →
  `RelayRoomBackend` → `MlsClientService` create/open/restart journey against a
  real relay fixture, plus 18 classification/isolation tests. Independent review
  also passed all 52 `mls-core` tests, 27 protocol tests, 285 relay tests, and 695
  desktop tests. The accepted diff is CLI-only, preserves the original CLI-070
  ancestry and CLI-040-R1 correction, keeps canonical project paths in zeroized
  local credential state, and leaves desktop/release surfaces unchanged.
- CLI-080 is complete and integrated. Its accepted corrected task head is
  `76b1d06f763b898b7b6c77eaa8dc16f3ca3b54b7`; integration merge
  `efdf008ec07cc0abde2b2efbc745172eeba2c381` passed the locked CLI runner with
  88 executed tests, including literal binary invite/join/admissions/revoke and
  durable-finish command paths against the real relay fixture, plus 18
  classification/isolation tests. Independent review also passed all 52
  `mls-core` tests, 27 protocol tests, 285 relay tests, and 695 desktop tests.
  CLI-issued codes are checksummed and desktop-v4 compatible, capability
  material is zeroized and redacted, admission is host-mediated through a
  trusted explicit prompt, and expiry/revocation/replay/single-use behavior
  remains bound to the existing MLS capability model. No dependency, shared
  contract, desktop runtime, or protected release path changed.
- CLI-090 is complete and integrated. Its accepted task commit is
  `27932fa64f329d05997d27e3758ab81768293d81`; integration merge
  `da7f86a1ed2fdc7b6d0d38fee9a11f4d528e67d9` passed the locked CLI runner with
  95 executed tests, including three independent CLI processes reopening
  durable identity and MLS state, using the same room-loop driver as normal
  `room open`, and exchanging the same encrypted chat sequence in exact relay
  order. The journey also verified participant and authenticated active-host
  presence and rejected any relay-observed forbidden plaintext. Independent
  review passed all 52 `mls-core` tests, 27 protocol tests, 285 relay tests, 695
  desktop tests, and 18 classification/isolation tests. Terminal-control
  properties, color/plain golden rendering, bounded unsupported events,
  desktop wire parity, exact ancestry, repository cleanliness, and the protected
  desktop-release audit passed. No dependency, wire/schema, MLS-policy, desktop,
  governance, or release surface changed.
- CLI-100 is complete and integrated. Its accepted task commit is
  `5c3ba734e4963d6fb81e8ee8488da906f9985b6e`; integration merge
  `e2f821a441a82fb7b7db104e202e0e53b195899e` passed the locked CLI runner with
  101 executed tests, all 248 desktop native/shared tests including 56
  `mls-core` tests, 27 protocol tests, 285 relay tests, 695 desktop tests, and
  18 classification/isolation tests. Independent review verified relay restart,
  process crash, delayed backlog, duplicate suppression, bounded encrypted local
  history, explicit corrupt-state recovery, and distinct logout/leave/forget
  semantics. The owner-authorized exact room deletion is transactional,
  idempotent, fault-injected at every stage, clears in-memory authority only
  after durable success, and preserves sibling rooms and global identity. No
  dependency, wire contract, MLS policy, desktop behavior, or protected release
  surface changed.
- CLI-110 has task commit `9c6f72d063503df58112c25ba17855db7dcdee99`
  based directly on accepted integration commit
  `b8ec7fd244d543c3434432d203dbd99e11588bac`, but is paused before integration.
  GitHub Actions run `29676780266` executed the real two-client native journey
  successfully, then failed its metrics upload with `ETIMEDOUT`; the native fuzz
  job did not execute because pinned `cargo-fuzz 0.12.0` failed to compile with
  moving nightly `1.99.0-nightly` through `rustix 0.36.5`.
- CLI-010-R1 is complete and integrated. Its accepted task commit is
  `219cfd77fc88df1f10360c45b558f12bdfcb6715`; integration merge
  `129e6158086a4f66b39d662783878ac831084ed4` pins
  `nightly-2026-07-18` with `cargo-fuzz 0.13.2 --locked` and changes only the
  two authorized fuzz toolchain selectors. Complete Product journeys runs
  `29680873838` and `29681119913` both passed on the exact task head: both
  unchanged 120-second native fuzz targets executed, the real two-client native
  MLS journey passed, every required job and aggregation passed, and all five
  required artifact classes uploaded in each run. Integration also passed all
  18 classification/release-isolation tests and the protected release audit.
  No target, argument, timeout, failure behavior, corpus, artifact requirement,
  product source, dependency, lockfile, desktop behavior, or release surface
  changed.
- CLI-110 is again the sole active implementation task. It may incorporate the
  accepted CLI-010-R1 integration commit without rewriting its original task
  ancestry, then must rerun its complete verification on the resulting exact
  head before integration review.
- CLI-110 is preserved and paused at merge head
  `b7e269e43546563fac0caf1c0515360246d9a14b` after locked dependency
  verification proved the checked-in `mls-core` fuzz lockfile stale relative to
  already accepted manifests. The owner authorized exactly CLI-110-R1 to
  reconcile only that fuzz lockfile, review the exact resolution delta, and run
  locked dependency audits plus complete fuzz, MLS, CLI, desktop,
  classification, and protected-path verification. No other task was active
  during the correction.
- CLI-110-R1 is complete and integrated. Its accepted task commit is
  `4decbcb5c34e83bfb50108b461577f1505f6d119`; integration merge
  `9c6f74511c61fbab2e45aa3a6bd070f120fcb397` changes only
  `apps/desktop/src-tauri/crates/mls-core/fuzz/Cargo.lock`. The resolved graph
  decreased from 171 to 154 packages, with 47 exact records removed and 30
  added, all from crates.io and within existing license families. Locked
  advisories/sources passed without mutation; both unchanged 120-second fuzz
  targets executed 4,294,833 and 11,716,480 runs. Verification also passed 56
  `mls-core`, 101 locked CLI, 248 desktop native/shared, 27 protocol, 285 relay,
  695 desktop frontend, and 18 classification/release-isolation tests, plus
  formatting, warnings-denied Clippy, exact-path, ancestry, cleanliness, and
  protected-release audits. CLI-110 may now incorporate this correction with a
  normal merge that preserves its original ancestry and rerun its complete
  final verification.
- CLI-110 is complete and integrated. Its accepted final task head is
  `562613f75e395f4552d09b4294554cf4e77e475a`; integration merge
  `7249551941bcdaae9c1591e8337cf55dd3bd322f` preserves the original task
  ancestry and changes exactly the 12 reviewed Codex-host/adapter paths. Local
  verification passed 250 desktop native/shared tests, 11 host-core/projection
  tests, 103 locked CLI tests, 27 protocol tests, 285 relay tests, 695 desktop
  frontend tests, 16 UI contract journeys, and 18 classification/release
  isolation tests, plus formatting, warnings-denied Clippy, locked fuzz
  advisories/sources, exact-path, dependency, ancestry, cleanliness, and
  protected-release audits. Product Journeys run `29694076930` targeted the
  exact accepted head and passed all eight selected jobs, both unchanged
  120-second native fuzz targets, the real two-client native MLS journeys,
  required evidence uploads, macOS package/smoke checks, and aggregation.
- CLI-120 is complete and integrated. Its accepted corrected task head is
  `773051b365e2a85524372168cc2019b7dc6f1bc0`; integration merge
  `2987c8b7ba7eee20758ed181d38e2798a3fa9fe9` changes only the five authorized
  CLI source paths. Independent review returned the original task for a
  timestamp-bound correction, then verified that malformed, stale, and future
  proposal timestamps fail closed without occupying the pending slot. The
  corrected task and integration branch passed 99 locked CLI library tests, 9
  binary tests, 2 host-boundary tests, 9 Rust protocol fixture/property tests,
  and 18 classification/release-isolation tests, including real-compatible
  app-server, authority-loss, cancellation, idempotency, bounded-context,
  redaction, exact-path, cleanliness, and protected-release checks. No
  dependency, wire contract, MLS policy, desktop behavior, or protected release
  surface changed.
- CLI-130 is complete and integrated. Its accepted task commit is
  `ab8883211d81cc23ecf8796f709d503a0a6773e4`; integration merge
  `b4c125839950c9d62ccc949e217974411095cf8c` changes only the three authorized
  CLI source files. Independent review verified the complete privileged-request
  matrix, exact host/room/session/request/method binding, expiry, cancellation,
  shutdown, authority-loss, sandbox rechecks, bounded redaction, normalized
  activity projection, and terminal-spoof rejection. The task and integration
  branch passed 107 locked CLI library tests, 10 binary tests, 2 host-boundary
  tests, 9 Rust protocol fixture/property tests, and all 18
  classification/release-isolation tests. The owner-authorized public npm audit
  reported 0 vulnerabilities; RustSec, dependency source, and license audits
  also passed. Manifests, lockfiles, dependency files, shared contracts, desktop
  behavior, and protected release paths remain unchanged.
- CLI-140 is complete and integrated. Its accepted corrected head is
  `3e88c49fc161895bba18281d03b4e16c84419b46`; integration merge
  `256c010101933576b0e047e06b2beca4bae126a2` changes only nine reviewed CLI,
  debug-adapter, and cross-client journey paths. Independent review returned
  the original head for two acceptance corrections, then verified that the
  real-relay matrix invokes the production desktop approval action with exact
  room/turn/host binding and restarts a CLI participant through the production
  admission-association and `RoomService::open` boundaries. The corrected task
  and integration branch passed 108 CLI library tests, 10 binary tests, 2 host
  boundary tests, the corrected mixed-client matrix, 9 Rust protocol tests, and
  all 18 classification/release-isolation tests. Task evidence also passed the
  full repository suite, 695 desktop frontend tests, 285 relay tests, 27
  TypeScript protocol tests, 16 UI contracts, desktop native checks, npm and
  RustSec audits, license checks, and protected-path review. No manifest,
  lockfile, dependency, wire contract, MLS policy, or protected release surface
  changed.
- CLI-150 is complete and integrated. Its owner-approved task commit is
  `35c633cfde60d54a9695eda45e68fd83e97f33b9`; integration merge
  `8a791873ceaa90eeda011548cbb8cd8667030bd4` changes only three CLI rendering
  paths and `docs/threat-model.md`. The hardening routes room output and the
  native admission prompt through the existing bounded Unicode terminal
  sanitizer, closing bidi-override and zero-width prompt-spoofing gaps without
  changing authority or protocol semantics. The owner approved the documented
  CLI threat-model claims and residual risks for the exact task head.
  Independent task and integration verification passed 109 CLI library tests,
  10 binary tests, 2 host-boundary tests, the real desktop/CLI matrix, 9 Rust
  protocol tests, and all 18 classification/release-isolation tests. Task
  evidence additionally passed both locked 120-second native fuzz targets
  (4,435,031 and 10,276,660 executions), 320,000 relay property executions,
  adversarial process-security journeys, 695 desktop frontend tests, 285 relay
  tests, 250 native Rust tests, 27 TypeScript protocol tests, 16 UI contracts,
  npm/RustSec/Cargo-deny/license audits, full-history Gitleaks, optimized-binary
  secret scanning, exact ancestry, cleanliness, and protected-path review. No
  manifest, lockfile, dependency, wire contract, MLS policy, desktop behavior,
  or protected release surface changed.
- CLI-160 is complete and integrated. Its accepted corrected task head is
  `1f03c2b0fa5621c4c08fa1cc2361209132fc6e1f`; integration merge
  `2af4b5018c917b70d98c421146d6a8ca466af24c` changes only the 11 reviewed CLI
  version, lockfile, packaging, release-documentation, and CLI-check paths.
  Independent review returned three packaging-policy gaps for correction, then
  verified fail-closed dependency-license review, canonical output containment,
  and actual-versus-claimed code-signature metadata. The final Apple-silicon
  archive is for `multAIplayer 0.1.0-alpha.1`; its archive, manifest, and binary
  SHA-256 values are respectively
  `e130f372f86732ea542bc258865809d8e56dc66fd961c06b19c9bb6ff6c3f7bf`,
  `57674edb628901b82bb871286f4f1d216cbb25e5b830a3de8ed590fa37fe4665`,
  and `37a3c43867d4feba4a9afabb91b906c9fa8f4dbe72b52ded607713aeaa910727`.
  Task and integration verification passed 7 packaging-policy tests, 109 CLI
  library tests, 10 binary tests, 2 host-boundary tests, the mixed-client matrix,
  9 Rust protocol tests, and all 18 classification/release-isolation tests.
  Task evidence also passed the clean-environment install and exact artifact
  verifier, 21 desktop release-tool tests, documentation/version/license checks,
  npm and Rust dependency audits, exact ancestry, cleanliness, and protected-path
  review. Desktop updater, notarization, signing, versions, release workflows,
  Cargo.lock, and asset manifests remain unchanged. Developer ID signing and CLI
  publication remain owner-controlled and were not performed.
- CLI-170 is the sole active task for its read-first external-alpha readiness
  audit. Any implementation fix requires a separately approved follow-up task;
  publication remains owner-controlled.
- Every later implementation task is
  `waiting_for_orchestrator_approval` until CLI-000 confirms dependencies and
  grants exact task approval.
- All 18 original Codex tasks read their governing files and reported readiness
  before sequential implementation began.
- `[CLI-000] Program Control — Governance` and `[CLI-010] Desktop Release
  Isolation` are pinned in the Codex project.
- Tasks must be approved and executed one at a time unless the owner explicitly
  authorizes nonoverlapping parallel worktrees.

## Task ledger

| Task | Title | State | Depends on |
| --- | --- | --- | --- |
| CLI-000 | Program orchestration and governance | active_orchestrator | — |
| CLI-010 | Desktop release isolation and CI classification | complete | CLI-000 |
| CLI-010-R1 | Journey CI toolchain reliability correction | complete | CLI-010 |
| CLI-020 | Inert Rust CLI scaffold | complete | CLI-010 |
| CLI-030 | Rust protocol types and golden fixtures | complete | CLI-020 |
| CLI-040 | GitHub authentication and secure device identity | complete | CLI-030 |
| CLI-040-R1 | Device identity reliability correction | complete | CLI-040 |
| CLI-050 | Relay transport and workspace reads | complete | CLI-030, CLI-040 |
| CLI-060 | MLS client state, storage, and outbox | complete | CLI-030, CLI-040 |
| CLI-070 | Room creation and local project association | complete | CLI-050, CLI-060, CLI-040-R1 |
| CLI-080 | Secure invite codes and host-mediated admission | complete | CLI-070 |
| CLI-090 | Encrypted chat, presence, and safe rendering | complete | CLI-050, CLI-060, CLI-080 |
| CLI-100 | Reconnect, replay, history, and crash recovery | complete | CLI-090 |
| CLI-110 | UI-independent Codex host extraction | complete | CLI-020 |
| CLI-110-R1 | Shared MLS fuzz lockfile reconciliation | complete | CLI-010-R1 |
| CLI-120 | Codex proposals, context, and hosted turns | complete | CLI-090, CLI-110 |
| CLI-130 | Privileged approvals and shared activity | complete | CLI-120 |
| CLI-140 | Desktop/CLI interoperability journeys | complete | CLI-100, CLI-130 |
| CLI-150 | Security hardening and threat-model update | complete | CLI-140 |
| CLI-160 | Signed CLI packaging and release isolation | complete | CLI-150 |
| CLI-170 | External-alpha readiness review | active | CLI-160 |

## Release safety snapshot

- Desktop Cargo.lock changed by governance: no.
- Desktop release workflow changed by governance: no.
- Desktop updater/signing/notarization changed by governance: no.
- CLI included in desktop packaging: no.
- CLI implementation dependencies installed: protocol, authentication, secure
  storage, HTTPS/WebSocket relay transport, and existing `mls-core` path
  dependencies only; CLI-060 added no manifest or lockfile changes.
- CLI release publication enabled: no.

## Update rules

An implementation task may update its state and evidence here after approval.
It may not mark dependencies complete without their accepted verification. Any
deviation from the plan is recorded as a blocker until the owner approves a
plan change.

CLI-000 owns routine status transitions. Only the owner may authorize a plan or
decision change, a merge to `main`, or a release.
