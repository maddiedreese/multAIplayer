# CLI and desktop release boundaries

The command-line client and desktop app share a repository but not a release.
CLI source and tests must not enter desktop packaging, updater metadata, signing
or notarization, version synchronization, or the desktop release asset contract.

## Change classification

The changed-path detector reports explicit `cli`, `desktop`, `relay`, and
`shared` domains. A CLI-only path selects the CLI job without selecting desktop
build or packaging paths. A shared protocol, MLS, contract, or future shared
crate path selects both client suites. Relay paths remain independently visible.

The detector also reports `protected_release` and lists matching paths in the
GitHub Actions job summary. Protected paths include the desktop release workflow,
desktop npm and Cargo release manifests and locks, Tauri updater/signing inputs,
release tooling, version synchronization, and the desktop asset contract. A
reported protected path requires explicit release-maintainer review;
classification does not grant permission to change it.

## CLI checks

CLI-selected changes run `tools/ci/run-cli-checks.mjs`. The check proves that no
npm CLI workspace or CLI reference has entered the desktop release workflow,
asset contract, or version tools. It requires the standalone Rust workspace's
independent lockfile and runs formatting, Clippy, packaging policy, and tests
with that workspace manifest.

Desktop release verification remains the existing `npm run verify` and release
tool test suite. CLI CI does not call desktop packaging, signing, notarization,
updater publication, version synchronization, or release-asset creation.

## CLI package boundary

CLI archives are configured and built only by `apps/cli/release`. They use the
CLI Cargo version, the `multAIplayer-cli-v<version>-darwin-arm64` artifact
namespace, an independent checksum manifest, and source-revision metadata. The
archive contains an app-like `multAIplayer.app`; it does not reuse or modify the
desktop application bundle.

The public CLI identity is fixed to bundle `com.multaiplayer.cli`, Apple team
`AXP55K75AX`, and the sole Data Protection Keychain access group
`AXP55K75AX.com.multaiplayer.cli`. Distribution packaging requires an explicit,
unexpired Developer ID provisioning profile authorizing that exact tuple. It
embeds the profile, enables hardened runtime, signs the app bundle with the
reviewed entitlements, and verifies the resulting signature, entitlements, and
profile. The exact observed leaf certificate fingerprint—not its potentially
duplicated common name—must appear once in the profile's DeveloperCertificates
allowlist. This stable signed application boundary prevents interactive
Keychain ACL prompts in the installed release.

The local default remains a timestamp-free ad-hoc inspection mode, but carries
neither the distribution profile nor protected credential entitlements. It
cannot access the public CLI credential group. Manifest metadata and independent
verification keep inspection and distribution modes fail-closed and distinct.

The CLI packager requires a clean exact source commit and cannot tag, upload,
publish, notarize, update a channel, or write desktop release metadata.
Publication is a separate, explicit release-maintainer operation.
The installer separately verifies the archive checksum, app bundle identity,
Developer ID metadata, signed entitlements, embedded profile, and Apple's
notarization result. It installs a versioned bundle in the user's local data
directory and creates `~/.local/bin/multAIplayer`; it never requires `sudo` by
default.
