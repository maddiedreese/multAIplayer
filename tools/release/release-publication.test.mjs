import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertChannelDoesNotRegress, compareSemver } from "./check-updater-channel-order.mjs";
import { validateReleaseAssetDigests } from "./validate-release-asset-digests.mjs";

test("release asset metadata must exactly authenticate downloaded bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "multaiplayer-release-digests-"));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "latest.json"), "candidate");
  const digest = createHash("sha256").update("candidate").digest("hex");
  assert.deepEqual(validateReleaseAssetDigests(directory, [{ name: "latest.json", digest: `sha256:${digest}` }]), [
    "latest.json"
  ]);
  assert.throws(
    () => validateReleaseAssetDigests(directory, [{ name: "latest.json", digest: `sha256:${"0".repeat(64)}` }]),
    /does not match/
  );
  assert.throws(() => validateReleaseAssetDigests(directory, [{ name: "latest.json", digest: null }]), /unavailable/);
});

test("an existing public release must match both the current build and downloaded release", () => {
  const root = mkdtempSync(join(tmpdir(), "multaiplayer-public-retry-"));
  const build = join(root, "build");
  const published = join(root, "published");
  mkdirSync(build);
  mkdirSync(published);
  writeFileSync(join(build, "latest.json"), "current-build");
  writeFileSync(join(published, "latest.json"), "published-bytes");
  const digest = createHash("sha256").update("published-bytes").digest("hex");
  const metadata = [{ name: "latest.json", digest: `sha256:${digest}` }];
  assert.deepEqual(validateReleaseAssetDigests(published, metadata), ["latest.json"]);
  assert.throws(() => validateReleaseAssetDigests(build, metadata), /does not match/);
});

test("an ambiguous publish retry authenticates the retained build subset independently", () => {
  const directory = mkdtempSync(join(tmpdir(), "multaiplayer-build-subset-"));
  writeFileSync(join(directory, "latest.json"), "retained-build");
  const digest = createHash("sha256").update("retained-build").digest("hex");
  const metadata = [
    { name: "latest.json", digest: `sha256:${digest}` },
    { name: "unselected-release-asset.txt", digest: `sha256:${"1".repeat(64)}` }
  ];
  assert.deepEqual(validateReleaseAssetDigests(directory, metadata, ["latest.json"]), ["latest.json"]);
  assert.throws(
    () => validateReleaseAssetDigests(directory, metadata, ["latest.json", "missing.dmg"]),
    /missing missing\.dmg/
  );
  assert.throws(
    () => validateReleaseAssetDigests(directory, metadata, ["latest.json", "latest.json"]),
    /must be unique/
  );
});

test("updater channel ordering follows strict SemVer precedence", () => {
  assert.equal(compareSemver("0.1.0-alpha.10", "0.1.0-alpha.2"), 1);
  assert.equal(compareSemver("0.1.0", "0.1.0-rc.9"), 1);
  assert.equal(compareSemver("0.1.0+build.2", "0.1.0+build.1"), 0);
  assert.doesNotThrow(() => assertChannelDoesNotRegress({ version: "0.2.0-alpha.0" }, { version: "0.1.9" }));
  assert.throws(
    () => assertChannelDoesNotRegress({ version: "0.1.0-alpha.1" }, { version: "0.1.0-alpha.2" }),
    /regression/
  );
  assert.throws(
    () =>
      assertChannelDoesNotRegress(
        { version: "0.1.0+build.2", notes: "different" },
        { version: "0.1.0+build.1", notes: "published" }
      ),
    /byte-for-byte/
  );
  assert.throws(() => compareSemver("01.2.3", "1.2.3"), /strict SemVer/);
});
