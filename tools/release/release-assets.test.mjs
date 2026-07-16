import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("release asset validation requires install and updater assets but permits unrelated extras", () => {
  const directory = mkdtempSync(join(tmpdir(), "multaiplayer-assets-"));
  const contract = JSON.parse(readFileSync("docs/release-assets.v1.json", "utf8"));
  const releaseVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  for (const name of contract.requiredExactNames) writeFileSync(join(directory, name), "fixture");
  const dmgName = `multAIplayer_${releaseVersion}_aarch64.dmg`;
  writeFileSync(join(directory, dmgName), "fixture");

  const validate = () => spawnSync(process.execPath, ["tools/release/check-release-assets.mjs", "build", directory]);
  assert.equal(validate().status, 0);
  writeFileSync(join(directory, "optional-debug-notes.txt"), "fixture");
  assert.equal(validate().status, 0);
  writeFileSync(join(directory, "multAIplayer_9.9.9-alpha.9_aarch64.dmg"), "stale fixture");
  assert.notEqual(validate().status, 0, "a second stale DMG must not become a supported download");
});

test("relay runtime closure prunes packages outside the locked production tree", () => {
  const root = mkdtempSync(join(tmpdir(), "multaiplayer-relay-closure-"));
  const nodeModules = join(root, "node_modules");
  const packageDirectory = (name) => join(nodeModules, ...name.split("/"));
  const writePackage = (name, version) => {
    mkdirSync(packageDirectory(name), { recursive: true });
    writeFileSync(join(packageDirectory(name), "package.json"), JSON.stringify({ name, version }));
  };
  writePackage("@multaiplayer/relay", "1.0.0");
  writePackage("allowed", "2.0.0");
  writePackage("unexpected", "9.0.0");
  const treePath = join(root, "tree.json");
  const evidencePath = join(root, "evidence.json");
  writeFileSync(
    treePath,
    JSON.stringify({
      dependencies: {
        "@multaiplayer/relay": { version: "1.0.0", dependencies: { allowed: { version: "2.0.0" } } }
      }
    })
  );
  const prune = spawnSync(process.execPath, [
    "tools/release/relay-runtime-dependency-closure.mjs",
    "prune",
    nodeModules,
    evidencePath,
    treePath
  ]);
  assert.equal(prune.status, 0);
  const verify = spawnSync(process.execPath, [
    "tools/release/relay-runtime-dependency-closure.mjs",
    "verify",
    nodeModules,
    evidencePath
  ]);
  assert.equal(verify.status, 0);
});
