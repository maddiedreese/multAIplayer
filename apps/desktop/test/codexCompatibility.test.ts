import assert from "node:assert/strict";
import test from "node:test";
import {
  assessCodexCompatibility,
  formatCodexCompatibilitySummary
} from "../src/lib/codexCompatibility";

test("Codex compatibility accepts the contract-tested version range", () => {
  assert.equal(assessCodexCompatibility("codex-cli 0.133.0").status, "supported");
  assert.equal(assessCodexCompatibility("codex-cli 0.140.2").status, "supported");
  assert.equal(assessCodexCompatibility("codex-cli 0.144.0").status, "supported");
});

test("Codex compatibility distinguishes old, new, and unknown versions", () => {
  assert.equal(assessCodexCompatibility("codex-cli 0.132.9").status, "unsupported_older");
  assert.equal(assessCodexCompatibility("codex-cli 0.145.0-alpha.1").status, "unverified_newer");
  assert.equal(assessCodexCompatibility("development build").status, "unknown");
  assert.match(formatCodexCompatibilitySummary("codex-cli 0.132.9"), /update required/);
  assert.match(formatCodexCompatibilitySummary("codex-cli 0.145.0"), /newer than tested/);
});
