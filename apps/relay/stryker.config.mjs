/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ["src/authz.ts"],
  testRunner: "command",
  commandRunner: { command: "tsx --test test/security-units.test.ts" },
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  coverageAnalysis: "off",
  timeoutMS: 15000,
  thresholds: { high: 100, low: 100, break: 50 },
  tempDirName: ".stryker-tmp"
};
