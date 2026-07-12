import { readdirSync } from "node:fs";

const mutationTestFiles = readdirSync(new URL("./test", import.meta.url))
  .filter((name) => name.endsWith(".test.ts") && name !== "properties.test.ts")
  .sort()
  .map((name) => `test/${name}`)
  .join(" ");

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ["src/**/*.ts"],
  testRunner: "command",
  commandRunner: {
    // Property tests remain mandatory in ordinary/full CI. The deterministic
    // focused suite independently kills the complete mutation baseline and
    // avoids replaying thousands of generated cases in every mutant sandbox.
    command: `tsx --test ${mutationTestFiles}`
  },
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation/mutation.html"
  },
  jsonReporter: {
    fileName: "reports/mutation/mutation.json"
  },
  coverageAnalysis: "off",
  // WebCrypto-heavy mutation cases can exceed Stryker's default budget on CI.
  // Timeouts still fail repository policy; this only prevents false detections.
  timeoutMS: 15000,
  thresholds: {
    high: 100,
    low: 100,
    // Keep the engine threshold below the repository ratchet so JSON summary
    // generation and the stricter per-file/ignore-ledger policy always run.
    break: 50
  },
  tempDirName: ".stryker-tmp"
};
