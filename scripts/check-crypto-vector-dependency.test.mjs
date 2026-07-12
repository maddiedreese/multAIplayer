import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("crypto-vector dependency policy passes within its review window", () => {
  const result = runPolicy("2026-10-01");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cryptography==45\.0\.5 is reviewed through 2026-10-01/);
});

test("crypto-vector dependency policy fails loudly after its review window", () => {
  const result = runPolicy("2026-10-02");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cryptography==45\.0\.5 review expired on 2026-10-01/);
  assert.match(result.stderr, /Review current releases and advisories/);
});

function runPolicy(date) {
  return spawnSync(process.execPath, ["scripts/check-crypto-vector-dependency.mjs"], {
    encoding: "utf8",
    env: { ...process.env, MULTAIPLAYER_POLICY_DATE: date }
  });
}
