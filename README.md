<p align="center">
  <img src="apps/desktop/src/assets/multaiplayer-icon.png" width="104" alt="multAIplayer app icon">
</p>

<h1 align="center">multAIplayer</h1>

<p align="center"><strong>Build with Codex. Together.</strong></p>

<p align="center">
  A native macOS workspace where trusted teammates share an encrypted project room,<br>
  propose work, and follow one active host's local Codex session in real time.
</p>

<p align="center">
  <a href="https://multaiplayer.com">Website</a> ·
  <a href="docs/using-the-app.md">Using the app</a> ·
  <a href="docs/faq.md">FAQ</a> ·
  <a href="docs/threat-model.md">Security model</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

> [!IMPORTANT]
> multAIplayer is a free, open-source alpha for Apple silicon Macs running macOS 11 or later. No supported public build has been published yet. The website will enable its download only after a Developer ID-signed and notarized release passes the release gates.

## See the app

<p align="center">
  <img src="docs/assets/screens/onboarding.png" width="49%" alt="multAIplayer welcome screen with create and join choices">
  <img src="docs/assets/screens/safe-defaults.png" width="49%" alt="multAIplayer safe defaults review screen">
</p>

<p align="center">
  <img src="docs/assets/screens/codex-room.png" width="72%" alt="A multAIplayer room showing a teammate message and expandable Codex activity">
</p>

These images are deterministic captures of the current production components and styles with representative local data—not concept art. Regenerate them with `npm run docs:screenshots` after a visible UI change.

## What it does

Each room connects a team conversation to one selected project folder and one active host:

1. A teammate writes normally or proposes a Codex turn.
2. The active host reviews what will be shared and what local authority the turn requests.
3. The host's own Codex app-server works in the selected project using the host's local account and credentials.
4. The room receives encrypted chat, approvals, structured Codex progress, diffs, Git activity, and results.
5. Host authority can be handed to another verified member through an explicit MLS-backed transfer.

The desktop also provides project files and diffs, PTY terminals, Git and GitHub workflows, multi-tab in-room browsing, encrypted attachments, local-preview sharing, Codex thread forks, and normalized subagent activity. See [Using the app](docs/using-the-app.md) for the complete surface tour.

## The trust boundary

Room membership is controlled access to the active host's machine. Admitted members can see shared project context and request actions involving the host's project, terminal, browser, Git, GitHub, and Codex session. The host remains responsible for reviewing approvals.

- Room traffic uses RFC 9420 MLS through a Rust-owned native boundary.
- The relay stores routing and membership metadata, public device material, opaque MLS records, encrypted blobs, invites, and encrypted OAuth sessions. It is designed not to receive plaintext chat, attachment contents, project files, terminal output, or Codex/OpenAI credentials.
- The relay's GitHub proxy necessarily handles repository and pull-request fields for operations the user requests. The official OAuth grant is `read:user repo`, covering both public and private repositories the user can access.
- Invite links contain a private, single-use bearer capability in the URL fragment. Share the complete link only through a private channel; never paste it into an issue, log, diagnostic, or support request.
- MLS integration, host-authority policy, invite HPKE flow, and encrypted storage have extensive automated evidence but no independent professional audit. Encryption is the intended and tested boundary, not an independently verified guarantee.

Read the [threat model](docs/threat-model.md), [cryptography architecture](docs/cryptography.md), [alpha limitations](docs/alpha-limitations.md), and [security policy](SECURITY.md) before using private projects.

## Hosted alpha service

The official free-alpha relay is live on Railway at `https://relay.multaiplayer.com` and `wss://relay.multaiplayer.com/rooms`. It uses GitHub Device Flow for identity, encrypted persistent sessions, and authenticated workspace access. There is no separate multAIplayer password or billing account.

The service is free, experimental, and has no uptime, recovery, or response-time guarantee. Keep normal Git and project backups. The Profile drawer can delete hosted account data after owned teams are transferred or deleted and hosted rooms are handed off; shared encrypted records, other members' copies, local room state, GitHub's OAuth grant, and backup rotation are separate deletion boundaries.

Hosted use is governed by the [Privacy Policy](https://multaiplayer.com/privacy) and [Terms of Service](https://multaiplayer.com/terms). The [self-hosting guide](docs/self-hosting.md) covers independent relay deployments, and [If this project goes unmaintained](docs/if-unmaintained.md) explains the continuity plan.

## Run it locally

Prerequisites are Node.js 22, npm, Rust/Cargo, Xcode command-line tools, and Codex. On macOS:

```sh
npm ci
cp .env.example .env
npm run doctor
npm run tauri:dev
```

Set `GITHUB_CLIENT_ID` in `.env` to use GitHub sign-in. A stable `MULTAIPLAYER_RELAY_SESSION_SECRET` keeps encrypted OAuth sessions readable across relay restarts. The root development command starts the local relay and frontend used by Tauri; a normal browser intentionally receives only the native-app notice and never initializes a workspace, identity, relay connection, diagnostics, or MLS state.

Useful verification commands:

```sh
npm run check
npm test
npm run verify
```

`npm run verify` runs the TypeScript, UI, relay, package, Rust, and native verification layers. More expensive mutation, fuzzing, supply-chain, and reproducibility jobs run on their documented CI schedules. See [the CI policy](docs/ci-policy.md) for exact evidence boundaries.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/desktop` | React desktop UI and the Tauri/Rust native boundary |
| `apps/desktop/src-tauri/crates/mls-core` | MLS lifecycle, HPKE invites, encrypted state, and history/blob exporters |
| `apps/relay` | Authenticated HTTP/WebSocket relay, persistence, quotas, and GitHub proxy |
| `packages/protocol` | Shared wire records and runtime validation |
| `packages/codex` | Codex app-server client and compatibility contract |
| `packages/git`, `packages/github` | Host-side Git and GitHub adapters |
| `e2e` | UI contracts and real multi-process native journeys |
| `docs` | User guides, architecture, operations, decisions, and review material |

The supported Codex app-server range is 0.133.0–0.144.0. Newer versions are marked unverified, and contract-sensitive behavior fails closed until reviewed. Read [How Codex hosting works](docs/codex-hosting.md) for the exact local-account, approval, projection, and compatibility boundaries.

## Contributing and review

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), the [architecture walkthrough](docs/architecture-walkthrough.md), and the small issues in [`.github/good-first-issues`](.github/good-first-issues). Commits require a Developer Certificate of Origin sign-off.

Protocol and cryptography reviewers can use the [external review packet](docs/external-review-packet.md), which maps the security claims to implementation and test evidence. Report exploitable findings privately through the process in [SECURITY.md](SECURITY.md).

## Release integrity

Supported public artifacts are Apple-silicon-only, Developer ID signed, notarized, and published by the tagged release workflow. The workflow verifies the macOS 11 deployment target, bundled Mach-O architectures, live universal-link associations, entitlements, code signatures, stapled tickets, Gatekeeper acceptance, checksums, SBOM, provenance, and Sigstore signatures before publication. Local and ordinary CI packages are development evidence, not supported downloads.

Apache-2.0 licensed. Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
