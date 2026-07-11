# Reproducing release builds

Third parties can rebuild a tagged multAIplayer release from source and compare its unsigned application payload with the published artifact. The project does not currently claim byte-for-byte reproducible signed macOS artifacts: Developer ID signatures, Apple notarization and stapling, DMG creation, ZIP metadata, runner images, and unpinned patch versions of some build tools can change bytes without a source change.

## Verify the published artifact

Download the release assets and `SHA256SUMS.txt` from the same GitHub Release, then run:

```bash
shasum -a 256 -c SHA256SUMS.txt
codesign --verify --deep --strict --verbose=2 multAIplayer.app
spctl -a -vvv -t install multAIplayer.app
```

A matching checksum proves that the downloaded bytes match the release manifest; Apple verification checks the published signing identity and notarization state. Neither proves that the binary matches source.

## Rebuild from the tagged source

Use a clean macOS 15 environment with Xcode command-line tools, Node.js 22, npm, Rust, and Cargo. The release workflow is the source of truth for the runner and command sequence; dependency resolution is locked by `package-lock.json` and `apps/desktop/src-tauri/Cargo.lock`.

```bash
git clone https://github.com/maddiedreese/multAIplayer.git
cd multAIplayer
git fetch --tags --force
git checkout --detach v0.1.0-alpha.0
git status --porcelain
npm ci
npm run release:preflight
npm run tauri:build:prebuilt -w @multaiplayer/desktop
```

Replace the example tag with the release under review. `git status --porcelain` must be empty before the build. Record `git rev-parse HEAD`, `node --version`, `npm --version`, `rustc --version`, `cargo --version`, `xcodebuild -version`, and `sw_vers` with the result. Do not provide signing credentials when producing the comparison build.

## Compare the payload

Compare stable application content rather than the outer signed/notarized DMG or ZIP. Extract the published app, copy both app bundles, and remove code signatures from the copies before inspecting them:

```bash
cp -R /path/to/published/multAIplayer.app /tmp/multaiplayer-published.app
cp -R apps/desktop/src-tauri/target/release/bundle/macos/multAIplayer.app /tmp/multaiplayer-rebuilt.app
codesign --remove-signature /tmp/multaiplayer-published.app
codesign --remove-signature /tmp/multaiplayer-rebuilt.app
diff -qr /tmp/multaiplayer-published.app /tmp/multaiplayer-rebuilt.app
```

A difference is a starting point for investigation, not automatic evidence of tampering. Compare individual hashes and executable metadata, then account for toolchain versions, absolute paths, timestamps, generated bundle metadata, and platform-specific native output. Report the tag, source commit, recorded tool versions, differing paths and hashes, and exact commands in a security report.

## Current reproducibility boundary

The official GitHub release workflow builds from a detached validated tag on `macos-15`, runs `npm ci` and the full verification suite, signs and notarizes with maintainer-held Apple credentials, verifies the resulting app and DMG, and publishes SHA-256 checksums. GitHub Actions are pinned by commit, but the hosted runner image, Node 22 patch release, Rust toolchain, Apple services, and packaging output are not yet frozen enough for a bit-for-bit reproducibility claim.

Improving this boundary means pinning exact toolchains, emitting build-environment provenance, normalizing archive timestamps and paths, and publishing an unsigned deterministic comparison artifact separately from the signed user-facing artifact.
