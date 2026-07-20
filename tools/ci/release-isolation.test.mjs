import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("CLI packaging remains independent from desktop release inputs", () => {
  assert.equal(existsSync(resolve(root, "apps/cli/Cargo.toml")), true);
  assert.equal(existsSync(resolve(root, "apps/cli/Cargo.lock")), true);
  assert.equal(existsSync(resolve(root, "apps/cli/package.json")), false);

  for (const path of [
    ".github/workflows/release.yml",
    "docs/release-assets.v1.json",
    "scripts/check-release-versions.mjs",
    "tools/release/sync-release-metadata.mjs"
  ]) {
    const source = readFileSync(resolve(root, path), "utf8");
    assert.equal(source.includes("apps/cli"), false, `${path} must not include CLI packaging`);
  }
});

test("ordinary CI requires selected CLI checks and does not change the release workflow", () => {
  const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const release = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");
  assert.match(ci, /^(?: {2})cli-core:\n/m);
  assert.match(ci, /if: needs\.changes\.outputs\.cli == 'true'/);
  assert.match(ci, /uses: \.\/\.github\/actions\/setup-node-npm/);
  assert.match(ci, /require_when_changed "\$CLI_CHANGED" "\$CLI_RESULT"/);
  assert.doesNotMatch(release, /apps\/cli|run-cli-checks|cli-core/);
});
