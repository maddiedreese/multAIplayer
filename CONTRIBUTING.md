# Contributing

Thanks for helping with multAIplayer. This project is a macOS-first open-source alpha for private group chat with a local Codex host, an end-to-end encrypted relay, GitHub workflows, terminals, file viewing, and browser approvals.

Participation is governed by [the Code of Conduct](CODE_OF_CONDUCT.md).

## Security-boundary changes

Keep changes to the Rust MLS core, `packages/protocol`, and `apps/desktop/src-tauri` small, explicit, and independently testable. Pull requests should identify AI-authored security-boundary changes and report the focused property, fuzz, mutation, or native checks that apply. This project currently has one maintainer, so it does not require a separate human or code-owner approval that the sole maintainer could never supply; required CI and branch protection remain the merge gate.

Dependency advisory handling and coverage gates are documented in [Dependency security](docs/engineering-practices.md#dependency-security). Workflow purpose and merge impact are in [CI policy](docs/engineering-practices.md#continuous-integration-policy). Accessibility expectations and the honest localization status are in [Accessibility and localization](docs/using-the-app.md#accessibility-and-localization).
Native failure-handling rules and fail-closed redaction initialization are documented in [Rust panic policy](docs/engineering-practices.md#rust-panic-policy).

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
- `scripts` contains repository-wide verification, security, release, and operational checks.
- Root workspace metadata owns cross-workspace npm controls, including the Monaco/DOMPurify security override described below.

### Fast development loop

Run the smallest relevant loop while iterating, then run `npm run verify` before opening a PR. Workspace commands are run from the repository root.

| Changing                                                                                              | Fast checks while iterating                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relay HTTP, WebSocket, auth, persistence, or limits                                                   | `npm run check -w @multaiplayer/relay` and `npm run test -w @multaiplayer/relay`; run `npm run test:fuzz -w @multaiplayer/relay` after parser/schema changes and `npm run test:mutation -w @multaiplayer/relay` after authorization changes    |
| Desktop React UI, hooks, stores, or adapters                                                          | `npm run check -w @multaiplayer/desktop` and `npm run test:smoke -w @multaiplayer/desktop`; run `npm run test -w @multaiplayer/desktop` before handoff                                                                                         |
| Browser E2E journeys or the UI-contract harness                                                       | `npm run test:e2e -- e2e/<journey>.spec.ts`; run `npm run test:e2e` before handoff. Keep simulated relay/native boundaries visible and keep the harness outside the production desktop graph.                                                  |
| Two-client native invite, MLS, or handoff composition                                                 | Run the focused relay process test while iterating, then `xvfb-run -a npm run test:e2e:native` in a Linux environment with the WebKit, Secret Service, and `tauri-driver` dependencies pinned by CI.                                           |
| One shared package                                                                                    | `npm run check -w @multaiplayer/protocol` and `npm run test -w @multaiplayer/protocol`, replacing `protocol` with `codex`, `git`, or `github` as needed                                                                                           |
| Native Tauri/Rust code                                                                                | `npm run fmt:rust:check` and `npm run test:native`                                                                                                                                                                                              |
| Native packaging, Tauri config, browser windows, Keychain, terminals, or Codex app-server integration | Native checks above, then `npm run tauri:build -w @multaiplayer/desktop`                                                                                                                                                                       |
| Cross-cutting TypeScript or workspace configuration                                                   | `npm run lint`, `npm run format:check`, and the affected workspace checks                                                                                                                                                                      |
| Repository scripts                                                                                    | `npm run test:scripts`                                                                                                                                                                                                                         |

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

Monaco is consumed by the desktop editor, but its DOMPurify override and the direct `dompurify` pin intentionally live in the root `package.json`. npm applies workspace overrides only from the workspace root, and the direct dependency fixes the version referenced by that override. The desktop Vite resolver directs Monaco's sanitizer import to the patched package, while `scripts/verify-desktop-security-deps.mjs` fails the desktop build if the vulnerable bundled DOMPurify version appears in the output. Keep these pieces aligned when upgrading Monaco or DOMPurify; do not move or remove the root pin without replacing and testing the security control.

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
