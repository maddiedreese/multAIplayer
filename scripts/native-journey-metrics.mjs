import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const formatSeconds = (durationMs) => `${(durationMs / 1_000).toFixed(1)} s`;

export const nativeJourneyDurationPolicy = Object.freeze({
  formatVersion: 1,
  totalMaxMs: 8 * 60_000,
  stages: Object.freeze([
    ["initializing native journey", 60_000],
    ["starting desktop frontend", 60_000],
    ["building native desktop shell", 6 * 60_000],
    ["native desktop shell build completed", 30_000],
    ["starting native WebDriver bridges", 60_000],
    ["creating isolated native WebDriver sessions", 60_000],
    ["native WebDriver sessions ready", 60_000],
    ["authenticating both native clients", 60_000],
    ["creating and bootstrapping MLS room", 120_000],
    ["proving the real validator rejects a tampered native KeyPackage", 120_000],
    ["denying admission and proving the guest native MLS group stays locked", 150_000],
    ["rejecting an expired invite capability before KeyPackage publication", 150_000],
    ["crashing the guest and restarting the relay after Commit before Welcome delivery", 180_000],
    ["sending pre-handoff encrypted message", 90_000],
    ["transferring MLS host authority", 120_000],
    ["verifying relay host authority", 30_000],
    ["sending post-handoff encrypted message", 90_000],
    ["cleaning up native journey resources", 60_000],
    ["native journey cleanup completed", 10_000]
  ])
});

function validDuration(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function evaluateNativeJourneyDurationPolicy(report, policy = nativeJourneyDurationPolicy) {
  const violations = [];
  if (!report || typeof report !== "object") return ["duration report must be an object"];
  if (report.formatVersion !== policy.formatVersion) {
    violations.push(`formatVersion must be ${policy.formatVersion}, received ${String(report.formatVersion)}`);
  }
  if (report.outcome !== "passed") {
    violations.push(`duration policy requires a passed journey, received ${String(report.outcome)}`);
  }
  if (!validDuration(report.totalDurationMs)) {
    violations.push("totalDurationMs must be a finite non-negative number");
  } else if (report.totalDurationMs > policy.totalMaxMs) {
    violations.push(
      `total journey duration ${formatSeconds(report.totalDurationMs)} exceeded ${formatSeconds(policy.totalMaxMs)}`
    );
  }

  if (!Array.isArray(report.stages)) {
    violations.push("stages must be an array");
    return violations;
  }

  if (report.stages.length !== policy.stages.length) {
    violations.push(`expected ${policy.stages.length} duration stages, received ${report.stages.length}`);
  }
  const stageCount = Math.max(report.stages.length, policy.stages.length);
  for (let index = 0; index < stageCount; index += 1) {
    const actual = report.stages[index];
    const expected = policy.stages[index];
    if (!expected) {
      violations.push(`unexpected duration stage at position ${index + 1}: ${String(actual?.name)}`);
      continue;
    }
    if (!actual) {
      violations.push(`missing duration stage at position ${index + 1}: ${expected[0]}`);
      continue;
    }
    if (actual.name !== expected[0]) {
      violations.push(
        `duration stage ${index + 1} must be ${JSON.stringify(expected[0])}, received ${JSON.stringify(actual.name)}`
      );
    }
    if (!validDuration(actual.durationMs)) {
      violations.push(`duration for stage ${JSON.stringify(actual.name)} must be a finite non-negative number`);
    } else if (actual.durationMs > expected[1]) {
      violations.push(
        `stage ${JSON.stringify(expected[0])} took ${formatSeconds(actual.durationMs)}, exceeding ${formatSeconds(expected[1])}`
      );
    }
  }
  return violations;
}

export class NativeJourneyTimer {
  #activeStage;
  #clock;
  #finished = false;
  #stages = [];
  #startedAtDurationMs;
  #startedAtWallMs;
  #wallClock;

  constructor(clock = () => performance.now(), wallClock = Date.now) {
    this.#clock = clock;
    this.#wallClock = wallClock;
    this.#startedAtDurationMs = clock();
    this.#startedAtWallMs = wallClock();
  }

  markStage(name) {
    if (this.#finished) throw new Error("cannot add a stage to finished native journey metrics");
    const now = this.#clock();
    if (this.#activeStage) {
      this.#stages.push({
        name: this.#activeStage.name,
        durationMs: now - this.#activeStage.startedAtMs
      });
    }
    this.#activeStage = { name, startedAtMs: now };
  }

  finish(outcome, metadata = {}) {
    if (this.#finished) throw new Error("native journey metrics were already finished");
    if (outcome !== "passed" && outcome !== "failed") throw new Error(`invalid native journey outcome: ${outcome}`);
    const endedAtDurationMs = this.#clock();
    const endedAtWallMs = this.#wallClock();
    if (this.#activeStage) {
      this.#stages.push({
        name: this.#activeStage.name,
        durationMs: endedAtDurationMs - this.#activeStage.startedAtMs
      });
    }
    this.#finished = true;
    return {
      formatVersion: 1,
      outcome,
      startedAt: new Date(this.#startedAtWallMs).toISOString(),
      endedAt: new Date(endedAtWallMs).toISOString(),
      totalDurationMs: endedAtDurationMs - this.#startedAtDurationMs,
      stages: this.#stages,
      metadata
    };
  }
}

export function renderNativeJourneySummary(report) {
  const warningBudget = report.metadata.warningBudgetMs;
  const budgetLine =
    typeof warningBudget === "number"
      ? ` Warning budget: ${formatSeconds(warningBudget)} (${report.totalDurationMs > warningBudget ? "exceeded" : "within budget"}).`
      : "";
  const stageRows = report.stages
    .map((stage) => `| ${stage.name.replaceAll("|", "\\|")} | ${formatSeconds(stage.durationMs)} |`)
    .join("\n");
  return [
    "## Real native MLS journey duration",
    "",
    `**${report.outcome.toUpperCase()}** in ${formatSeconds(report.totalDurationMs)} on ${report.metadata.platform ?? "unknown"}.${budgetLine}`,
    "",
    "| Stage | Duration |",
    "| --- | ---: |",
    stageRows || "| No stage recorded | 0.0 s |",
    ""
  ].join("\n");
}

export async function writeNativeJourneyMetrics(report, reportDirectory, githubStepSummary) {
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = join(reportDirectory, "duration.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (githubStepSummary) await appendFile(githubStepSummary, renderNativeJourneySummary(report), "utf8");
  return reportPath;
}
