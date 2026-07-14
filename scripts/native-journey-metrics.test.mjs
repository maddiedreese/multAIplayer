import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NativeJourneyTimer,
  renderNativeJourneySummary,
  writeNativeJourneyMetrics
} from "./native-journey-metrics.mjs";

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
