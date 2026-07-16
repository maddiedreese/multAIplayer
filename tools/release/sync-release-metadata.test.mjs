import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertReleasePleaseBootstrap } from "../../scripts/check-release-versions.mjs";
import {
  discoverWorkspacePackagePaths,
  synchronizeCargoLockVersion,
  synchronizeCargoManifest,
  synchronizeWorkspaceManifests
} from "./sync-release-metadata.mjs";

test("workspace discovery synchronizes versions and every local dependency section", () => {
  const root = mkdtempSync(join(tmpdir(), "multaiplayer-version-sync-"));
  mkdirSync(join(root, "apps", "desktop"), { recursive: true });
  mkdirSync(join(root, "packages", "protocol"), { recursive: true });
  writeJson(join(root, "package.json"), {
    version: "1.2.3-alpha.4",
    workspaces: ["apps/*", "packages/*"]
  });
  writeJson(join(root, "apps", "desktop", "package.json"), {
    name: "@multaiplayer/desktop",
    version: "0.0.0",
    dependencies: { "@multaiplayer/protocol": "0.0.0" }
  });
  writeJson(join(root, "packages", "protocol", "package.json"), {
    name: "@multaiplayer/protocol",
    version: "0.0.0"
  });

  const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(discoverWorkspacePackagePaths(root, rootPackage).length, 2);
  synchronizeWorkspaceManifests(root);
  assert.deepEqual(readJson(join(root, "apps", "desktop", "package.json")), {
    name: "@multaiplayer/desktop",
    version: "1.2.3-alpha.4",
    dependencies: { "@multaiplayer/protocol": "1.2.3-alpha.4" }
  });
  assert.equal(readJson(join(root, "packages", "protocol", "package.json")).version, "1.2.3-alpha.4");
});

test("Cargo manifest and lock synchronizers change only the native package version", () => {
  assert.equal(
    synchronizeCargoManifest(
      '[package]\nname = "multaiplayer"\nversion = "0.1.0"\n\n[dependencies]\n',
      "0.2.0-alpha.1"
    ),
    '[package]\nname = "multaiplayer"\nversion = "0.2.0-alpha.1"\n\n[dependencies]\n'
  );
  assert.equal(
    synchronizeCargoLockVersion(
      '[[package]]\nname = "dependency"\nversion = "9.0.0"\n\n[[package]]\nname = "multaiplayer"\nversion = "0.1.0"\n',
      "0.2.0-alpha.1"
    ),
    '[[package]]\nname = "dependency"\nversion = "9.0.0"\n\n[[package]]\nname = "multaiplayer"\nversion = "0.2.0-alpha.1"\n'
  );
});

test("release-please bootstrap remains anchored while the manifest advances prospectively", () => {
  const bootstrapSha = "a".repeat(40);
  assert.doesNotThrow(() =>
    assertReleasePleaseBootstrap(releasePleaseFixture(bootstrapSha), { ".": "0.2.0-alpha.0" }, (sha) => {
      assert.equal(sha, bootstrapSha);
      return { commit: sha, isAncestor: true, tags: ["v0.1.0-alpha.0"] };
    })
  );
});

test("release-please bootstrap rejects a mismatched, non-ancestor, or untagged commit", () => {
  const bootstrapSha = "b".repeat(40);
  assert.throws(
    () =>
      assertReleasePleaseBootstrap(releasePleaseFixture(bootstrapSha), { ".": "0.2.0-alpha.0" }, () => ({
        commit: "c".repeat(40),
        isAncestor: true,
        tags: ["v0.1.0-alpha.0"]
      })),
    /resolve exactly as a commit/
  );
  assert.throws(
    () =>
      assertReleasePleaseBootstrap(releasePleaseFixture(bootstrapSha), { ".": "0.2.0-alpha.0" }, () => ({
        commit: bootstrapSha,
        isAncestor: false,
        tags: ["v0.1.0-alpha.0"]
      })),
    /must be an ancestor of HEAD/
  );
  assert.throws(
    () =>
      assertReleasePleaseBootstrap(releasePleaseFixture(bootstrapSha), { ".": "0.2.0-alpha.0" }, () => ({
        commit: bootstrapSha,
        isAncestor: true,
        tags: []
      })),
    /anchored by an existing version tag/
  );
});

function releasePleaseFixture(bootstrapSha) {
  return {
    "bootstrap-sha": bootstrapSha,
    packages: {
      ".": {
        "include-component-in-tag": false,
        draft: true,
        "force-tag-creation": true,
        "extra-files": [
          { path: "apps/desktop/package.json", jsonpath: "$.version" },
          { path: "apps/desktop/src-tauri/Cargo.toml", jsonpath: "$.package.version" }
        ]
      }
    }
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
