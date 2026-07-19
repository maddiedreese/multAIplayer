# multAIplayer CLI release packaging

The CLI has its own version, archive names, checksums, build manifest, and Apple
code signature. It is not an input to the desktop updater, notarization,
version synchronization, asset manifest, or release workflow.

From a clean Apple-silicon macOS checkout at the intended source commit, create
and verify a local ad-hoc-signed inspection package:

```sh
node apps/cli/release/package-cli.mjs --output apps/cli/dist
```

For an owner-authorized distribution build, select an already-installed,
owner-managed Developer ID identity without exporting private key material:

```sh
MULTAIPLAYER_CLI_SIGNING_IDENTITY='Developer ID Application: Example (TEAMID)' \
  node apps/cli/release/package-cli.mjs --output apps/cli/dist
```

The packager requires a clean Git tree, uses the exact `HEAD` revision and
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
the manifest. The modes have distinct manifest values and cannot be relabeled.

Packaging never tags, uploads, publishes, or changes a GitHub Release. Those
actions remain owner-controlled. Notarization and external distribution are not
part of this isolated CLI packaging task.
