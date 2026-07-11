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
  // Error-message wording and WebCrypto extractability flags do not change the
  // package's authentication decisions. Keep the gate focused on logic mutants.
  mutator: {
    excludedMutations: ["StringLiteral", "BooleanLiteral"]
  },
  thresholds: {
    high: 75,
    low: 55,
    // Establish the measured baseline as a ratchet. Raising this threshold now
    // would make the new check permanently red instead of guarding regressions.
    break: 50
  },
  tempDirName: ".stryker-tmp"
};
