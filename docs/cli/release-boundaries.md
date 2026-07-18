# CLI and desktop release boundaries

The command-line client and desktop app share a repository but not a release.
Until the CLI launch task is explicitly approved, CLI source and tests must not
enter desktop packaging, updater metadata, signing or notarization, version
synchronization, or the desktop release asset contract.

## Change classification

The changed-path detector reports explicit `cli`, `desktop`, `relay`, and
`shared` domains. A CLI-only path selects the CLI job without selecting desktop
build or packaging paths. A shared protocol, MLS, contract, or future shared
crate path selects both client suites. Relay paths remain independently visible.

The detector also reports `protected_release` and lists matching paths in the
GitHub Actions job summary. Protected paths include the desktop release workflow,
desktop npm and Cargo release manifests and locks, Tauri updater/signing inputs,
release tooling, version synchronization, and the desktop asset contract. A
reported protected path requires the exact approval described by the active CLI
task; classification does not grant that approval.

## CLI checks

CLI-selected changes run `tools/ci/run-cli-checks.mjs`. Before `apps/cli` exists,
the check proves that no npm CLI workspace or CLI reference has entered the
desktop release workflow, asset contract, or version tools. Once the standalone
Rust workspace exists, the same entry point also requires its independent lockfile
and runs formatting, Clippy, and tests with that workspace manifest.

Desktop release verification remains the existing `npm run verify` and release
tool test suite. CLI CI does not call desktop packaging, signing, notarization,
updater publication, version synchronization, or release-asset creation.
