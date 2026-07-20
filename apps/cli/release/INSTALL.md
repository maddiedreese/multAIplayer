# Install multAIplayer CLI on Apple-silicon macOS

The CLI release is independent from the desktop app and does not use its
updater. Install it without `sudo`:

```sh
curl -fsSL https://raw.githubusercontent.com/maddiedreese/multAIplayer/main/apps/cli/install.sh | sh
```

The installer downloads one version-bound CLI release, verifies checksums and
safe archive paths, then verifies the complete `multAIplayer.app` bundle. It
requires the exact bundle ID, Developer ID team, secure timestamp, hardened
runtime signature, signed Data Protection Keychain entitlements, embedded
Developer ID provisioning profile, exact leaf-certificate authorization by that
profile, and successful Apple notarization check. It rejects unexpected archive
entries and all links or special entry types before extracting anything.

The versioned app is installed under
`~/Library/Application Support/multAIplayer/cli/versions/<version>/` and the
command is exposed through `~/.local/bin/multAIplayer`. No administrator access
is requested. Add `~/.local/bin` to `PATH` if your shell does not already include
it. `MULTAIPLAYER_CLI_DATA_DIR` and `MULTAIPLAYER_CLI_BIN_DIR` can override these
two user-local locations.

## Manual verification

Download the archive, matching `.manifest.json`, and `SHA256SUMS.txt` from the
same `cli-v<version>` release, then:

```sh
shasum -a 256 -c SHA256SUMS.txt
tar -xzf multAIplayer-cli-*-darwin-arm64.tar.gz
codesign --verify --strict --verbose=2 \
  multAIplayer-cli-*-darwin-arm64/multAIplayer.app
codesign -d --verbose=4 --entitlements - --xml \
  multAIplayer-cli-*-darwin-arm64/multAIplayer.app
security cms -D -i \
  multAIplayer-cli-*-darwin-arm64/multAIplayer.app/Contents/embedded.provisionprofile
codesign -vvvv -R='notarized' --check-notarization \
  multAIplayer-cli-*-darwin-arm64/multAIplayer.app
```

The signature and profile must both authorize only
`AXP55K75AX.com.multaiplayer.cli` for team `AXP55K75AX`, and `Info.plist` must
identify `com.multaiplayer.cli`. An ad-hoc inspection archive has no embedded
profile or protected Keychain entitlement and is not a public release.
