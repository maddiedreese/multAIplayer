# Frequently asked questions

This page answers product questions and points to maintained sources. Security properties and residual risks belong only in the [threat model](threat-model.md); architecture decisions belong in the [ADRs](decisions/README.md).

## What is multAIplayer?

It is a native macOS desktop and command-line client where trusted teammates collaborate around one locally hosted Codex session. Both clients share encrypted rooms, conversation, Codex activity, approvals, and explicit host handoff. The desktop also provides files and diffs, shared terminals, browser previews, and Git/GitHub workflows. It is not anonymous chat or general remote desktop software.

## How do I install and start using the CLI?

Install the signed, notarized Apple-silicon CLI without `sudo`:

```sh
curl -fsSL https://raw.githubusercontent.com/maddiedreese/multAIplayer/main/apps/cli/install.sh | sh
```

Then run `multAIplayer auth login --open`. GitHub opens for device authorization, the terminal confirms the authenticated account, and the CLI prints a walkthrough covering room creation or joining, encrypted chat, Codex hosting, and host handoff. Repeat it at any time with `multAIplayer walkthrough`. The [CLI guide](../apps/cli/README.md) documents the complete flow and current limitations.

## Why GitHub and ChatGPT sign-in?

GitHub identifies room members. A separate, optional GitHub grant enables pull-request and Actions workflows. ChatGPT authorizes the Codex process on the active host. Details and permission boundaries are maintained in [Using the app](using-the-app.md) and [Codex hosting](codex-hosting.md).

## Can I self-host?

Yes. Follow [Self-hosting](self-hosting.md); official desktop builds pin their trusted relay, so another origin requires a self-built client.

## What happens if the host disconnects?

Host-local Codex, terminal, browser, filesystem, and Git work becomes unavailable. Members with current room state may continue with capabilities that do not require that host. Explicit handoff can move future work to another member, but it cannot transfer live processes, credentials, or every unsaved state. The desktop and CLI use the same authenticated handoff boundary. The incoming host selects its own local project and uses its own credentials and Codex session; room authority does not grant filesystem access or transfer a running process. Keep normal Git and project backups.

## Why can a new installation reach a device quota?

Device IDs are permanently bound to their first MLS keys. A new installation consumes another registered-device slot. Preserve an intact installation when possible; support or a self-hosted operator can retire a lost registration using the procedure in [Relay operations](relay-operations.md#retiring-a-registered-device).

## Is the alpha appropriate for private work?

Start with a disposable or public repository, trusted collaborators, dummy credentials, a separate branch, and recoverable backups. Read [Alpha limitations](alpha-limitations.md) and the [threat model](threat-model.md) before introducing sensitive code.

## Where do I report a problem?

Use GitHub issues for reproducible non-sensitive bugs. Report exploitable or confidential findings through the private process in [SECURITY.md](../SECURITY.md).
