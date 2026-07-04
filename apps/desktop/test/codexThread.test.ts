import assert from "node:assert/strict";
import test from "node:test";
import { maxCodexThreadIdChars, normalizeCodexThreadId } from "../src/lib/codexThread";

test("normalizeCodexThreadId trims supported local Codex thread ids", () => {
  assert.equal(normalizeCodexThreadId("  thr_123-abc:def.456  "), "thr_123-abc:def.456");
});

test("normalizeCodexThreadId rejects blank, oversized, and path-like ids", () => {
  assert.equal(normalizeCodexThreadId("   "), null);
  assert.equal(normalizeCodexThreadId("bad thread"), null);
  assert.equal(normalizeCodexThreadId("bad/thread"), null);
  assert.equal(normalizeCodexThreadId("x".repeat(maxCodexThreadIdChars + 1)), null);
  assert.equal(normalizeCodexThreadId({ id: "thr_123" }), null);
});
