import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, normalizeSignedUpdate } from "../src/lib/core/updateCheck";

test("compareVersions compares release versions", () => {
  assert.equal(compareVersions("0.1.1-alpha.0", "0.1.0-alpha.0"), 1);
  assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
  assert.equal(compareVersions("0.1.0", "0.1.0-alpha.9"), 1);
  assert.equal(compareVersions("0.1.0-beta.1", "0.1.0-alpha.99"), 1);
  assert.equal(compareVersions("0.1.0-alpha.10", "0.1.0-alpha.2"), 1);
});

test("normalizeSignedUpdate accepts only bounded newer updater metadata", () => {
  const authenticatedBody = JSON.stringify({
    schema: "multaiplayer-updater-envelope-v1",
    payload: JSON.stringify({
      schema: "multaiplayer-updater-metadata-v1",
      version: "0.1.1-alpha.0",
      url: "https://github.com/maddiedreese/multAIplayer/releases/download/v0.1.1-alpha.0/multAIplayer-macos-arm64.app.tar.gz",
      archiveSignature: "signed archive",
      notes: "Security update"
    }),
    signature: "native comparator already verified this signature"
  });
  assert.deepEqual(
    normalizeSignedUpdate({ version: "0.1.1-alpha.0", currentVersion: "0.1.0-alpha.0", body: authenticatedBody }),
    {
      currentVersion: "0.1.0-alpha.0",
      latestVersion: "0.1.1-alpha.0",
      url: "https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.1-alpha.0",
      notes: "Security update"
    }
  );
  assert.equal(normalizeSignedUpdate({ version: "0.1.0", currentVersion: "0.1.0" }), null);
  assert.equal(normalizeSignedUpdate({ version: "not-semver", currentVersion: "0.1.0" }), null);
  assert.equal(normalizeSignedUpdate({ version: "0.1.1" }), null);
  assert.equal(normalizeSignedUpdate({ version: "0.1.1", currentVersion: "0.1.0", body: "unsigned notes" }), null);
  assert.equal(
    normalizeSignedUpdate({
      version: "999.0.0",
      currentVersion: "0.1.0",
      body: authenticatedBody
    }),
    null
  );
});
