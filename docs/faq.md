# Frequently asked questions

This page is a short route into the maintained sources. It does not define security properties. Read the [threat model](threat-model.md) for normative claims and residual risks, and the [ADRs](decisions/README.md) for locked architecture choices.

## What is multAIplayer?

It is a macOS desktop room where trusted teammates collaborate around one locally hosted Codex session. The room combines conversation, intentionally shared project context, Codex activity, approvals, files and diffs, terminals, browser previews, Git/GitHub workflows, and explicit host handoff. It is not anonymous chat or general remote desktop software.

## Who controls the host machine?

One active host supplies the project, Codex process, tools, credentials, and approval decisions. Teammates can propose actions and see shared results, but consequential local work crosses an explicit host review and native authorization boundary. Approval still carries real risk; evaluate the current limits in the [threat model](threat-model.md) and [alpha limitations](alpha-limitations.md).

## How are rooms encrypted, and has this been audited?

The mechanism uses RFC 9420 MLS through `mls-rs`, with native-client encryption and exporter-derived protection for relevant payloads. The integration has not received an independent professional security audit. Mechanism details are in [cryptography](cryptography.md), and current security claims and limitations are in the [threat model](threat-model.md).

## What does the relay see and retain?

The relay authenticates devices, authorizes room access, routes encrypted records, and retains bounded operational state and backlog in SQLite. Some routing, identity, timing, size, and lifecycle metadata is necessarily visible. The exact inventory, retention boundaries, and deletion caveats live only in the [threat model](threat-model.md). Operators should use the [self-hosting guide](self-hosting.md).

## How do invitations work?

Official invites are HTTPS links with capability material in the URL fragment. A signed app can receive them through macOS universal links; the landing page offers an in-memory retry without storing the capability. Treat complete links as secrets and send them only through a private channel. See [Using the app](using-the-app.md) for the flow and the threat model for the boundary.

## Why GitHub and ChatGPT sign-in?

GitHub identity identifies room members and requests only `read:user`. Optional pull-request and Actions workflows request broad `repo` access on demand; the credentials are stored separately and only the identity token is sent to the relay. ChatGPT authorizes the Codex process on the active host. They are separate accounts and authority domains. GitHub-only identity is an alpha scope decision, not a permanent platform requirement.

## Can I self-host?

Yes. Internet-facing deployments need TLS, exact origins, authentication, persistent SQLite storage, backups, health monitoring, and abuse controls. Official desktop builds pin their trusted relay; using another origin requires a self-built client so network authority remains explicit. Follow [Self-hosting](self-hosting.md).

## What happens if the host disconnects?

Host-local Codex, terminal, browser, filesystem, and Git work becomes unavailable. Members with current room state may continue with capabilities that do not require that host. Explicit handoff can move future work to another member, but it cannot transfer live processes, credentials, or every unsaved state. Keep normal Git and project backups.

## What platforms and Codex versions are supported?

The public alpha is tested on Apple-silicon macOS 15. Its package deployment target is macOS 11, but macOS 11–14 are compatibility targets rather than tested support. Windows, Linux desktop, and Intel Mac releases are not supported. The exact tested Codex range is maintained in [Codex hosting](codex-hosting.md); newer versions remain unverified until their contracts are reviewed.

## How are updates delivered?

Supported releases use a pinned, signed Tauri updater channel and also publish notarized manual-download artifacts. Verify release checksums and Apple signatures using [Verifying releases](reproducible-builds.md). Development builds are not supported releases.

## Why can a new installation reach a device quota?

Device ids are permanently bound to their first MLS keys in this alpha. A new
installation or new key material consumes another one of the hosted relay's 25
registered-device slots per GitHub identity. Preserve an intact installation when
possible. There is no self-service device screen in the alpha; support can retire
a lost registration without deleting the account. Do not include keys, tokens, or
invite links in a support issue. Self-hosted operators can use the stopped-relay
procedure in [Relay operations](relay-operations.md#retiring-a-registered-device).

## Is the alpha appropriate for private work?

Start with a disposable or public repository, trusted collaborators, dummy credentials, a separate branch, and recoverable backups. Read the [threat model](threat-model.md) and [alpha limitations](alpha-limitations.md) before introducing private or sensitive code. Regulated, customer-sensitive, or high-stakes use should wait for independent review and greater operational maturity.

## Where do I report a problem?

Use GitHub issues for reproducible non-sensitive bugs. Report exploitable or confidential findings through the private process in [SECURITY.md](../SECURITY.md).
