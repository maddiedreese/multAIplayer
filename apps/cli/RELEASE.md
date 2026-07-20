# multAIplayer CLI release packaging

The CLI has its own version, archive, checksum manifest, app identity, and Apple
release contract. It is not an input to the desktop updater, desktop signing,
desktop notarization, version synchronization, or desktop asset manifest.

## Credential identity

Public CLI releases are packaged as `multAIplayer.app`, with the executable at
`Contents/MacOS/multAIplayer`. The stable credential identity is:

- bundle identifier: `com.multaiplayer.cli`;
- Apple team: `AXP55K75AX`;
- application identifier and sole Keychain access group:
  `AXP55K75AX.com.multaiplayer.cli`.

This app-style boundary lets the released CLI use the Data Protection Keychain
as the same signed application across launches and updates. It avoids the
per-executable Keychain ACL authorization dialog; replacing a bare executable
cannot provide that stable identity.

Developer ID packaging requires both an installed Developer ID Application
identity and an explicit Developer ID provisioning profile. The private signing
key remains in the maintainer's Keychain. Pass the profile without copying it
into the repository:

```sh
MULTAIPLAYER_CLI_SIGNING_IDENTITY='Developer ID Application: multAIplayer (AXP55K75AX)' \
MULTAIPLAYER_CLI_PROVISIONING_PROFILE='/absolute/path/to/multAIplayer CLI.provisionprofile' \
  node apps/cli/release/package-cli.mjs --output apps/cli/dist
```

The same profile can be supplied as `--provisioning-profile /absolute/path`.
Packaging decodes it with macOS, rejects expired/development profiles, and
requires the exact team and application identifier. Apple's profile must carry
only its team-scoped `AXP55K75AX.*` Keychain authorization; the signed app is
independently restricted to the exact CLI group above. It embeds the profile,
signs the whole app bundle with hardened runtime and the checked-in entitlements,
then independently reads the signed entitlements and profile back. It extracts
the actual leaf signing certificate
from the completed code signature and requires that exact DER SHA-256
fingerprint to appear once in the profile's `DeveloperCertificates` allowlist;
certificate display names are never used for authorization. A mismatch fails
packaging.

## Local inspection mode

From a clean Apple-silicon checkout, this command creates an ad-hoc inspection
artifact:

```sh
node apps/cli/release/package-cli.mjs --output apps/cli/dist
```

Ad-hoc mode deliberately embeds no provisioning profile and signs with no
protected credential entitlement. It therefore cannot impersonate or access
the public CLI's protected credential group. It is not publishable.

## Output and publication

The packager accepts only the direct, non-symlinked `apps/cli/dist` directory.
It requires a clean tree, records exact `HEAD` and its timestamp, builds the
locked Apple-silicon target, generates locked dependency notices, signs only the
staged CLI app, and runs the independent verifier. It emits:

- `multAIplayer-cli-v<version>-darwin-arm64.tar.gz`;
- a matching manifest with source, archive, binary, signature, entitlement, and
  provisioning-profile evidence;
- `SHA256SUMS.txt` binding the archive and manifest.

Developer ID artifacts require a secure timestamp and hardened runtime. Before
publication, submit the exact app-containing artifact to Apple's notarization
service without changing the signed bundle. Apple's online notarization check
for the extracted app must succeed. Packaging itself never tags, notarizes,
uploads, publishes, or writes any desktop release surface.

The independent tag is `cli-v<version>`. Publish only the exact verified,
notarized archive, manifest, and checksum file. The maintained installer selects
that exact CLI tag and never follows the desktop application's release channel.
