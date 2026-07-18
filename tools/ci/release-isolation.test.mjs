import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("unfinished CLI code is absent from desktop release inputs", () => {
  const result = spawnSync(process.execPath, ["tools/ci/run-cli-checks.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
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
