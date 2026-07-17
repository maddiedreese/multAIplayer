# Verifying releases

Supported macOS releases are built from an immutable tag reachable from `main`,
Developer ID-signed, notarized, and published with SHA-256 checksums. Automatic
updates have two sequential application checks: multAIplayer verifies signed
metadata that binds the version, archive URL, archive signature, and release
notes, then Tauri verifies the downloaded archive before installation.

Only the newest release that satisfies those requirements is supported. Unsigned
development artifacts are not releases, must not be linked as downloads, and must
never be identified as the latest supported release.

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

## Approve the exact release artifact

The `public-alpha-release` environment pauses publication after the signed and
notarized assets have been uploaded. Before approving that deployment, the
maintainer downloads the `release-assets-<tag>` artifact from the same workflow
run and checks the exact candidate rather than a local or ad-hoc build:

1. Mount the DMG, copy the app to Applications, and confirm Gatekeeper accepts
   and launches it.
2. With the app closed, open a fresh invitation link and confirm macOS launches
   the app with the invitation available.
3. With the app already running, open a second fresh invitation link and confirm
   the existing window focuses and receives it.
4. Complete GitHub sign-in, connect to the official relay, and exercise one
   native approval so the packaged app, OAuth callback, relay, and IPC boundary
   are all represented.

Any failure blocks environment approval. GitHub records who approved the
deployment and when; the approval means the reviewer performed this checklist,
but it is not cryptographic proof that the manual observations occurred.

## Release and updater failure handling

Prepare a release through an ordinary pull request so the same required checks
run as for every other change. After curating `Unreleased`, run:

```bash
VERSION="0.2.0-alpha.0"
npm version "$VERSION" --no-git-tag-version
npm run sync:release-versions
npm run finalize:release-changelog
npm run check:release-versions
```

After that pull request merges, create the tag from the updated `main`:

```bash
VERSION="0.2.0-alpha.0"
git checkout main
git pull --ff-only
git tag "v$VERSION"
git push origin "v$VERSION"
```

The tag starts the release workflow. Do not tag an unreviewed commit or move a
published release tag.

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
tag under review. Replace the placeholder below with a tag that the GitHub
Releases page identifies as a supported release; the documentation deliberately
does not pin this procedure to an obsolete prerelease tag.

```bash
git clone https://github.com/maddiedreese/multAIplayer.git
cd multAIplayer
git fetch --tags --force
RELEASE_TAG="replace-with-a-supported-release-tag"
git checkout --detach "$RELEASE_TAG"
git status --porcelain
npm install --global npm@11.16.0 --ignore-scripts
npm ci
npm run check:release-versions
npm run tauri:build:release -w @multaiplayer/desktop
```

Record the tag, commit, tool versions, platform, commands, and any differing
paths or hashes in a security report. Do not provide signing credentials for an
investigative build.
