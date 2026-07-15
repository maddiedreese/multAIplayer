import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, fetchUpdateNotice, normalizeUpdateManifest } from "../src/lib/core/updateCheck";

test("compareVersions compares release versions", () => {
  assert.equal(compareVersions("0.1.1-alpha.0", "0.1.0-alpha.0"), 1);
  assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
  assert.equal(compareVersions("0.1.0", "0.1.0-alpha.9"), 1);
  assert.equal(compareVersions("0.1.0-beta.1", "0.1.0-alpha.99"), 1);
  assert.equal(compareVersions("0.1.0-alpha.10", "0.1.0-alpha.2"), 1);
});

test("normalizeUpdateManifest accepts bounded HTTPS release manifests", () => {
  assert.deepEqual(
    normalizeUpdateManifest({
      version: "0.1.1-alpha.0",
      url: "https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.1-alpha.0",
      notes: "Security update",
      security: true
    }),
    {
      version: "0.1.1-alpha.0",
      url: "https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.1-alpha.0",
      notes: "Security update",
      security: true
    }
  );
  assert.equal(normalizeUpdateManifest({ version: "0.1.1", url: "http://example.com" }), null);
  assert.equal(normalizeUpdateManifest({ version: "0.1.1", url: "https://example.com/releases/v0.1.1" }), null);
  assert.equal(
    normalizeUpdateManifest({
      version: "0.1.1-alpha.0",
      url: "https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.1"
    }),
    null
  );
  assert.equal(
    normalizeUpdateManifest({
      version: "not-semver",
      url: "https://github.com/maddiedreese/multAIplayer/releases/tag/vnot-semver"
    }),
    null
  );
});

test("fetchUpdateNotice returns only newer manifests", async () => {
  const newer = await fetchUpdateNotice(
    "https://multaiplayer.com/releases/latest.json",
    "0.1.0-alpha.0",
    async () =>
      new Response(
        JSON.stringify({
          version: "0.1.1-alpha.0",
          url: "https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.1-alpha.0",
          security: true
        })
      )
  );
  assert.equal(newer?.latestVersion, "0.1.1-alpha.0");
  assert.equal(newer?.security, true);

  const current = await fetchUpdateNotice(
    "https://multaiplayer.com/releases/latest.json",
    "0.1.1-alpha.0",
    async () =>
      new Response(
        JSON.stringify({
          version: "0.1.1-alpha.0",
          url: "https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.1-alpha.0"
        })
      )
  );
  assert.equal(current, null);
});
