export const mlsValidatorBenchmarkPolicy = Object.freeze({
  benchmark: "mls-keypackage-validator-child-process",
  concurrency: 1,
  minimumSamples: 50,
  meanMaxMs: 30,
  p95MaxMs: 50
});

export function evaluateMlsValidatorBenchmarkPolicy(report) {
  const violations = [];
  if (!report || typeof report !== "object") return ["report must be an object"];
  if (report.benchmark !== mlsValidatorBenchmarkPolicy.benchmark) {
    violations.push(`benchmark must be ${mlsValidatorBenchmarkPolicy.benchmark}`);
  }
  if (!Number.isSafeInteger(report.samples) || report.samples < mlsValidatorBenchmarkPolicy.minimumSamples) {
    violations.push(`samples must be at least ${mlsValidatorBenchmarkPolicy.minimumSamples}`);
  }
  if (report.concurrency !== mlsValidatorBenchmarkPolicy.concurrency) {
    violations.push(`concurrency must be ${mlsValidatorBenchmarkPolicy.concurrency}`);
  }
  const mean = report.latencyMs?.mean;
  const p95 = report.latencyMs?.p95;
  if (!Number.isFinite(mean) || mean < 0) violations.push("latencyMs.mean must be a non-negative number");
  else if (mean > mlsValidatorBenchmarkPolicy.meanMaxMs) {
    violations.push(`mean latency ${mean}ms exceeds ${mlsValidatorBenchmarkPolicy.meanMaxMs}ms`);
  }
  if (!Number.isFinite(p95) || p95 < 0) violations.push("latencyMs.p95 must be a non-negative number");
  else if (p95 > mlsValidatorBenchmarkPolicy.p95MaxMs) {
    violations.push(`p95 latency ${p95}ms exceeds ${mlsValidatorBenchmarkPolicy.p95MaxMs}ms`);
  }
  return violations;
}
