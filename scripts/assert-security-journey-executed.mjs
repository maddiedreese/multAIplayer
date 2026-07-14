#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const requiredSecurityJourneyTests = Object.freeze([
  "native MLS, HPKE, Welcome, and exporter ciphertexts never persist relay plaintext",
  "two live native MLS clients exchange an application and handoff through a real relay"
]);

export function assertSecurityJourneyExecuted(report) {
  if (/<skipped(?:\s|\/|>)/u.test(report)) {
    throw new Error("security journey report contains a skipped test; CI must execute Rust-backed journeys");
  }
  for (const testName of requiredSecurityJourneyTests) {
    if (!report.includes(testName)) throw new Error(`security journey report is missing required test: ${testName}`);
  }
}

async function main() {
  const reportPath = resolve(process.argv[2] ?? "reports/security-journey/junit.xml");
  const report = await readFile(reportPath, "utf8");
  assertSecurityJourneyExecuted(report);
  console.log(`[security-journey] verified ${requiredSecurityJourneyTests.length} Rust-backed journeys executed`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
