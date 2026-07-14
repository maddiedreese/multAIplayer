#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateNativeJourneyDurationPolicy, nativeJourneyDurationPolicy } from "./native-journey-metrics.mjs";

const reportPath = resolve(process.argv[2] ?? "reports/native-shell-e2e/duration.json");

try {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const violations = evaluateNativeJourneyDurationPolicy(report);
  if (violations.length > 0) {
    console.error(`[native-e2e] duration policy failed for ${reportPath}:`);
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log(
      `[native-e2e] duration policy passed: ${(report.totalDurationMs / 1_000).toFixed(1)}s total ` +
        `(hard ceiling ${(nativeJourneyDurationPolicy.totalMaxMs / 1_000).toFixed(0)}s)`
    );
  }
} catch (error) {
  console.error(`[native-e2e] could not evaluate duration report ${reportPath}: ${String(error)}`);
  process.exitCode = 1;
}
