import assert from "node:assert/strict";
import { test } from "node:test";

import { checkMutationPolicy } from "./check-mutation-policy.mjs";

const file = (path, mutationScore, survived = 0) => ({ path, counts: { mutationScore, survived } });
const mutant = (status, extra = {}) => ({
  id: "12",
  file: "src/encoding.ts",
  line: 24,
  column: 46,
  endLine: 24,
  endColumn: 56,
  mutator: "AssignmentOperator",
  replacement: "index -= 1",
  status,
  ...extra
});
const policy = {
  files: {
    "src/canonical.ts": { minimumScore: 90, maximumSurvived: 0 },
    "src/encoding.ts": { minimumScore: 85, maximumSurvived: 0 }
  },
  allowedTimeouts: [
    {
      file: "src/encoding.ts",
      line: 24,
      column: 46,
      endLine: 24,
      endColumn: 56,
      mutator: "AssignmentOperator",
      replacement: "index -= 1",
      rationale: "A loop-counter reversal is expected to run until the mutation timeout."
    }
  ]
};

test("accepts scores at their floors and a specifically explained timeout", () => {
  const failures = checkMutationPolicy(
    { files: [file("src/canonical.ts", 90), file("src/encoding.ts", 85)], mutants: [mutant("Timeout")] },
    policy
  );
  assert.deepEqual(failures, []);
});

test("reports every missing or regressed per-file score", () => {
  const failures = checkMutationPolicy({ files: [file("src/canonical.ts", 89.99, 1)], mutants: [] }, policy);
  assert.deepEqual(failures, [
    "src/canonical.ts: mutation score 89.99 is below 90.00",
    "src/canonical.ts: 1 survived mutants exceeds maximum 0",
    "src/encoding.ts: missing from mutation summary"
  ]);
});

test("rejects unexplained timeouts and bad execution or coverage outcomes", () => {
  const summary = {
    files: [file("src/canonical.ts", 100), file("src/encoding.ts", 100)],
    mutants: [
      mutant("Timeout", { replacement: "different" }),
      mutant("NoCoverage", { id: "13" }),
      mutant("RuntimeError", { id: "14" }),
      mutant("Pending", { id: "15" }),
      mutant("FutureStatus", { id: "16" })
    ]
  };
  const failures = checkMutationPolicy(summary, policy);
  assert.equal(failures.length, 5);
  assert.match(failures[0], /Timeout has no matching policy rationale/);
  assert.match(failures[1], /NoCoverage is not allowed/);
  assert.match(failures[4], /unknown status "FutureStatus"/);
});

test("rejects broad or unexplained ignores in governed files", () => {
  const summary = {
    files: [file("src/canonical.ts", 100), file("src/encoding.ts", 100)],
    mutants: [
      mutant("Ignored", { id: "17", file: "src/canonical.ts", statusReason: null }),
      mutant("Ignored", {
        id: "18",
        statusReason: 'Ignored because of excluded mutation "StringLiteral"'
      }),
      mutant("Ignored", {
        id: "19",
        statusReason: "Diagnostic error wording is not part of the API contract"
      })
    ]
  };
  const failures = checkMutationPolicy(summary, policy);
  assert.equal(failures.length, 2);
  assert.match(failures[0], /Ignored has no rationale/);
  assert.match(failures[1], /broad mutator exclusions/);
});

test("accepts type-checker detections but rejects unexplained compile errors", () => {
  const summary = {
    files: [file("src/canonical.ts", 100), file("src/encoding.ts", 100)],
    mutants: [
      mutant("CompileError", { id: "20", statusReason: "src/encoding.ts(1,1): error TS2355: missing return" }),
      mutant("CompileError", { id: "21", statusReason: "checker process exited" })
    ]
  };
  assert.deepEqual(checkMutationPolicy(summary, policy), [
    "src/encoding.ts:24:46 [21] CompileError has no TypeScript checker diagnostic"
  ]);
});

test("validates policy data instead of silently weakening the gate", () => {
  assert.throws(
    () => checkMutationPolicy({ files: [], mutants: [] }, { files: {}, allowedTimeouts: [{}] }),
    /non-empty file/
  );
  assert.throws(
    () =>
      checkMutationPolicy(
        { files: [], mutants: [] },
        { files: { "src/a.ts": { minimumScore: 101, maximumSurvived: 0 } }, allowedTimeouts: [] }
      ),
    /invalid minimumScore/
  );
  assert.throws(
    () =>
      checkMutationPolicy(
        { files: [], mutants: [] },
        { files: { "src/a.ts": { minimumScore: 90, maximumSurvived: -1 } }, allowedTimeouts: [] }
      ),
    /invalid maximumSurvived/
  );
});
