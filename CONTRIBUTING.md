# Contributing

Thanks for helping with multAIplayer. This project is a macOS-first open-source alpha for private group chat with a local Codex host, an end-to-end encrypted relay, GitHub workflows, terminals, file viewing, and browser approvals.

Participation is governed by [the Code of Conduct](CODE_OF_CONDUCT.md) and [project governance](GOVERNANCE.md).

## Contribution attestation (DCO)

Every commit must include a `Signed-off-by` trailer certifying the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Add it with `git commit -s`. By signing off, you certify that you wrote the contribution or otherwise have the right to submit it under this project's license. This lightweight DCO is used instead of a CLA; contributors retain copyright and need no separate legal agreement.

## Security-boundary changes

Keep changes under `packages/crypto`, `packages/protocol`, and `apps/desktop/src-tauri` small, explicit, and independently testable. Pull requests should identify AI-authored security-boundary changes and report the focused property, fuzz, mutation, or native checks that apply. This project currently has one maintainer, so it does not require a separate human or code-owner approval that the sole maintainer could never supply; required CI and branch protection remain the merge gate.

Dependency advisory handling and coverage gates are documented in [Dependency security](docs/dependency-security.md). Workflow purpose and merge impact are in [CI policy](docs/ci-policy.md). Accessibility expectations and the honest localization status are in [Accessibility and localization](docs/accessibility-and-localization.md).

## Fast path

For the shortest reproducible on-ramp, open the repository in a Dev Container. Its Node 22 image plus Rust and Python features install the workspace and run the environment doctor automatically. Then run:

```sh
npm install
npm run doctor
npm run dev
```

The first-contribution target is `npm run verify:web`; it does not require native macOS packaging. Maintainers label bounded, documented work `good first issue` and pair it with an area label. Each such issue should name expected files, acceptance criteria, and the fast check. Comment before starting to avoid duplicated work.

Use `npm run tauri:dev` instead of `npm run dev` when you need the native Tauri app. The web shell can run in local seeded-room mode without GitHub OAuth; copy `.env.example` to `.env` only when you need OAuth or self-hosted relay settings.

Make a focused change, use the [fast development loop](#fast-development-loop) for the area you touched, then run the full gate:

```sh
npm run verify
```

Open a PR with a cohesive, outcome-specific commit. Before submitting, check the [engineering guidelines](#engineering-guidelines) and [area-specific test requirements](#area-specific-test-requirements) that apply to your change. Security concerns belong in [SECURITY.md](SECURITY.md), not a public issue.

## Contributor guide

### Development setup

The relay loads the repo root `.env`, a relay-local `apps/relay/.env`, or an explicit `MULTAIPLAYER_RELAY_ENV_FILE`; shell-exported variables take precedence.

Run the relay or desktop web shell separately with `npm run dev:relay` or `npm run dev:desktop`. Run both with `npm run dev`, and run the native application with `npm run tauri:dev`.

### Code map

- `apps/desktop/src` contains the React desktop UI, hooks, stores, and local backend adapters.
- `apps/desktop/src-tauri/src` contains native Rust commands, split by capability; `lib.rs` wires those modules into Tauri.
- `apps/relay/src/server.ts` composes the relay from focused `http`, `ws`, and `auth` handlers plus state, persistence, limits, and lifecycle modules.
- `packages/protocol` defines shared wire records and defaults; `packages/crypto` owns encrypted payload primitives.
- `packages/codex`, `packages/git`, and `packages/github` isolate integrations used by the desktop and relay applications.
- `docs/message-lifecycles.md` traces chat messages and Codex turns vertically through the files they touch.
- `docs/decisions` records cross-cutting architecture and trust decisions that contributors must preserve or explicitly supersede.
- `scripts` contains repository-wide verification, security, release, and operational checks.
- Root workspace metadata owns cross-workspace npm controls, including the Monaco/DOMPurify security override described below.

### Fast development loop

Run the smallest relevant loop while iterating, then run `npm run verify` before opening a PR. Workspace commands are run from the repository root.

| Changing | Fast checks while iterating |
| --- | --- |
| Relay HTTP, WebSocket, auth, persistence, or limits | `npm run check -w @multaiplayer/relay` and `npm run test -w @multaiplayer/relay`; run `npm run test:fuzz -w @multaiplayer/relay` after parser/schema changes and `npm run test:mutation -w @multaiplayer/relay` after authorization changes |
| Desktop React UI, hooks, stores, or adapters | `npm run check -w @multaiplayer/desktop` and `npm run test:smoke -w @multaiplayer/desktop`; run `npm run test -w @multaiplayer/desktop` before handoff |
| One shared package | `npm run check -w @multaiplayer/protocol` and `npm run test -w @multaiplayer/protocol`, replacing `protocol` with `crypto`, `codex`, `git`, or `github` as needed; crypto authorization or validation changes require `npm run test:mutation -w @multaiplayer/crypto`, and protocol type-guard changes require `npm run test:mutation -w @multaiplayer/protocol` |
| Native Tauri/Rust code | `npm run fmt:rust:check` and `npm run test:native` |
| Native packaging, Tauri config, browser windows, Keychain, terminals, or Codex app-server integration | Native checks above, then `npm run tauri:build -w @multaiplayer/desktop` |
| Cross-cutting TypeScript or workspace configuration | `npm run verify:web` |
| Repository scripts | `npm run test:scripts` |

Use `npm run format` to apply the repository's Prettier baseline. `npm run verify` lints and checks formatting for TypeScript and JavaScript, type-checks, tests, checks Rust formatting, runs native Tauri/Rust tests, and builds the workspaces.

The relay fuzz suite feeds seedable arbitrary bytes, recursive JSON values, and mutated valid envelopes/messages through the protocol schemas. It runs 100,000 cases by default; reproduce or tune a run with `MULTAIPLAYER_RELAY_FUZZ_SEED` and `MULTAIPLAYER_RELAY_FUZZ_ITERATIONS`.

### Engineering guidelines

- Keep relay plaintext minimal. The relay may route metadata, but chat bodies, attachments, terminal output, Codex events, Git events, browser requests, and invite approval content should remain encrypted envelopes.
- Prefer small, testable security boundaries over broad trust assumptions.
- Keep native project file access confined to the selected project root.
- Treat browser pages, terminal output, `.env` files, credentials, and signed-in sessions as sensitive by default.
- Log stable error codes and bounded identifiers, never request/response bodies, decrypted plaintext, tokens, keys, secrets, passphrases, or other payload objects. The diagnostics object sanitizer is a safety net, not permission to log payloads.
- Avoid adding OpenAI API quota bridging. The desktop app talks to the user's local Codex app-server instead.
- Keep cross-workspace imports aligned with each package's declared dependencies and public entry point. ESLint rejects undeclared package edges, deep imports, and relative source-tree bypasses; declare and review an intentional boundary change before using it.
- A hook earns its own file only when it is reused or owns a real React lifecycle (such as subscriptions, effects, or refs). Otherwise, inline it at its call site so the hooks directory remains navigable.
- Use imperative, outcome-specific commit subjects and keep each commit cohesive and reviewable; split unrelated or unusually broad changes when practical.

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
