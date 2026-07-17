# Contributing

Thanks for helping with multAIplayer. Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately through
[SECURITY.md](SECURITY.md), not a public issue.

## First pull request

The Dev Container provides the pinned Node and Rust toolchains for checks, relay
work, and browser-component development. It does not reproduce the usable native
macOS application, Keychain, universal links, or Apple packaging. Native desktop
changes require an Apple-silicon Mac; CI covers the full repository matrix.

For a local checkout, install Node.js 24.x and Rust 1.89.x, then run:

```sh
npm install --global npm@11.16.0 --ignore-scripts
npm ci
cp .env.example .env
npm run doctor
```

The example environment deliberately disables authentication only for its
loopback relay. This makes the local product usable without compiling a desktop
against an HTTPS OAuth relay; GitHub identity sign-in is intentionally unavailable
in this mode. Run `npm run tauri:dev`; Tauri starts the relay and Vite process for
the native app. Use `npm run dev` instead for browser-component work; the browser
frontend is a native-app notice. Authenticated and custom-relay builds follow the
[self-hosting OAuth setup](docs/self-hosting.md#github-oauth).

Before coding:

1. Choose an issue with a clear scope and comment before starting to avoid
   duplicate work.
2. Read the [architecture walkthrough](docs/product-architecture.md#contributor-walkthrough).
3. Read the relevant [ADR](docs/decisions/README.md) before changing a durable
   architecture or trust boundary.

Run focused checks for the area you change and add focused tests. The complete
`npm run verify` gate is available for cross-cutting changes and release work, but
ordinary contributors are not expected to reproduce every CI job locally. CI is
the merge authority.

Use a concrete Conventional Commit PR title (`feat:`, `fix:`, `docs:`, or
`chore:`). Pull requests are squash-merged, so the title becomes the commit and
release-history entry. Split unrelated work and remove code or documentation that
your change supersedes.

## Checks by area

Run commands from the repository root.

| Change                                                 | Iteration checks                                           | Before handoff                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Relay HTTP, WebSocket, auth, persistence, or limits    | `npm run check -w @multaiplayer/relay`; focused relay test | `npm run test -w @multaiplayer/relay`; add relay fuzzing for parser/schema changes |
| Desktop React, hooks, stores, or adapters              | `npm run check -w @multaiplayer/desktop`; focused test     | `npm run test -w @multaiplayer/desktop`                                            |
| UI contract harness                                    | `npm run test:ui-contract -- e2e/<journey>.spec.ts`        | `npm run test:ui-contract`                                                         |
| Native invite, MLS, or handoff composition             | focused Rust/relay test                                    | native two-client journey in its pinned CI environment                             |
| Shared package                                         | package `check` and focused test                           | package test suite                                                                 |
| Native Tauri/Rust                                      | `npm run fmt:rust:check`; focused Cargo test               | `npm run test:native`                                                              |
| Native packaging, Keychain, terminal, or Codex process | native checks above                                        | `npm run tauri:build -w @multaiplayer/desktop` on macOS, or CI                     |
| Cross-cutting TypeScript or workspace configuration    | affected workspace checks                                  | `npm run lint`; `npm run format:check`                                             |

Use `npm run format` to apply the repository baseline. The relay fuzz suite
defaults to 100,000 cases; reproduce a failure with
`MULTAIPLAYER_RELAY_FUZZ_SEED` and tune local iteration with
`MULTAIPLAYER_RELAY_FUZZ_ITERATIONS`.

The optional staged-file hook runs Prettier and ESLint. Enable it per clone with
`npm run hooks:install`.

## Where changes belong

- Pure desktop logic belongs under `apps/desktop/src/lib/<domain>`; store-aware
  workflows belong in `application/<domain>`, component-facing projections in
  `presentation/<domain>`, and rendering in `components`.
- Native capabilities live under `apps/desktop/src-tauri/src`. Cryptographic
  state and operations belong in the `mls-core` crate, not the webview.
- Relay transport, persistence, limits, and lifecycle code live under
  `apps/relay/src`; shared public wire records and limits belong in
  `packages/protocol`.
- Executable UI contracts and native journeys belong under `e2e`; focused
  maintenance and release utilities belong under `tools`.
- A React hook earns a separate file when reused or when it owns a real lifecycle
  such as a subscription, effect, or ref. See the
  [hook-specific guidance](apps/desktop/src/hooks/README.md).

## Repository contracts

- Keep relay plaintext minimal. Chat, attachments, terminal output, Codex/Git/
  browser events, and invite approval content stay inside their documented MLS,
  HPKE, Welcome, or exporter-sealed boundaries.
- Confine native project access to the selected project root. Treat browser pages,
  terminal output, project files, credentials, and signed-in sessions as sensitive.
- Log bounded identifiers and stable error codes, never payload bodies, plaintext,
  credentials, keys, tokens, passphrases, or raw upstream errors.
- Keep changes to `packages/protocol`, native commands, and `mls-core` small and
  independently testable. A security-boundary PR must name the focused evidence.
- Respect package entry points and declared workspace dependencies. Do not add
  proxy, view-model, or compatibility layers that only rename an existing API.
- Prefer compiler, schema, or established-tool checks over repository-owned source
  regexes. Delete orphaned generators, policy checks, and stale outputs.
- Keep security claims and residual risks in the
  [threat model](docs/threat-model.md), durable decisions in
  [ADRs](docs/decisions/README.md), deployment procedures in
  [Self-hosting](docs/self-hosting.md), and release verification in
  [Verifying releases](docs/reproducible-builds.md).

Fallible Tauri commands use the typed-command contract and return bounded public
error codes. Runtime `unwrap`, `expect`, or deliberate panic requires a documented
initialization invariant and a focused failure test. Diagnostics must remain
redacted and must never expose persisted entries, bundle contents, or export paths
to the webview.

The root Monaco `dompurify` override and direct pin are one maintained security
boundary. Upgrade or remove the override, Vite alias, and focused bundle check
together.

## Maintainer references

Ordinary contributions do not require release or hosted-relay operations:

- [Self-hosting](docs/self-hosting.md) covers basic relay deployment and migration;
  [Relay operations](docs/relay-operations.md) covers monitoring, incidents,
  restrictions, and restore-safe deletion.
- [Verifying releases](docs/reproducible-builds.md) covers exact-tag artifacts,
  signing, notarization, updater metadata, publication, and failure recovery.
- [Codex hosting](docs/codex-hosting.md) records the exact supported app-server
  range and the behavior of older and unverified newer versions.
- Workflow definitions are the source of truth for the current CI schedule and
  path selection.
