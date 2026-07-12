/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ["src/**/*.ts"],
  testRunner: "command",
  commandRunner: {
    command: "npm test"
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
