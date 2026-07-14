import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMlsValidatorBenchmarkPolicy, mlsValidatorBenchmarkPolicy } from "./mls-validator-benchmark-policy.mjs";

function report(overrides = {}) {
  return {
    benchmark: mlsValidatorBenchmarkPolicy.benchmark,
    samples: 100,
    concurrency: 1,
    latencyMs: { mean: 12, p95: 20 },
    ...overrides
  };
}

test("accepts a stable single-process validator benchmark", () => {
  assert.deepEqual(evaluateMlsValidatorBenchmarkPolicy(report()), []);
});

test("rejects latency regressions and unreviewed benchmark shapes", () => {
  const violations = evaluateMlsValidatorBenchmarkPolicy(
    report({ benchmark: "other", samples: 10, concurrency: 2, latencyMs: { mean: 31, p95: 51 } })
  );
  assert.equal(violations.length, 5);
  assert.match(violations.join("\n"), /p95 latency 51ms exceeds 50ms/);
});

test("rejects missing or non-finite metrics", () => {
  assert.deepEqual(evaluateMlsValidatorBenchmarkPolicy(null), ["report must be an object"]);
  const violations = evaluateMlsValidatorBenchmarkPolicy(report({ latencyMs: { mean: Number.NaN } }));
  assert.match(violations.join("\n"), /latencyMs.mean/);
  assert.match(violations.join("\n"), /latencyMs.p95/);
});
