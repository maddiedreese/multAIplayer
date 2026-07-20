# multAIplayer CLI

The multAIplayer CLI is a line-oriented Apple-silicon macOS client for the same
encrypted rooms used by the desktop app. It supports GitHub authentication,
room creation and admission, encrypted chat, and human-approved Codex turns.

## Install

Install the current published CLI release:

```sh
curl -fsSL https://raw.githubusercontent.com/maddiedreese/multAIplayer/main/apps/cli/install.sh | sh
```

The installer downloads the current CLI release from this repository, verifies
its checksums, requires a timestamped Developer ID Application signature, runs
Apple's notarization check, installs a versioned app bundle under
`~/Library/Application Support/multAIplayer/cli`, and links the command at
`~/.local/bin/multAIplayer`. It does not use `sudo` or ask for an administrator
password. Set `MULTAIPLAYER_CLI_DATA_DIR` or `MULTAIPLAYER_CLI_BIN_DIR` to move
those user-local locations.

Homebrew, Intel macOS, Linux, and Windows packages are not available in the
first alpha.

## Quickstart

Authenticate and inspect the available rooms:

```sh
multAIplayer auth login --open
multAIplayer auth status
multAIplayer room list
```

The verified macOS release stores its GitHub and relay sessions, device
identity, and encryption key material in multAIplayer's private Data Protection
Keychain access group. Normal CLI use does not show Keychain permission prompts,
and the CLI cannot read unrelated Keychain items. When upgrading from an older
alpha, the CLI attempts a one-time legacy credential migration with Keychain UI
disabled. An unreadable legacy login is not allowed to trigger a system prompt;
sign in again when asked. If continuity-critical device or room keys cannot be
migrated, encrypted state fails closed and requires a clean rejoin. A clean
rejoin cannot restore history encrypted by the unavailable keys.

After a successful login, the CLI prints a short walkthrough from sign-in to
encrypted chat. Show it again at any time without changing local or remote
state:

```sh
multAIplayer walkthrough
```

Create and host a room from a local project:

```sh
multAIplayer room create --name "Compiler work" --project /path/to/project
multAIplayer room invite <room>
multAIplayer room open <room>
```

To join, run the command without putting the secret invitation capability in a
shell argument. At the fixed local prompt, paste the code and press Return. The
host keeps the non-secret invite ID printed by `room invite`, then reviews the
pending request with `room admissions`:

```sh
multAIplayer room join
```

```text
Paste the secret invitation code, then press Return:
```

```sh
multAIplayer room admissions <room> <invite-id>
```

Inside a room, use `@codex <task>` to propose work. The active host must approve
the exact proposal before Codex starts. Run `multAIplayer --help` for every room
and admission command.

### Hand off the host

Host handoff changes which room member may approve and run future host-local
work. It does not transfer a Codex login, credentials, sessions, processes, or a
project directory. In an open room, the outgoing host starts an offer and shares
its identifier in the encrypted room:

```text
/handoff offer
/handoff status
```

The incoming member requests that exact offer. The CLI prompts on the trusted
terminal to select and validate a local project; the encrypted room does not
grant access to the incoming device's filesystem.

```text
/handoff request <offer-id>
```

The outgoing host then reviews the exact requesting user, device, and MLS leaf
before approving the transfer:

```text
/handoff approve <offer-id>
```

After the authenticated MLS host-authority commit is applied, the incoming
device is the host for future work. Encrypted chat and authority convergence
continue live, but the incoming CLI host must exit and reopen the room before it
hosts Codex. Reopening starts a fresh host-local Codex context with the selected
project; no process or session continues across the handoff.

A Git patch included by a desktop host remains inert, review-only context in the
CLI. The reserved apply command fails closed because this alpha has no trusted
CLI patch-application adapter:

```text
/handoff apply <offer-id>
```

Use a separate trusted local workflow if you decide to apply a reviewed patch.
`/handoff apply` never applies it in this CLI version. Use `/handoff status` at
any point to inspect the current offer state. Authority loss cancels host-local
work that was still running on the outgoing host.

## Compatibility and limitations

| Capability                                                                          | CLI alpha     | Desktop alpha interoperability        |
| ----------------------------------------------------------------------------------- | ------------- | ------------------------------------- |
| Apple-silicon macOS                                                                 | Supported     | Supported                             |
| GitHub identity and device binding                                                  | Supported     | Same hosted identity boundary         |
| Encrypted rooms and chat                                                            | Supported     | Same relay protocol and MLS groups    |
| Room create/join/invite/admission                                                   | Supported     | Rooms may be created by either client |
| Codex proposals and hosted turns                                                    | Supported     | Either supported client may host      |
| Reconnect, replay, and encrypted history                                            | Supported     | Mixed-client journeys verified        |
| Authenticated host-authority handoff                                                | Supported     | Either supported client may hand off  |
| Applying a handoff Git patch                                                        | Not supported | CLI keeps received patches inert      |
| Browser, shared terminal, editor, attachments, GitHub panels, goals, and rich diffs | Not supported | Desktop-only records render safely    |
| Intel macOS, Linux, Windows, Homebrew                                               | Not supported | Deferred                              |

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

To remove the command and installed CLI versions while preserving encrypted
room state:

```sh
rm "$HOME/.local/bin/multAIplayer"
rm -R "$HOME/Library/Application Support/multAIplayer/cli"
```

Removing the command does not delete Keychain credentials. Removing the CLI
installation directory does not remove encrypted room state, which is stored
separately at `~/Library/Application Support/com.multaiplayer.cli`. Use
`multAIplayer auth logout` before uninstalling to clear the GitHub and relay
credentials. Use `multAIplayer room forget <room>` only when you intentionally
want to destroy that room's local association and history. Removing the separate
state directory is a destructive last resort: it forces every room on this Mac
to rejoin and permanently loses locally retained encrypted history.

## Build and package locally

Contributor and release packaging instructions are in [RELEASE.md](RELEASE.md).
