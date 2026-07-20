# multAIplayer CLI contributor guide

The `multAIplayer` command-line client is a second interface to the same
encrypted rooms used by the desktop app. It is not a remote shell or a separate
protocol implementation.

Start with:

- [User installation and quickstart](../../apps/cli/README.md)
- [CLI architecture and security boundaries](architecture.md)
- [CLI and desktop release boundaries](release-boundaries.md)
- [CLI packaging and publication](../../apps/cli/RELEASE.md)
- [Project threat model](../threat-model.md)
- [Codex app-server compatibility](../codex-hosting.md)

The CLI is an independent Rust workspace under `apps/cli` with its own manifest,
lockfile, tests, version, and release artifacts. Changes to shared protocol,
MLS, or Codex-host behavior must continue to pass both CLI and desktop tests.
Git history and pull requests are the implementation record; this directory
contains only maintained contributor guidance.
