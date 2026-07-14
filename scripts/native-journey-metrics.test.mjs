import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  NativeJourneyTimer,
  evaluateNativeJourneyDurationPolicy,
  nativeJourneyDurationPolicy,
  renderNativeJourneySummary,
  writeNativeJourneyMetrics
} from "./native-journey-metrics.mjs";

const execFileAsync = promisify(execFile);

function passingPolicyReport(overrides = {}) {
  return {
    formatVersion: nativeJourneyDurationPolicy.formatVersion,
    outcome: "passed",
    totalDurationMs: 300_000,
    stages: nativeJourneyDurationPolicy.stages.map(([name, maxMs]) => ({
      name,
      durationMs: Math.min(maxMs, 10_000)
    })),
    metadata: {},
    ...overrides
  };
}

test("records total and per-stage native journey durations", () => {
  const times = [1_000, 1_100, 1_350, 1_900];
  const wallTimes = [10_000, 10_900];
  const timer = new NativeJourneyTimer(
    () => times.shift(),
    () => wallTimes.shift()
  );
  timer.markStage("build");
  timer.markStage("invite | approval");
  const report = timer.finish("passed", { platform: "linux-x64", warningBudgetMs: 1_000 });

  assert.equal(report.totalDurationMs, 900);
  assert.equal(report.startedAt, "1970-01-01T00:00:10.000Z");
  assert.equal(report.endedAt, "1970-01-01T00:00:10.900Z");
  assert.deepEqual(report.stages, [
    { name: "build", durationMs: 250 },
    { name: "invite | approval", durationMs: 550 }
  ]);
  assert.match(renderNativeJourneySummary(report), /PASSED.*0\.9 s on linux-x64/);
  assert.match(renderNativeJourneySummary(report), /1\.0 s \(within budget\)/);
  assert.match(renderNativeJourneySummary(report), /invite \\\| approval/);
});

test("writes a JSON artifact and appends the GitHub step summary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-journey-metrics-"));
  const summaryPath = join(directory, "summary.md");
  const report = {
    formatVersion: 1,
    outcome: "failed",
    startedAt: "2026-07-13T00:00:00.000Z",
    endedAt: "2026-07-13T00:00:02.000Z",
    totalDurationMs: 2_000,
    stages: [{ name: "validator rejection", durationMs: 2_000 }],
    metadata: { platform: "linux-x64" }
  };

  const reportPath = await writeNativeJourneyMetrics(report, directory, summaryPath);
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  assert.match(await readFile(summaryPath, "utf8"), /FAILED.*2\.0 s/);
});

test("rejects duplicate completion and stages after completion", () => {
  const timer = new NativeJourneyTimer(() => 1_000);
  timer.finish("failed");
  assert.throws(() => timer.finish("passed"), /already finished/);
  assert.throws(() => timer.markStage("late"), /finished/);
});

test("surfaces a duration warning-budget regression in the summary", () => {
  const times = [0, 2_000];
  const report = new NativeJourneyTimer(() => times.shift()).finish("passed", {
    platform: "linux-x64",
    warningBudgetMs: 1_000
  });
  assert.match(renderNativeJourneySummary(report), /1\.0 s \(exceeded\)/);
});

test("accepts a complete native journey within every hard duration ceiling", () => {
  assert.deepEqual(evaluateNativeJourneyDurationPolicy(passingPolicyReport()), []);
});

test("checked-in policy covers the successful native journey stage sequence", async () => {
  const source = await readFile("e2e/native-shell/journey.ts", "utf8");
  const successfulStages = [...source.matchAll(/stage\("([^"]+)"\)/g)]
    .map((match) => match[1])
    .filter((name) => name !== "capturing bounded failure diagnostics");
  assert.deepEqual(
    nativeJourneyDurationPolicy.stages.map(([name]) => name),
    successfulStages
  );
});

test("rejects total and stage duration regressions with actionable diagnostics", () => {
  const report = passingPolicyReport({ totalDurationMs: nativeJourneyDurationPolicy.totalMaxMs + 1 });
  const build = report.stages.find((stage) => stage.name === "building native desktop shell");
  build.durationMs = nativeJourneyDurationPolicy.stages.find(([name]) => name === build.name)[1] + 1;

  const violations = evaluateNativeJourneyDurationPolicy(report);
  assert.ok(violations.some((violation) => /total journey duration.*exceeded/.test(violation)));
  assert.ok(violations.some((violation) => /building native desktop shell.*exceeding/.test(violation)));
});

test("rejects missing, reordered, unexpected, and malformed duration stages", () => {
  const report = passingPolicyReport();
  report.stages[0] = { name: report.stages[1].name, durationMs: -1 };
  report.stages.push({ name: "unreviewed future stage", durationMs: 1 });

  const violations = evaluateNativeJourneyDurationPolicy(report);
  assert.ok(
    violations.some((violation) =>
      new RegExp(
        `expected ${nativeJourneyDurationPolicy.stages.length} duration stages, received ${nativeJourneyDurationPolicy.stages.length + 1}`
      ).test(violation)
    )
  );
  assert.ok(violations.some((violation) => /duration stage 1 must be/.test(violation)));
  assert.ok(violations.some((violation) => /finite non-negative/.test(violation)));
  assert.ok(violations.some((violation) => /unexpected duration stage/.test(violation)));
});

test("rejects failed and incompatible duration reports", () => {
  const violations = evaluateNativeJourneyDurationPolicy(
    passingPolicyReport({ formatVersion: 2, outcome: "failed", totalDurationMs: Number.NaN })
  );
  assert.ok(violations.some((violation) => /formatVersion must be 1/.test(violation)));
  assert.ok(violations.some((violation) => /requires a passed journey/.test(violation)));
  assert.ok(violations.some((violation) => /totalDurationMs must be/.test(violation)));
});

test("duration policy CLI exits successfully only for a compliant report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-journey-policy-"));
  const reportPath = join(directory, "duration.json");
  await writeFile(reportPath, JSON.stringify(passingPolicyReport()), "utf8");
  const accepted = await execFileAsync(process.execPath, ["scripts/check-native-journey-duration.mjs", reportPath]);
  assert.match(accepted.stdout, /duration policy passed/);

  await writeFile(
    reportPath,
    JSON.stringify(passingPolicyReport({ totalDurationMs: nativeJourneyDurationPolicy.totalMaxMs + 1 })),
    "utf8"
  );
  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/check-native-journey-duration.mjs", reportPath]),
    (error) => error.code === 1 && /total journey duration.*exceeded/.test(error.stderr)
  );
});
