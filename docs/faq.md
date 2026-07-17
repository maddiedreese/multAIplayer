# Frequently asked questions

This page answers product questions and points to maintained sources. Security properties and residual risks belong only in the [threat model](threat-model.md); architecture decisions belong in the [ADRs](decisions/README.md).

## What is multAIplayer?

It is a macOS desktop room where trusted teammates collaborate around one locally hosted Codex session. The room combines conversation, intentionally shared project context, Codex activity, approvals, files and diffs, terminals, browser previews, Git/GitHub workflows, and explicit host handoff. It is not anonymous chat or general remote desktop software.

## Why GitHub and ChatGPT sign-in?

GitHub identifies room members. A separate, optional GitHub grant enables pull-request and Actions workflows. ChatGPT authorizes the Codex process on the active host. Details and permission boundaries are maintained in [Using the app](using-the-app.md) and [Codex hosting](codex-hosting.md).

## Can I self-host?

Yes. Follow [Self-hosting](self-hosting.md); official desktop builds pin their trusted relay, so another origin requires a self-built client.

## What happens if the host disconnects?

Host-local Codex, terminal, browser, filesystem, and Git work becomes unavailable. Members with current room state may continue with capabilities that do not require that host. Explicit handoff can move future work to another member, but it cannot transfer live processes, credentials, or every unsaved state. Keep normal Git and project backups.

## Why can a new installation reach a device quota?

Device IDs are permanently bound to their first MLS keys. A new installation consumes another registered-device slot. Preserve an intact installation when possible; support or a self-hosted operator can retire a lost registration using the procedure in [Relay operations](relay-operations.md#retiring-a-registered-device).

## Is the alpha appropriate for private work?

Start with a disposable or public repository, trusted collaborators, dummy credentials, a separate branch, and recoverable backups. Read [Alpha limitations](alpha-limitations.md) and the [threat model](threat-model.md) before introducing sensitive code.

## Where do I report a problem?

Use GitHub issues for reproducible non-sensitive bugs. Report exploitable or confidential findings through the private process in [SECURITY.md](../SECURITY.md).
