import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runCli, summarizeMutationReport } from "./summarize-mutation-report.mjs";

const point = (line, column) => ({ line, column });
const mutant = (id, status, line, extra = {}) => ({
  id,
  status,
  mutatorName: "ConditionalExpression",
  replacement: "true",
  location: { start: point(line, 2), end: point(line, 8) },
  ...extra
});

test("summarizes statuses and computes the Stryker mutation score", () => {
  const summary = summarizeMutationReport({
    schemaVersion: "2",
    files: {
      "src/b.ts": { mutants: [mutant("b-2", "CompileError", 4), mutant("b-1", "NoCoverage", 3)] },
      "src/a.ts": {
        mutants: [
          mutant("a-3", "Survived", 9),
          mutant("a-2", "Timeout", 5),
          mutant("a-1", "Killed", 5, { killedBy: ["test-z", "test-a"], coveredBy: ["test-z"] })
        ]
      }
    }
  });

  assert.equal(summary.formatVersion, 1);
  assert.equal(summary.schemaVersion, "2");
  assert.deepEqual(
    summary.files.map((file) => file.path),
    ["src/a.ts", "src/b.ts"]
  );
  assert.deepEqual(
    summary.mutants.map((item) => item.id),
    ["a-1", "a-2", "a-3", "b-1", "b-2"]
  );
  assert.equal(summary.totals.detected, 2);
  assert.equal(summary.totals.undetected, 2);
  assert.equal(summary.totals.invalid, 1);
  assert.equal(summary.totals.scored, 4);
  assert.equal(summary.totals.mutationScore, 50);
  assert.deepEqual(summary.mutants[0].killedBy, ["test-a", "test-z"]);
  assert.equal(summary.mutants[0].classification, null);
  assert.equal(summary.mutants[0].rationale, null);
});

test("sorts mutants by source position and then id for deterministic output", () => {
  const report = {
    files: {
      "src/a.ts": {
        mutants: [mutant("z", "Ignored", 8), mutant("b", "RuntimeError", 2), mutant("a", "Pending", 2)]
      }
    }
  };

  const first = summarizeMutationReport(report);
  const second = summarizeMutationReport(structuredClone(report));
  assert.deepEqual(
    first.mutants.map((item) => item.id),
    ["a", "b", "z"]
  );
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.totals.mutationScore, null);
});

test("writes a stable JSON artifact through the CLI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mutation-summary-"));
  const input = join(directory, "mutation.json");
  const output = join(directory, "summary.json");
  await writeFile(input, JSON.stringify({ files: { "src/a.ts": { mutants: [mutant("1", "Killed", 1)] } } }));

  await runCli([input, "--output", output]);

  const parsed = JSON.parse(await readFile(output, "utf8"));
  assert.equal(parsed.totals.mutationScore, 100);
  assert.equal(parsed.mutants[0].file, "src/a.ts");
});

test("rejects malformed reports instead of silently producing misleading totals", () => {
  assert.throws(() => summarizeMutationReport({}), /files object/);
  assert.throws(
    () => summarizeMutationReport({ files: { "src/a.ts": { mutants: [{ id: "1", status: "Killed" }] } } }),
    /invalid start location/
  );
});
