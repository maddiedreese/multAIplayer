# multAIplayer CLI

The multAIplayer CLI is a line-oriented Apple-silicon macOS client for the same
encrypted rooms used by the desktop app. It supports GitHub authentication,
room creation and admission, encrypted chat, and human-approved Codex turns.

## Install

After an owner-published CLI release is available:

```sh
curl -fsSL https://raw.githubusercontent.com/maddiedreese/multAIplayer/main/apps/cli/install.sh | sh
```

The installer downloads the current CLI release from this repository, verifies
its checksums, requires a timestamped Developer ID Application signature, runs
macOS Gatekeeper assessment, and installs `multAIplayer` in `/usr/local/bin`.
It may ask for the Mac administrator password when that directory is not
writable. Set `MULTAIPLAYER_CLI_INSTALL_DIR` to use another directory.

Homebrew, Intel macOS, Linux, and Windows packages are not available in the
first alpha.

## Quickstart

Authenticate and inspect the available rooms:

```sh
multAIplayer auth login --open
multAIplayer auth status
multAIplayer room list
```

Create and host a room from a local project:

```sh
multAIplayer room create --name "Compiler work" --project /path/to/project
multAIplayer room invite <room>
multAIplayer room open <room>
```

To join, run the command without putting the secret invitation capability in a
shell argument, then paste it into standard input:

```sh
multAIplayer room join
```

Inside a room, use `@codex <task>` to propose work. The active host must approve
the exact proposal before Codex starts. Run `multAIplayer --help` for every room
and admission command.

## Compatibility and limitations

| Capability | CLI alpha | Desktop alpha interoperability |
| --- | --- | --- |
| Apple-silicon macOS | Supported | Supported |
| GitHub identity and device binding | Supported | Same hosted identity boundary |
| Encrypted rooms and chat | Supported | Same relay protocol and MLS groups |
| Room create/join/invite/admission | Supported | Rooms may be created by either client |
| Codex proposals and hosted turns | Supported | Either supported client may host |
| Reconnect, replay, and encrypted history | Supported | Mixed-client journeys verified |
| Host handoff involving the CLI | Not supported | Fails explicitly |
| Browser, shared terminal, editor, attachments, GitHub panels, goals, and rich diffs | Not supported | Desktop-only records render safely |
| Intel macOS, Linux, Windows, Homebrew | Not supported | Deferred |

The host must remain online to admit a participant and to run Codex. Codex uses
the host's local account, project, credentials, sandbox, and network policy.
Newer unverified Codex versions keep contract-sensitive features fail closed;
older unsupported versions cannot host. Local state loss requires a clean
rejoin and does not restore earlier encrypted history.

Read the authoritative [threat model](../../docs/threat-model.md#terminal-cli-boundary)
and [alpha limitations](../../docs/alpha-limitations.md) before using private or
high-value repositories. The MLS integration has not received an independent
professional security audit.

## Update and uninstall

Rerun the installation command to install the version selected by the maintained
installer. The CLI has no background updater and does not use the desktop
updater.

To remove only the executable:

```sh
sudo rm /usr/local/bin/multAIplayer
```

Uninstalling the executable does not delete Keychain credentials or encrypted
room state. Use `multAIplayer auth logout` before uninstalling to clear the
GitHub and relay credentials. Use `multAIplayer room forget <room>` only when
you intentionally want to destroy that room's local association and history.

## Build and package locally

Contributor and release packaging instructions are in [RELEASE.md](RELEASE.md).
