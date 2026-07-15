import assert from "node:assert/strict";
import test from "node:test";
import { createAuthenticatedMetadataPayload, createTauriUpdateManifest } from "./write-tauri-update-manifest.mjs";

test("creates a static Tauri manifest bound to the tag and Apple-silicon asset", () => {
  const manifest = createTauriUpdateManifest({
    tag: "v0.1.0-alpha.0",
    packageVersion: "0.1.0-alpha.0",
    assetName: "multAIplayer-macos-arm64.app.tar.gz",
    archiveSignature: "a".repeat(64),
    metadataSignature: "b".repeat(64)
  });
  assert.equal(manifest.version, "0.1.0-alpha.0");
  assert.deepEqual(Object.keys(manifest.platforms), ["darwin-aarch64"]);
  assert.equal(
    manifest.platforms["darwin-aarch64"].url,
    "https://github.com/maddiedreese/multAIplayer/releases/download/v0.1.0-alpha.0/multAIplayer-macos-arm64.app.tar.gz"
  );
  const envelope = JSON.parse(manifest.notes);
  assert.equal(envelope.signature, "b".repeat(64));
  assert.deepEqual(JSON.parse(envelope.payload), {
    schema: "multaiplayer-updater-metadata-v1",
    version: "0.1.0-alpha.0",
    url: "https://github.com/maddiedreese/multAIplayer/releases/download/v0.1.0-alpha.0/multAIplayer-macos-arm64.app.tar.gz",
    archiveSignature: "a".repeat(64),
    notes: "See the v0.1.0-alpha.0 GitHub Release for reviewed release notes."
  });
  assert.equal(
    envelope.payload,
    createAuthenticatedMetadataPayload({
      tag: "v0.1.0-alpha.0",
      packageVersion: "0.1.0-alpha.0",
      assetName: "multAIplayer-macos-arm64.app.tar.gz",
      archiveSignature: "a".repeat(64)
    })
  );
});

test("rejects a tag/version mismatch", () => {
  assert.throws(
    () =>
      createTauriUpdateManifest({
        tag: "v0.2.0",
        packageVersion: "0.1.0",
        assetName: "multAIplayer-macos-arm64.app.tar.gz",
        archiveSignature: "a".repeat(64),
        metadataSignature: "b".repeat(64)
      }),
    /must match/
  );
});
