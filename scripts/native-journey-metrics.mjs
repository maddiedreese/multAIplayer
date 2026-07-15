import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const formatSeconds = (durationMs) => `${(durationMs / 1_000).toFixed(1)} s`;

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
