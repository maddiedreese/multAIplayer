# multAIplayer CLI release packaging

The CLI has its own version, archive names, checksums, build manifest, and Apple
code signature. It is not an input to the desktop updater, notarization,
version synchronization, asset manifest, or release workflow.

From a clean Apple-silicon macOS checkout at the intended source commit, create
and verify a local ad-hoc-signed inspection package:

```sh
node apps/cli/release/package-cli.mjs --output apps/cli/dist
```

For a distribution candidate, select an already-installed, release-maintainer
Developer ID identity without exporting private key material:

```sh
MULTAIPLAYER_CLI_SIGNING_IDENTITY='Developer ID Application: Example (TEAMID)' \
  node apps/cli/release/package-cli.mjs --output apps/cli/dist
```

The packager accepts only the direct, non-symlinked `apps/cli/dist` output
directory. It requires a clean Git tree, uses the exact `HEAD` revision and
commit timestamp, builds the locked `aarch64-apple-darwin` target, signs only a
staged copy of `multAIplayer`, and immediately runs the independent package
verifier. It emits:

- `multAIplayer-cli-v<version>-darwin-arm64.tar.gz`;
- the matching `.manifest.json` with source revision, binary/archive checksums,
  and signature metadata;
- `SHA256SUMS.txt` covering both files.

The archive contains only the executable, build metadata, installation guide,
Apache-2.0 license, and generated notices for the locked Cargo graph. Packaging
fails if a dependency omits an SPDX license expression, supplies only an
unreviewed license file, or introduces an expression outside the checked-in
reviewed allowlist.

Local ad-hoc inspection signatures explicitly disable timestamps so repeated
local verification does not depend on a signing service. Developer ID
distribution signatures instead require Apple's secure timestamp and the
verifier requires Developer ID authority, Team ID, and timestamp evidence in
the manifest. Verification independently inspects the extracted executable with
`codesign -d` and requires its observed mode, authority, Team ID, and timestamp
to exactly match both manifests. The modes cannot be relabeled.

Packaging never tags, uploads, publishes, or changes a GitHub Release. A release
maintainer must submit the exact signed binary to Apple's notarization service
separately and require a successful Gatekeeper
assessment before publication. The standalone executable is assessed through
Apple's online notarization record rather than a stapled ticket, so assessment
may require network access. Notarization must not enter the desktop release
workflow or change the already verified CLI binary. External distribution is
not performed by the isolated packaging command.

The independent CLI tag convention is `cli-v<version>`. Publish the archive,
matching manifest, and `SHA256SUMS.txt` as assets of that exact tag only after
the signed and notarized candidate passes release verification. The maintained
installer resolves that exact version and tag; it never selects the desktop
application's latest release.
