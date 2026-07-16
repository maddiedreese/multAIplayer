# Reproducing release builds

Third parties can rebuild a tagged multAIplayer release from source and compare its unsigned application payload with the published artifact. Each release also publishes an advisory normalized-payload comparison produced by a second isolated unsigned build. The project does not currently claim byte-for-byte reproducible signed macOS artifacts: Developer ID signatures, Apple notarization and stapling, DMG creation, ZIP metadata, runner images, and unpinned patch versions of some build tools can change bytes without a source change.

## Verify the published artifact

Before the first install, record the updater key independently of the release channel. Its minisign key id is `5F97AE260BE16B2F`; the SHA-256 fingerprint of the exact committed `apps/desktop/src-tauri/updater-public.key` file is:

```text
626f3a15f71fc8c5794c9ce00392a12f782cd05ec47a88ce27858b43ce774673
```

Verify it locally with `shasum -a 256 apps/desktop/src-tauri/updater-public.key` and compare the result with `https://multaiplayer.com/security/updater-key`, which is served outside the GitHub release channel. A matching fingerprint anchors the public key; it does not prove that a particular release or maintainer account is uncompromised.

Download the release assets and `SHA256SUMS.txt` from the same GitHub Release, then run:

```bash
shasum -a 256 -c SHA256SUMS.txt
codesign --verify --deep --strict --verbose=2 multAIplayer.app
spctl -a -vvv -t install multAIplayer.app
```

Verify the keyless Sigstore bundle for the checksum manifest before trusting those hashes:

```bash
cosign verify-blob \
  --bundle SHA256SUMS.txt.sigstore.json \
  --certificate-identity-regexp '^https://github.com/maddiedreese/multAIplayer/.github/workflows/release.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS.txt
```

The identity constraint binds the bundle to this repository's tagged release workflow. Inspect and replace the
constraint deliberately if the release workflow path or repository ownership changes.

The release also contains `multaiplayer.spdx.json`, generated from the finished `.app` bundle, and its Sigstore bundle; GitHub provenance attestations; `latest.json`; the `.app.tar.gz` updater bundle and its `.sig`; and `desktop-reproducibility-evidence.zip`. The versioned, machine-readable [release asset contract](release-assets.v1.json) is the canonical exact list used by local build validation, remote draft verification, and the public website. A failed publishing rerun may reconcile assets only while the GitHub Release remains a draft; the workflow refuses to overwrite an already-public release. `latest.json` embeds a signature over a canonical payload binding its version, exact archive URL, archive signature, and human notes. The release workflow runs `verify_update_manifest` before publication to verify that metadata binding and the actual archive signature against `apps/desktop/src-tauri/updater-public.key`. Installed apps run the same metadata verification in Rust before reporting an update and Tauri verifies the archive again before installation; the Sigstore/checksum path is independent evidence for manual verification, not a substitute for either updater check.

A matching checksum proves that the downloaded bytes match the release manifest; Apple verification checks the published signing identity and notarization state. Neither proves that the binary matches source.

If only updater-channel advancement fails after publication, use **Re-run failed
jobs** on that original GitHub Actions run. A new full dispatch for a public tag is
intentionally rejected before build or attestation. An ambiguous publish-job retry
first authenticates the retained build assets and the complete downloaded public
asset set against GitHub's SHA-256 metadata, then skips signing and release
mutation before retrying the channel.

## Rebuild from the tagged source

Use a clean macOS 15 environment with Xcode command-line tools, Node.js 22, npm 11.16.0, Rust, and Cargo. The release workflow is the source of truth for the runner and command sequence; dependency resolution is locked by `package-lock.json` and `apps/desktop/src-tauri/Cargo.lock`. The root `allowScripts` policy permits only exact reviewed install scripts required by locked native and frontend build dependencies, and `.npmrc` makes an unreviewed addition fail the install.

```bash
git clone https://github.com/maddiedreese/multAIplayer.git
cd multAIplayer
git fetch --tags --force
git checkout --detach v0.1.0-alpha.0
git status --porcelain
npm install --global npm@11.16.0 --ignore-scripts
npm ci
npm run release:preflight
npm run tauri:build:release -w @multaiplayer/desktop
```

Replace the example tag with the release under review. `git status --porcelain` must be empty before the build. Record `git rev-parse HEAD`, `node --version`, `npm --version`, `rustc --version`, `cargo --version`, `xcodebuild -version`, and `sw_vers` with the result. Do not provide signing credentials when producing the comparison build.

## Compare the payload

Compare stable application content rather than the outer signed/notarized DMG or ZIP. The release workflow runs `tools/release/compare-macos-app-payloads.mjs` against the signed app and an isolated `--no-sign` rebuild. It removes code signatures from copies, excludes signature resources, and compares file paths, executable bits, symlink targets, sizes, and SHA-256 hashes. Its manifests, differences, result, and recorded tool versions are packaged in `desktop-reproducibility-evidence.zip`. To investigate independently, extract the published app, copy both bundles, and remove signatures before inspecting them:

```bash
cp -R /path/to/published/multAIplayer.app /tmp/multaiplayer-published.app
cp -R apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/multAIplayer.app /tmp/multaiplayer-rebuilt.app
codesign --remove-signature /tmp/multaiplayer-published.app
codesign --remove-signature /tmp/multaiplayer-rebuilt.app
diff -qr /tmp/multaiplayer-published.app /tmp/multaiplayer-rebuilt.app
```

A difference is a starting point for investigation, not automatic evidence of tampering. Compare individual hashes and executable metadata, then account for toolchain versions, absolute paths, timestamps, generated bundle metadata, and platform-specific native output. Report the tag, source commit, recorded tool versions, differing paths and hashes, and exact commands in a security report.

## Current reproducibility boundary

### Relay normalized runtime-equivalence proof

The relay has a narrower normalized runtime-equivalence proof in addition to the desktop rebuild contract. Its base image is pinned by digest and its Docker build receives a fixed `SOURCE_DATE_EPOCH`. From a clean checkout with Docker BuildKit enabled, run:

```bash
npm run verify:relay-runtime-equivalence
```

The verifier performs two independent no-cache builds. Without starting the relay, it runs a read-only, root filesystem walker with networking and the image healthcheck disabled. It compares the images' architecture, operating system, and complete Docker runtime configuration, plus a deterministic manifest containing every included path's type, permission mode, numeric owner and group, each symlink target, and each regular file's size and SHA-256 digest. It excludes Docker-created runtime paths (`/.dockerenv`, `/proc`, `/sys`, `/dev`, `/etc/hosts`, `/etc/hostname`, and `/etc/resolv.conf`). The image-owned `/data` directory remains included, so its mode and ownership are checked even though deployments normally mount mutable storage there. A mismatch or an unreadable or unexpected special entry fails the command; a match prints separate hashes for the runtime configuration and normalized filesystem manifest.

This proves that the application-visible runtime files and launch configuration covered by the manifest agree for the current source, lockfile, base digest, build platform, and Docker/BuildKit implementation. It deliberately does not compare image IDs, compressed layers, layer ordering, build history, timestamps, extended attributes, Linux capabilities, or hard-link identity, and it does not claim cross-architecture equality. Those properties may differ even when normalized runtime content is the same; security scanning and the pinned base-image policy cover different questions.

The official GitHub release workflow keeps the generated GitHub Release as a draft, runs a blocking two-client native MLS journey against the validated tag, and then builds from that detached tag on `macos-15` in a read-only build job. It installs npm 11.16.0, runs `npm ci` and the full release preflight, signs and notarizes with maintainer-held Apple credentials, signs both a Tauri updater bundle and its version/URL/signature metadata binding with a separate release key, verifies the app, DMG, metadata, updater archive, and canonical asset set, and hands only the resulting artifact bundle to a separate publishing job. The protected `public-alpha-release` environment gates publication. GitHub records the deployment status, timestamps, and reviewer identity when required reviewers are configured. Before approving it, the maintainer completes the cold/warm universal-link, accessibility, and exploratory checks against the tagged build; the environment record does not itself prove those checks ran. Publication emits SHA-256 checksums, an artifact-scoped SPDX SBOM, GitHub build-provenance attestations, keyless Sigstore bundles for the checksum manifest and SBOM, and the advisory normalized-payload comparison before removing draft status. GitHub Actions and Docker base images are pinned by digest, but the hosted runner image, Node 22 patch release, Rust toolchain, Apple services, and packaging output are not yet frozen enough for a bit-for-bit reproducibility claim.

Improving this boundary means pinning exact toolchains, emitting build-environment provenance, normalizing archive timestamps and paths, and publishing an unsigned deterministic comparison artifact separately from the signed user-facing artifact.
