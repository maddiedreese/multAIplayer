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
- Avoid adding OpenAI API quota bridging. The desktop app talks to the user's local Codex app-server instead.
- Preserve the existing monorepo package boundaries unless a change genuinely needs to cross them.

## Tests To Add

Add focused tests when changing:

- relay auth, membership, rate limits, persistence, CORS, WebSocket routing, or encrypted backlog behavior;
- crypto primitives or invite payloads;
- GitHub repo, branch, PR, or Actions validation;
- desktop encrypted history, invite handling, browser policy, Codex turn assembly, Markdown export, secret warnings, terminal approvals, or workspace creation;
- native Tauri file, Git, terminal, browser, Keychain, or Codex app-server commands.

## Security Reports

See [SECURITY.md](SECURITY.md). Do not put live secrets, private repo contents, real transcripts, or decrypted room payloads in issues or PRs.
