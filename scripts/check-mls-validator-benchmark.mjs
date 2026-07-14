#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateMlsValidatorBenchmarkPolicy, mlsValidatorBenchmarkPolicy } from "./mls-validator-benchmark-policy.mjs";

const reportPath = resolve(process.argv[2] ?? "reports/mls-validator-benchmark.json");

try {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const violations = evaluateMlsValidatorBenchmarkPolicy(report);
  if (violations.length > 0) {
    console.error(`[mls-validator] benchmark policy failed for ${reportPath}:`);
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log(
      `[mls-validator] benchmark policy passed: ${report.latencyMs.mean}ms mean, ` +
        `${report.latencyMs.p95}ms p95 (budgets ${mlsValidatorBenchmarkPolicy.meanMaxMs}ms / ` +
        `${mlsValidatorBenchmarkPolicy.p95MaxMs}ms)`
    );
  }
} catch (error) {
  console.error(`[mls-validator] could not evaluate benchmark report ${reportPath}: ${String(error)}`);
  process.exitCode = 1;
}
