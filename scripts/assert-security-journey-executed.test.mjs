import assert from "node:assert/strict";
import test from "node:test";
import { assertSecurityJourneyExecuted, requiredSecurityJourneyTests } from "./assert-security-journey-executed.mjs";

function report(testCases) {
  return `<testsuite>${testCases.map((entry) => `<testcase name="${entry.name}">${entry.body ?? ""}</testcase>`).join("")}</testsuite>`;
}

test("accepts CI evidence containing both executed Rust-backed journeys", () => {
  assert.doesNotThrow(() =>
    assertSecurityJourneyExecuted(report(requiredSecurityJourneyTests.map((name) => ({ name }))))
  );
});

test("rejects skipped or missing Rust-backed journey evidence", () => {
  assert.throws(
    () =>
      assertSecurityJourneyExecuted(
        report(requiredSecurityJourneyTests.map((name, index) => ({ name, body: index === 0 ? "<skipped/>" : "" })))
      ),
    /contains a skipped test/
  );
  assert.throws(
    () => assertSecurityJourneyExecuted(report([{ name: requiredSecurityJourneyTests[0] }])),
    /missing required test/
  );
});
