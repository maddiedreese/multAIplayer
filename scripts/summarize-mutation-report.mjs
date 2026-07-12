#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const detectedStatuses = new Set(["Killed", "Timeout"]);
const undetectedStatuses = new Set(["Survived", "NoCoverage"]);
const invalidStatuses = new Set(["CompileError", "RuntimeError"]);

/**
 * Convert a mutation-testing-elements JSON report into a stable, reviewable
 * ledger. Volatile run metadata is intentionally omitted so identical mutant
 * results produce identical output.
 */
export function summarizeMutationReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new TypeError("mutation report must be a JSON object");
  }
  if (!report.files || typeof report.files !== "object" || Array.isArray(report.files)) {
    throw new TypeError("mutation report must contain a files object");
  }

  const files = Object.entries(report.files)
    .map(([fileName, file]) => summarizeFile(fileName, file))
    .sort((left, right) => compareStrings(left.path, right.path));
  const totals = sumCounts(files.map((file) => file.counts));

  return {
    formatVersion: 1,
    schemaVersion: typeof report.schemaVersion === "string" ? report.schemaVersion : null,
    totals: withScore(totals),
    files,
    mutants: files.flatMap((file) => file.mutants)
  };
}

function summarizeFile(fileName, file) {
  if (!file || typeof file !== "object" || !Array.isArray(file.mutants)) {
    throw new TypeError(`mutation report file ${JSON.stringify(fileName)} must contain a mutants array`);
  }

  const mutants = file.mutants.map((mutant) => summarizeMutant(fileName, mutant)).sort(compareMutants);
  return {
    path: fileName,
    counts: withScore(countStatuses(mutants)),
    mutants
  };
}

function summarizeMutant(fileName, mutant) {
  if (!mutant || typeof mutant !== "object") {
    throw new TypeError(`mutation report file ${JSON.stringify(fileName)} contains a non-object mutant`);
  }
  if (typeof mutant.id !== "string" || mutant.id.length === 0) {
    throw new TypeError(`mutation report file ${JSON.stringify(fileName)} contains a mutant without an id`);
  }
  if (typeof mutant.status !== "string" || mutant.status.length === 0) {
    throw new TypeError(`mutation report mutant ${JSON.stringify(mutant.id)} is missing its status`);
  }

  const location = normalizeLocation(mutant.id, mutant.location);
  return {
    id: mutant.id,
    file: fileName,
    line: location.start.line,
    column: location.start.column,
    endLine: location.end.line,
    endColumn: location.end.column,
    mutator: typeof mutant.mutatorName === "string" ? mutant.mutatorName : "Unknown",
    replacement: typeof mutant.replacement === "string" ? mutant.replacement : null,
    status: mutant.status,
    // Killed reasons contain the command runner's full test output, including
    // sandbox paths and timings. The status and killedBy ids preserve the useful
    // result; policy-relevant diagnostics and ignore rationales remain intact.
    statusReason: mutant.status !== "Killed" && typeof mutant.statusReason === "string" ? mutant.statusReason : null,
    killedBy: sortedStrings(mutant.killedBy),
    coveredBy: sortedStrings(mutant.coveredBy),
    // These fields intentionally start empty. The generated artifact can be
    // enriched privately without making judgment calls in this mechanical tool.
    classification: null,
    rationale: null
  };
}

function normalizeLocation(id, location) {
  const start = location?.start;
  const end = location?.end;
  for (const [label, point] of [
    ["start", start],
    ["end", end]
  ]) {
    if (!point || !Number.isInteger(point.line) || !Number.isInteger(point.column)) {
      throw new TypeError(`mutation report mutant ${JSON.stringify(id)} has an invalid ${label} location`);
    }
  }
  return { start, end };
}

function sortedStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").sort(compareStrings);
}

function compareMutants(left, right) {
  return left.line - right.line || left.column - right.column || compareStrings(left.id, right.id);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function emptyCounts() {
  return {
    killed: 0,
    timedOut: 0,
    survived: 0,
    noCoverage: 0,
    compileError: 0,
    runtimeError: 0,
    ignored: 0,
    pending: 0,
    other: 0,
    total: 0
  };
}

function countStatuses(mutants) {
  const counts = emptyCounts();
  for (const mutant of mutants) {
    const key = statusCountKey(mutant.status);
    counts[key] += 1;
    counts.total += 1;
  }
  return counts;
}

function statusCountKey(status) {
  return (
    {
      Killed: "killed",
      Timeout: "timedOut",
      Survived: "survived",
      NoCoverage: "noCoverage",
      CompileError: "compileError",
      RuntimeError: "runtimeError",
      Ignored: "ignored",
      Pending: "pending"
    }[status] ?? "other"
  );
}

function sumCounts(countsList) {
  const total = emptyCounts();
  for (const counts of countsList) {
    for (const key of Object.keys(total)) total[key] += counts[key];
  }
  return total;
}

function withScore(counts) {
  const detected = [...detectedStatuses].reduce((sum, status) => sum + counts[statusCountKey(status)], 0);
  const undetected = [...undetectedStatuses].reduce((sum, status) => sum + counts[statusCountKey(status)], 0);
  const invalid = [...invalidStatuses].reduce((sum, status) => sum + counts[statusCountKey(status)], 0);
  const scored = detected + undetected;
  return {
    ...counts,
    detected,
    undetected,
    invalid,
    scored,
    behavioralMutants: counts.total - counts.compileError,
    compilerRejectedMutants: counts.compileError,
    mutationScore: scored === 0 ? null : Number(((detected / scored) * 100).toFixed(2))
  };
}

export async function runCli(args) {
  const { input, output } = parseArguments(args);
  const report = JSON.parse(await readFile(input, "utf8"));
  const summary = `${JSON.stringify(summarizeMutationReport(report), null, 2)}\n`;
  if (output) {
    await writeFile(output, summary, "utf8");
    return;
  }
  process.stdout.write(summary);
}

function parseArguments(args) {
  let input;
  let output;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output") {
      output = args[index + 1];
      if (!output) throw new Error("--output requires a path");
      index += 1;
    } else if (!input) {
      input = argument;
    } else {
      throw new Error(`unexpected argument: ${argument}`);
    }
  }
  if (!input)
    throw new Error(
      "usage: node scripts/summarize-mutation-report.mjs <mutation-report.json> [--output <summary.json>]"
    );
  return { input, output };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
