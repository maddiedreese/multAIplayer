import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { checkMutationPolicy } from "./check-mutation-policy.mjs";
import strykerConfig from "../packages/crypto/stryker.config.mjs";

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
  ],
  allowedIgnored: [],
  regions: []
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

test("rejects source files that are not covered by a whole-file rule", () => {
  const failures = checkMutationPolicy(
    {
      files: [file("src/canonical.ts", 100), file("src/encoding.ts", 100), file("src/new-crypto-boundary.ts", 100)],
      mutants: []
    },
    policy
  );
  assert.deepEqual(failures, ["src/new-crypto-boundary.ts: missing a whole-file mutation policy rule"]);
});

test("supports a zero-survivor whole-file gate before a measured score floor is recorded", () => {
  const configured = {
    ...policy,
    files: { ...policy.files, "src/index.ts": { maximumSurvived: 0 } }
  };
  const failures = checkMutationPolicy(
    {
      files: [...Object.keys(policy.files).map((path) => file(path, 100)), file("src/index.ts", 75, 1)],
      mutants: []
    },
    configured
  );
  assert.deepEqual(failures, ["src/index.ts: 1 survived mutants exceeds maximum 0"]);
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
  assert.equal(failures.length, 3);
  assert.match(failures[0], /Ignored has no rationale/);
  assert.match(failures[1], /broad mutator exclusions/);
  assert.match(failures[2], /no exact policy ledger entry/);
});

test("requires every ignored mutant to match one exact, current ledger entry", () => {
  const ignored = mutant("Ignored", {
    id: "19",
    file: "src/canonical.ts",
    mutator: "StringLiteral",
    replacement: '"Stryker was here!"',
    statusReason: "equivalent replacement"
  });
  const ledger = {
    file: ignored.file,
    line: ignored.line,
    column: ignored.column,
    endLine: ignored.endLine,
    endColumn: ignored.endColumn,
    mutator: ignored.mutator,
    replacement: ignored.replacement,
    rationale: ignored.statusReason
  };
  const summary = { files: [file("src/canonical.ts", 100), file("src/encoding.ts", 100)], mutants: [ignored] };
  assert.deepEqual(checkMutationPolicy(summary, { ...policy, allowedIgnored: [ledger] }), []);
  assert.deepEqual(checkMutationPolicy(summary, { ...policy, allowedIgnored: [{ ...ledger, line: 25 }] }), [
    "src/canonical.ts:24:46 [19] Ignored has no exact policy ledger entry",
    "src/canonical.ts:25:46: stale allowedIgnored policy entry"
  ]);
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
    () =>
      checkMutationPolicy(
        { files: [], mutants: [] },
        { files: {}, allowedTimeouts: [{}], allowedIgnored: [], regions: [] }
      ),
    /non-empty file/
  );
  assert.throws(
    () =>
      checkMutationPolicy(
        { files: [], mutants: [] },
        {
          files: { "src/a.ts": { minimumScore: 101, maximumSurvived: 0 } },
          allowedTimeouts: [],
          allowedIgnored: [],
          regions: []
        }
      ),
    /invalid minimumScore/
  );
  assert.throws(
    () =>
      checkMutationPolicy(
        { files: [], mutants: [] },
        {
          files: { "src/a.ts": { minimumScore: 90, maximumSurvived: -1 } },
          allowedTimeouts: [],
          allowedIgnored: [],
          regions: []
        }
      ),
    /invalid maximumSurvived/
  );
});

const regionRule = {
  file: "src/index.ts",
  marker: "payload-core",
  maximumSurvived: 0,
  maximumNoCoverage: 0,
  maximumRuntimeError: 0,
  maximumPending: 0,
  maximumTimeout: 0
};

test("enforces status limits only inside a marker-governed region", () => {
  const summary = {
    files: [file("src/canonical.ts", 100), file("src/encoding.ts", 100)],
    mutants: [
      mutant("Survived", { id: "inside", file: "src/index.ts", line: 2, endLine: 2 }),
      mutant("Survived", { id: "outside", file: "src/index.ts", line: 5, endLine: 5 })
    ]
  };
  const configured = { ...policy, regions: [regionRule] };
  const failures = checkMutationPolicy(summary, configured, {
    "src/index.ts":
      "// mutation-policy:start payload-core\nfunction core() {}\n// mutation-policy:end payload-core\n\nfunction debt() {}"
  });
  assert.deepEqual(failures, ["src/index.ts [payload-core]: 1 Survived mutants exceeds maximum 0"]);
});

test("fails closed for mutants crossing a region boundary", () => {
  const summary = {
    files: [file("src/canonical.ts", 100), file("src/encoding.ts", 100)],
    mutants: [mutant("Killed", { id: "crossing", file: "src/index.ts", line: 1, endLine: 2 })]
  };
  const configured = { ...policy, regions: [regionRule] };
  const failures = checkMutationPolicy(summary, configured, {
    "src/index.ts": "// mutation-policy:start payload-core\nfunction core() {}\n// mutation-policy:end payload-core"
  });
  assert.match(failures[0], /crosses mutation-policy region/);
});

test("rejects missing, duplicate, nested, reversed, and unclosed markers", () => {
  const summary = { files: [file("src/canonical.ts", 100), file("src/encoding.ts", 100)], mutants: [] };
  const configured = { ...policy, regions: [regionRule] };
  const check = (source) => checkMutationPolicy(summary, configured, { "src/index.ts": source });
  assert.throws(() => check("function core() {}"), /exactly one start and end/);
  assert.throws(
    () =>
      check(
        "// mutation-policy:start payload-core\n// mutation-policy:end payload-core\n// mutation-policy:start payload-core\n// mutation-policy:end payload-core"
      ),
    /exactly one start and end/
  );
  assert.throws(
    () =>
      check(
        "// mutation-policy:start payload-core\n// mutation-policy:start nested\n// mutation-policy:end nested\n// mutation-policy:end payload-core"
      ),
    /may not be nested/
  );
  assert.throws(() => check("// mutation-policy:end payload-core"), /unmatched mutation-policy end/);
  assert.throws(() => check("// mutation-policy:start payload-core"), /unclosed mutation-policy region/);
});

test("keeps repository mutation ratchets at 100 percent while allowing policy reporting", async () => {
  const configured = JSON.parse(
    await readFile(new URL("../packages/crypto/mutation-policy.json", import.meta.url), "utf8")
  );
  assert.deepEqual(strykerConfig.thresholds, { high: 100, low: 100, break: 50 });
  assert.deepEqual(
    Object.fromEntries(Object.entries(configured.files).map(([path, rule]) => [path, rule.minimumScore])),
    {
      "src/additional-data.ts": 100,
      "src/canonical.ts": 100,
      "src/device-wrapping.ts": 100,
      "src/encoding.ts": 100,
      "src/inviteCapability.ts": 100,
      "src/key-material.ts": 100,
      "src/payload.ts": 100
    }
  );
  assert.ok(Object.values(configured.files).every((rule) => rule.maximumSurvived === 0));
  assert.ok(
    configured.regions.every(
      (region) =>
        region.maximumSurvived === 0 &&
        region.maximumNoCoverage === 0 &&
        region.maximumRuntimeError === 0 &&
        region.maximumPending === 0 &&
        region.maximumTimeout === 0
    )
  );
});
