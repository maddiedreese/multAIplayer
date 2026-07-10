# Contributing

Thanks for helping with multAIplayer. This project is a macOS-first open-source alpha for private group chat with a local Codex host, an end-to-end encrypted relay, GitHub workflows, terminals, file viewing, and browser approvals.

## Development Setup

Install dependencies:

```sh
npm install
npm run doctor
```

Run the relay plus desktop web shell:

```sh
npm run dev
```

Run the native Tauri app:

```sh
npm run tauri:dev
```

Copy `.env.example` to `.env` when you need GitHub OAuth or self-hosted relay settings. The relay loads the repo root `.env`, a relay-local `apps/relay/.env`, or an explicit `MULTAIPLAYER_RELAY_ENV_FILE`; shell-exported variables take precedence. The app can run in local seeded-room mode without GitHub OAuth.

## Code Map

- `apps/desktop/src` contains the React desktop UI, hooks, stores, and local backend adapters.
- `apps/desktop/src-tauri/src` contains native Rust commands, split by capability; `lib.rs` wires those modules into Tauri.
- `apps/relay/src/server.ts` composes the relay from focused `http`, `ws`, and `auth` handlers plus state, persistence, limits, and lifecycle modules.
- `packages/protocol` defines shared wire records and defaults; `packages/crypto` owns encrypted payload primitives.
- `packages/codex`, `packages/git`, and `packages/github` isolate integrations used by the desktop and relay applications.
- `scripts` contains repository-wide verification, security, release, and operational checks.
- Root workspace metadata owns cross-workspace npm controls, including the Monaco/DOMPurify security override described below.

## Verification

Before opening a PR, run:

```sh
npm run verify
```

`npm run verify` type-checks, tests, checks Rust formatting, runs native Tauri/Rust tests, and builds the TypeScript workspaces. Run `npm run tauri:build -w @multaiplayer/desktop` when changing native packaging, Tauri config, browser windows, Keychain storage, terminals, or Codex app-server integration.

## Engineering Guidelines

- Keep relay plaintext minimal. The relay may route metadata, but chat bodies, attachments, terminal output, Codex events, Git events, browser requests, and invite approval content should remain encrypted envelopes.
- Prefer small, testable security boundaries over broad trust assumptions.
- Keep native project file access confined to the selected project root.
- Treat browser pages, terminal output, `.env` files, credentials, and signed-in sessions as sensitive by default.
- Log stable error codes and bounded identifiers, never request/response bodies, decrypted plaintext, tokens, keys, secrets, passphrases, or other payload objects. The diagnostics object sanitizer is a safety net, not permission to log payloads.
- Avoid adding OpenAI API quota bridging. The desktop app talks to the user's local Codex app-server instead.
- Preserve the existing monorepo package boundaries unless a change genuinely needs to cross them.
- Use imperative, outcome-specific commit subjects and keep each commit cohesive and reviewable; split unrelated or unusually broad changes when practical.

### Monaco DOMPurify Security Pin

Monaco is consumed by the desktop editor, but its DOMPurify override and the direct `dompurify` pin intentionally live in the root `package.json`. npm applies workspace overrides only from the workspace root, and the direct dependency fixes the version referenced by that override. The desktop Vite resolver directs Monaco's sanitizer import to the patched package, while `scripts/verify-desktop-security-deps.mjs` fails the desktop build if the vulnerable bundled DOMPurify version appears in the output. Keep these pieces aligned when upgrading Monaco or DOMPurify; do not move or remove the root pin without replacing and testing the security control.

## Tests To Add

Add focused tests when changing:

- relay auth, membership, rate limits, persistence, CORS, WebSocket routing, or encrypted backlog behavior;
- crypto primitives or invite payloads;
- GitHub repo, branch, PR, or Actions validation;
- desktop encrypted history, invite handling, browser policy, Codex turn assembly, Markdown export, secret warnings, terminal approvals, or workspace creation;
- native Tauri file, Git, terminal, browser, Keychain, diagnostics, or Codex app-server commands.

Diagnostics changes need tests on both sides of the IPC boundary. Frontend tests should cover capture-time redaction, compound sensitive-key omission, ordered writes, and proof that native export does not return persisted records. Rust tests should cover strict request shape, JSONL corruption recovery, file permissions, retention and size limits, concurrent writes, native bundle assembly, export-time re-redaction, and safe destination writes. Do not add a command that returns persisted diagnostic entries, bundle contents, or the selected export path to the webview.

## Security Reports

See [SECURITY.md](SECURITY.md). Do not put live secrets, private repo contents, real transcripts, or decrypted room payloads in issues or PRs.
