# Verifying releases

Supported macOS releases are built from an immutable tag reachable from `main`,
Developer ID-signed, notarized, and published with SHA-256 checksums. Automatic
updates have two sequential application checks: multAIplayer verifies signed
metadata that binds the version, archive URL, archive signature, and release
notes, then Tauri verifies the downloaded archive before installation.

The project does not claim bit-for-bit reproducible macOS artifacts. Apple
signing, notarization, DMG creation, hosted runner images, and packaging metadata
can change bytes without a source change.

## Verify the published artifact

Before a first install, compare the updater key with a source independent of the
GitHub release channel. Its minisign key id is `5F97AE260BE16B2F`; the SHA-256
fingerprint of `apps/desktop/src-tauri/updater-public.key` is:

```text
626f3a15f71fc8c5794c9ce00392a12f782cd05ec47a88ce27858b43ce774673
```

Verify it with `shasum -a 256 apps/desktop/src-tauri/updater-public.key` and
compare it with `https://multaiplayer.com/security/updater-key`.

Download the assets and `SHA256SUMS.txt` from the same GitHub Release, then run:

```bash
shasum -a 256 -c SHA256SUMS.txt
hdiutil attach multAIplayer_*_aarch64.dmg
codesign --verify --deep --strict --verbose=2 /Volumes/multAIplayer/multAIplayer.app
spctl -a -vvv -t install /Volumes/multAIplayer/multAIplayer.app
```

A matching checksum proves that the downloaded bytes match the release manifest.
Apple verification checks the signing identity and notarization state. Neither
proves that the binary matches source.

The [release asset contract](release-assets.v1.json) requires one manual-install
DMG, the updater `.app.tar.gz` and its signature, authenticated `latest.json`, and
the checksum manifest. The workflow verifies the app, DMG, updater metadata,
archive signature, and required asset set before publication. It
may replace assets only while a release remains private and refuses to rebuild or
modify an already-public release.

## Release and updater failure handling

If only updater-channel advancement fails after publication, use **Re-run failed
jobs** on the original GitHub Actions run. That preserves the tagged build and
retries the channel job. A new full dispatch for a public tag is intentionally
rejected.

The updater channel is serialized and refuses SemVer regression. Before writing
the channel, it downloads the public release, verifies GitHub's asset digests,
checks the required asset set, and rechecks that the tag still identifies the
original source commit.

## Rebuild from tagged source

An independent source build remains useful for investigation, but it is not an
automated release eligibility claim. Use a clean macOS environment and the exact
tag under review:

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

Record the tag, commit, tool versions, platform, commands, and any differing
paths or hashes in a security report. Do not provide signing credentials for an
investigative build.
