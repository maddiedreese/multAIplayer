# multAIplayer

multAIplayer is a private group chat app where your team can bring Codex into the conversation.

People chat normally, like iMessage or Slack. When the group needs help, someone invokes Codex. The active host approves the turn, and their local Codex works from the recent chat, attachments, selected project folder, browser state, and terminals. Codex can make code changes, commit, push, and open a PR while the room watches progress together.

Short version: group chat for coding with Codex. Private by default. Open source.

See [docs/product-architecture.md](docs/product-architecture.md) for the initial product and architecture spec.
See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance and [SECURITY.md](SECURITY.md) for the alpha security policy.

## Run the Alpha

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

Copy `.env.example` to `.env` and set `GITHUB_CLIENT_ID` to enable GitHub sign-in. The relay loads the repo root `.env`, a relay-local `apps/relay/.env`, or an explicit `MULTAIPLAYER_RELAY_ENV_FILE`; shell-exported variables take precedence. Set `MULTAIPLAYER_RELAY_SESSION_SECRET` to a stable high-entropy value if the relay should keep encrypted GitHub sessions across restarts. The default `GITHUB_OAUTH_SCOPES=read:user public_repo` supports public open-source PR creation; use `read:user repo` if your self-hosted relay needs private repo PRs. Without GitHub OAuth, the alpha still runs in local mode with seeded rooms.

For `NODE_ENV=production`, the relay requires auth by default even if GitHub OAuth is not configured, and demo rooms are not seeded. Self-hosters who intentionally want an unauthenticated private LAN relay must set `MULTAIPLAYER_RELAY_REQUIRE_AUTH=false` explicitly.

Self-hosted relays can be selected from the in-app Settings drawer by changing the relay HTTP API URL and WebSocket rooms URL.

## CI

The GitHub Actions workflow runs on pushes, pull requests, and manual dispatch:

```sh
npm run verify
npm run tauri:build -w @multaiplayer/desktop
```

`npm run verify` type-checks, tests, checks Rust formatting, runs native Tauri/Rust tests, and builds the relay/desktop web artifacts. The macOS job also builds an unsigned Tauri app and uploads both the `.app` bundle and `.dmg` as workflow artifacts.
