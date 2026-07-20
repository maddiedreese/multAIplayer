<p align="center">
  <img src="apps/desktop/src/assets/multaiplayer-icon.png" width="104" alt="multAIplayer app icon">
</p>

<h1 align="center">multAIplayer</h1>

<p align="center"><strong>Build with Codex. Together.</strong></p>

<p align="center">
  Multiplayer Codex for trusted teams: discuss the work, steer one shared local Codex session,<br>
  review what it changes, and hand hosting between teammates.
</p>

<p align="center">
  <a href="https://multaiplayer.com">Website</a> ·
  <a href="docs/using-the-app.md">User guide</a> ·
  <a href="apps/cli/README.md">CLI</a> ·
  <a href="docs/faq.md">FAQ</a> ·
  <a href="docs/threat-model.md">Threat model</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

> [!IMPORTANT]
> multAIplayer is a free, open-source macOS alpha. Use only Developer ID-signed,
> notarized builds published from this repository. Desktop builds use the tagged
> release workflow; CLI builds use the isolated CLI release
> process. Current platform and product constraints are listed in
> [Alpha limitations](docs/alpha-limitations.md).

## Command-line client

Install the Apple-silicon macOS CLI with one command:

```sh
curl -fsSL https://raw.githubusercontent.com/maddiedreese/multAIplayer/main/apps/cli/install.sh | sh
```

After sign-in, the CLI prints a walkthrough covering room creation or joining,
encrypted chat, Codex hosting, and authenticated host handoff. See the
[CLI guide](apps/cli/README.md) for the complete flow, compatibility,
limitations, updates, and uninstalling.

## The product

Start a private project room, invite people you trust, and work with Codex as a team. Everyone can follow the conversation, propose the next turn, inspect structured progress, review changes, and use room-scoped files, diffs, terminals, browser previews, Git, and GitHub workflows. One active host supplies the project, local tools, credentials, and Codex account; an explicit handoff can move that responsibility to another verified member.

<p align="center">
  <img src="docs/assets/screens/room-app.png" width="100%" alt="The multAIplayer desktop workspace with an active team room, shared Codex chat, and live work context">
</p>

<p align="center">
  <img src="docs/assets/screens/room-chat.png" width="64%" alt="Team chat with a Codex result and structured activity inside a shared room">
</p>
<p align="center">
  <img src="docs/assets/screens/room-browser.png" width="64%" alt="The room browser ready for a host-approved local page">
</p>
<p align="center">
  <img src="docs/assets/screens/room-terminal.png" width="64%" alt="The host-controlled room terminal ready for a shared shell session">
</p>

multAIplayer does not provide or replace Codex's system or developer instructions. It connects to the standard open-source Codex app-server running on the active host. An approved room turn becomes ordinary user-turn input: the app formats the selected conversation and attachments, and explicitly labels teammate, file, terminal, browser, and tool material as untrusted context.

## Independent project

multAIplayer is an independent open-source project. It is **not** an official OpenAI or Codex product and is not affiliated with, endorsed by, or sponsored by OpenAI. OpenAI and Codex are trademarks of OpenAI.

## Security posture

Rooms use RFC 9420 MLS through `mls-rs`; the relay routes encrypted records while observing the metadata required to operate the service. The integration is unaudited. The [threat model](docs/threat-model.md) is the sole source for security properties, assumptions, metadata exposure, and residual risks; [SECURITY.md](SECURITY.md) explains private reporting.

## Build locally

The Apple-silicon terminal client has a separate [installation and quickstart
guide](apps/cli/README.md). Its binary, version, checksums, signing, and release
process are independent from the desktop updater and artifacts.

Prerequisites are Node.js 24.x, npm 11.16.0, Rust 1.89.x/Cargo, Xcode command-line tools, and Codex:

```sh
npm install --global npm@11.16.0 --ignore-scripts
npm ci
cp .env.example .env
npm run doctor
```

Then run the native app:

```sh
npm run tauri:dev
```

Tauri starts the local relay and Vite process for this command.
The example environment uses an intentionally unauthenticated loopback relay, so
GitHub identity sign-in is unavailable in this local mode. An authenticated or
custom relay requires a self-built client as described in
[Self-hosting](docs/self-hosting.md#github-oauth); production startup rejects the
local auth opt-out.

Run focused checks for the area you change; CI runs the complete repository gates:

```sh
npm run check
npm test
```

Pull requests run workspace checks and product journeys when executable code changes. Scheduled workflows provide focused fuzz, supply-chain, container, and Codex-compatibility checks. Releases rerun supply-chain checks against the exact tag before verifying signing, notarization, authenticated updater metadata, the required release asset set, and checksums. Workflow definitions are the source of truth for the current gates.

## Repository map

| Path                                     | Responsibility                                           |
| ---------------------------------------- | -------------------------------------------------------- |
| `apps/desktop`                           | React/Tauri desktop, host workflows, native capabilities |
| `apps/cli`                               | Rust terminal client and independent CLI packaging       |
| `apps/desktop/src-tauri/crates/mls-core` | MLS, invite cryptography, exporters, encrypted state     |
| `apps/relay`                             | Authenticated transport, SQLite persistence, and quotas  |
| `packages/protocol`                      | Shared wire records and runtime validation               |
| `e2e`                                    | UI contracts and multi-process journeys                  |
| `docs/decisions`                         | Normative architecture decisions                         |

The [architecture guide](docs/product-architecture.md) maps product flows to code. Durable relay behavior and its deliberately single-node boundary are documented in the [single-node relay ADR](docs/decisions/single-node-relay.md).

## Releases and operations

Release verification is documented in [Verifying releases](docs/reproducible-builds.md). Relay operators should follow [Self-hosting](docs/self-hosting.md); the free hosted relay has no uptime or recovery guarantee.

Contributions are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md). Apache-2.0 licensed. Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
