# multAIplayer

multAIplayer helps teams build with Codex together.

People chat normally in private project rooms. When the group needs help, someone invokes Codex. The active host approves the turn, and their local Codex works from the recent chat, attachments, selected project folder, browser state, and terminals. Codex can make code changes, commit, push, and open a PR while the room watches progress together.

Treat room membership as controlled access to the active host's machine: admitted members can ask Codex to act on the host's project, terminal, browser, Git, and GitHub context, subject to the host's approval settings.

Short version: build with Codex together. Private by default. Open source.

Room traffic authenticates ciphertext together with its sender, room, event kind, timestamp, and key epoch. Invite links contain no room key but do contain a private single-use bearer capability: the active host validates its device-bound request before delivering the current epoch key, and member removal excludes removed devices from future epochs without claiming to erase content already delivered.

Start with [docs/using-the-app.md](docs/using-the-app.md) for the desktop features, [docs/product-architecture.md](docs/product-architecture.md) for the product model, [docs/cryptography.md](docs/cryptography.md) for key architecture and the MLS decision, [docs/codex-hosting.md](docs/codex-hosting.md) for how host-side Codex works, [docs/local-preview-sharing.md](docs/local-preview-sharing.md) for localhost preview tunnels, [docs/threat-model.md](docs/threat-model.md) and its [public changelog](docs/threat-model-changelog.md) for privacy boundaries, [docs/self-hosting.md](docs/self-hosting.md) for relay deployment, and [docs/if-unmaintained.md](docs/if-unmaintained.md) for the project exit path. Contributors and maintainers can use [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [docs/release-hardening.md](docs/release-hardening.md), [docs/reproducible-builds.md](docs/reproducible-builds.md), [docs/alpha-release-readiness.md](docs/alpha-release-readiness.md), and [docs/alpha-limitations.md](docs/alpha-limitations.md).

## Maintenance reality

multAIplayer is currently a single-maintainer project. There is no guaranteed response time, succession team, or promise that the hosted relay will operate indefinitely. Do not make the hosted service the only copy of project data or room history. Keep normal Git/project backups and read [If this project goes unmaintained](docs/if-unmaintained.md) before depending on the alpha for important work.

## Desktop Surfaces

The desktop app uses Monaco Editor for workspace file editing, xterm.js for the terminal emulator, a Rust PTY layer through `portable-pty` for host shell sessions, and Tauri/Wry WebViews for multi-tab in-room web browsing. These are embedded as open source dependencies with attribution in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Codex hosting uses the active host's local app-server. The supported compatibility range is 0.133.0–0.144.0, with generated-schema fixtures for 0.133.0, 0.143.0, and 0.144.0; newer versions are labelled unverified and contract-sensitive features fail closed. See [docs/codex-hosting.md](docs/codex-hosting.md) for catalog selection, bidirectional approvals, metadata-only activity, host-local account/MCP controls, and thread forks.

## Download

Public macOS alpha downloads are published through [GitHub Releases](https://github.com/maddiedreese/multAIplayer/releases).

Public macOS alpha artifacts are Developer ID signed and notarized. Treat every build as security-sensitive alpha software and prefer test/self-hosted rooms before using private projects.

The custom cryptographic protocol is unaudited. End-to-end encryption is the intended, tested design boundary, not an independently verified guarantee.

## Run Locally

```sh
npm install
npm run doctor
npm run dev
```

`npm run doctor` checks the local Node/npm/Rust/Cargo setup and macOS packaging prerequisites where applicable. `npm run dev` starts the local relay on `http://127.0.0.1:4321` and the desktop web shell on `http://127.0.0.1:1420`.

To run the native Tauri app with the relay:

```sh
npm run tauri:dev
```

Copy `.env.example` to `.env` and set `GITHUB_CLIENT_ID` to enable GitHub sign-in. The relay loads the repo root `.env`, a relay-local `apps/relay/.env`, or an explicit `MULTAIPLAYER_RELAY_ENV_FILE`; shell-exported variables take precedence. Set `MULTAIPLAYER_RELAY_SESSION_SECRET` to a stable high-entropy value if the relay should keep encrypted GitHub sessions across restarts. The default `GITHUB_OAUTH_SCOPES=read:user public_repo` supports public open-source PR creation; use `read:user repo` if your self-hosted relay needs private repo PRs. Without GitHub OAuth, local development can run with seeded rooms.

For `NODE_ENV=production`, the relay requires auth by default even if GitHub OAuth is not configured, and demo rooms are not seeded. Self-hosters who intentionally want an unauthenticated private LAN relay must set `MULTAIPLAYER_RELAY_REQUIRE_AUTH=false` explicitly.

Self-hosted relays can be selected from the in-app Settings drawer by changing the relay HTTP API URL and WebSocket rooms URL. The packaged public alpha app-shell CSP allows localhost development relays and the official hosted relay; custom HTTPS/WSS relay origins require a self-built desktop app whose CSP includes those origins.

For an internet-facing relay, configure exact allowed origins, durable encrypted session storage, auth-required mode, persistent relay storage, and rate limits, then run:

```sh
npm run doctor:production-relay
```

The relay also ships with a Dockerfile at `apps/relay/Dockerfile`; see [docs/self-hosting.md](docs/self-hosting.md) for the build/run command and production env checklist. Teams leaving the hosted relay can follow [docs/relay-migration-runbook.md](docs/relay-migration-runbook.md); the hosted relay policy is at least 30 days' notice before any planned shutdown, with migration kept available during that window whenever safely possible.

Production deploys should wire `/readyz` to platform readiness: shutdown makes it not-ready, rejects new HTTP/WS work, closes existing room WebSockets with `1012`, and flushes the relay store before exit.

## CI

The GitHub Actions workflow runs on pushes, pull requests, and manual dispatch:

```sh
npm run verify
npm run tauri:build -w @multaiplayer/desktop
```

`npm run verify` type-checks, tests, checks Rust formatting, runs native Tauri/Rust tests, and builds the relay/desktop web artifacts. The macOS CI job runs on the pinned `macos-15` runner, then builds an unsigned Tauri app and uploads both the `.app` bundle and `.dmg` as workflow artifacts for inspection only.

Tagged versions matching `v*` run the release workflow. It verifies the repo on the pinned `macos-15` runner, requires Apple Developer ID signing/notarization secrets, builds the signed and notarized macOS app, validates the stapled app and DMG tickets, packages the `.app` bundle and `.dmg`, writes `SHA256SUMS.txt`, and creates a GitHub Release. Tags containing `alpha`, `beta`, or `rc` are published as prereleases.
