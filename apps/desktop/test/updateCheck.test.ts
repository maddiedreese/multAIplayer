import assert from "node:assert/strict";
import test from "node:test";
import {
  compareVersions,
  fetchUpdateNotice,
  normalizeUpdateManifest
} from "../src/lib/updateCheck";

test("compareVersions compares release versions", () => {
  assert.equal(compareVersions("0.1.1-alpha.0", "0.1.0-alpha.0"), 1);
  assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
});

test("normalizeUpdateManifest accepts bounded HTTPS release manifests", () => {
  assert.deepEqual(
    normalizeUpdateManifest({
      version: "0.1.1-alpha.0",
      url: "https://multaiplayer.com/releases/v0.1.1",
      notes: "Security update",
      security: true
    }),
    {
      version: "0.1.1-alpha.0",
      url: "https://multaiplayer.com/releases/v0.1.1",
      notes: "Security update",
      security: true
    }
  );
  assert.equal(normalizeUpdateManifest({ version: "0.1.1", url: "http://example.com" }), null);
});

test("fetchUpdateNotice returns only newer manifests", async () => {
  const newer = await fetchUpdateNotice(
    "https://multaiplayer.com/releases/latest.json",
    "0.1.0-alpha.0",
    async () => new Response(JSON.stringify({
      version: "0.1.1-alpha.0",
      url: "https://multaiplayer.com/releases/v0.1.1",
      security: true
    }))
  );
  assert.equal(newer?.latestVersion, "0.1.1-alpha.0");
  assert.equal(newer?.security, true);

  const current = await fetchUpdateNotice(
    "https://multaiplayer.com/releases/latest.json",
    "0.1.1-alpha.0",
    async () => new Response(JSON.stringify({
      version: "0.1.1-alpha.0",
      url: "https://multaiplayer.com/releases/v0.1.1"
    }))
  );
  assert.equal(current, null);
});
