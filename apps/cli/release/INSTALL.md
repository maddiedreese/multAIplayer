# Install multAIplayer CLI on Apple-silicon macOS

The CLI archive is independent from the multAIplayer desktop application and
does not use the desktop updater.

For an owner-published release, the supported installation command is:

```sh
curl -fsSL https://raw.githubusercontent.com/maddiedreese/multAIplayer/main/apps/cli/install.sh | sh
```

That installer performs the checksum, Developer ID metadata, secure timestamp,
and Gatekeeper checks below before copying the binary to `/usr/local/bin`.

## Manual verification and installation

1. Download the `multAIplayer-cli-*-darwin-arm64.tar.gz` archive, its matching
   `.manifest.json`, and `SHA256SUMS.txt` from the same owner-approved release.
2. Verify both files from their download directory:

   ```sh
   shasum -a 256 -c SHA256SUMS.txt
   ```

3. Extract the archive and verify the Apple code signature:

   ```sh
   tar -xzf multAIplayer-cli-*-darwin-arm64.tar.gz
   codesign --verify --strict --verbose=2 multAIplayer-cli-*-darwin-arm64/multAIplayer
   codesign -d --verbose=4 multAIplayer-cli-*-darwin-arm64/multAIplayer
   spctl --assess --type execute --verbose=4 multAIplayer-cli-*-darwin-arm64/multAIplayer
   ```

4. Inspect the `sourceRevision`, signature identity, and checksums in the release
   manifest, then install the executable somewhere on your `PATH`:

   ```sh
   sudo install -d -m 0755 /usr/local/bin
   sudo install -m 0755 multAIplayer-cli-*-darwin-arm64/multAIplayer /usr/local/bin/multAIplayer
   multAIplayer --version
   ```

Only owner-published Developer ID-signed artifacts with a secure signing
timestamp and successful Gatekeeper assessment are distribution builds. Confirm
that `codesign -d` reports a `Developer ID Application` authority, a 10-character
Team Identifier, and a timestamp matching the release manifest. An ad-hoc signature produced by the local
packaging default is timestamp-free, is labeled `adhoc-local-verification` in
the manifest, and is not a supported public release.
