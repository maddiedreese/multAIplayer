# Install multAIplayer CLI on Apple-silicon macOS

The CLI archive is independent from the multAIplayer desktop application and
does not use the desktop updater.

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
   ```

4. Inspect the `sourceRevision`, signature identity, and checksums in the release
   manifest, then install the executable somewhere on your `PATH`:

   ```sh
   install -m 0755 multAIplayer-cli-*-darwin-arm64/multAIplayer /usr/local/bin/multAIplayer
   multAIplayer --version
   ```

Only owner-published Developer ID-signed artifacts with a secure signing
timestamp are distribution builds. An ad-hoc signature produced by the local
packaging default is timestamp-free, is labeled `adhoc-local-verification` in
the manifest, and is not a supported public release.
