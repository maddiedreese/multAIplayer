#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultSummaryPath = fileURLToPath(new URL("../apps/desktop/coverage/coverage-summary.json", import.meta.url));
const defaultBaselinePath = fileURLToPath(new URL("../apps/desktop/coverage-baseline.json", import.meta.url));
const metrics = ["lines", "functions", "branches", "statements"];

export function normalizeDesktopCoverage(summary) {
  const files = {};
  for (const [absolutePath, coverage] of Object.entries(summary)) {
    if (absolutePath === "total") continue;
    const marker = "/apps/desktop/src/";
    const markerIndex = absolutePath.replaceAll("\\", "/").lastIndexOf(marker);
    if (markerIndex === -1) throw new Error(`Desktop coverage contains an unexpected path: ${absolutePath}`);
    const path = `apps/desktop/src/${absolutePath.replaceAll("\\", "/").slice(markerIndex + marker.length)}`;
    files[path] = Object.fromEntries(
      metrics.map((metric) => [metric, [coverage[metric].covered, coverage[metric].total]])
    );
  }
  return {
    version: 1,
    files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)))
  };
}

export function compareDesktopCoverage(baseline, current) {
  if (baseline.version !== 1 || current.version !== 1) return ["Unsupported desktop coverage baseline version."];
  const failures = [];
  const paths = new Set([...Object.keys(baseline.files), ...Object.keys(current.files)]);
  for (const path of [...paths].sort()) {
    if (!baseline.files[path]) {
      failures.push(`${path} is not recorded in the desktop coverage baseline.`);
      continue;
    }
    if (!current.files[path]) {
      failures.push(`${path} is recorded in the baseline but missing from the coverage report.`);
      continue;
    }
    for (const metric of metrics) {
      const previous = baseline.files[path][metric];
      const next = current.files[path][metric];
      const comparison = compareFractions(next[0], next[1], previous[0], previous[1]);
      if (comparison < 0) {
        failures.push(`${path} ${metric} coverage regressed from ${format(previous)} to ${format(next)}.`);
      } else if (comparison > 0) {
        failures.push(
          `${path} ${metric} coverage improved from ${format(previous)} to ${format(next)}; review and update the baseline.`
        );
      }
    }
  }
  return failures;
}

function compareFractions(leftCovered, leftTotal, rightCovered, rightTotal) {
  if (leftTotal === 0 && rightTotal === 0) return 0;
  if (leftTotal === 0) return 1;
  if (rightTotal === 0) return -1;
  return Math.sign(leftCovered * rightTotal - rightCovered * leftTotal);
}

function format(value) {
  return `${value[0]}/${value[1]}`;
}

export function serializeDesktopCoverage(baseline) {
  const lines = Object.entries(baseline.files).map(
    ([path, coverage]) => `    ${JSON.stringify(path)}: ${JSON.stringify(coverage)}`
  );
  return `{\n  "version": 1,\n  "files": {\n${lines.join(",\n")}\n  }\n}\n`;
}

async function main() {
  const update = process.argv.includes("--update");
  const summary = normalizeDesktopCoverage(JSON.parse(await readFile(defaultSummaryPath, "utf8")));
  if (update) {
    await writeFile(defaultBaselinePath, serializeDesktopCoverage(summary));
    console.log(`Updated ${relative(workspaceRoot, defaultBaselinePath)}.`);
    return;
  }
  const baseline = JSON.parse(await readFile(defaultBaselinePath, "utf8"));
  const failures = compareDesktopCoverage(baseline, summary);
  if (failures.length > 0) throw new Error(`Desktop coverage ratchet failed:\n- ${failures.join("\n- ")}`);
  console.log(`Desktop coverage matches the reviewed ${Object.keys(baseline.files).length}-file baseline.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  await main();
}
