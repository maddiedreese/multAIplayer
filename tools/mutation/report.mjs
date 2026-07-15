#!/usr/bin/env node

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const detectedStatuses = new Set(["Killed", "Timeout"]);
const undetectedStatuses = new Set(["Survived", "NoCoverage"]);
const invalidStatuses = new Set(["CompileError", "RuntimeError"]);

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

function summarizeMutant(fileName, mutant) {
  if (!mutant || typeof mutant !== "object" || typeof mutant.id !== "string" || !mutant.id) {
    throw new TypeError(`mutation report file ${JSON.stringify(fileName)} contains an invalid mutant`);
  }
  if (typeof mutant.status !== "string" || !mutant.status) {
    throw new TypeError(`mutation report mutant ${JSON.stringify(mutant.id)} is missing its status`);
  }
  const start = mutant.location?.start;
  const end = mutant.location?.end;
  if (
    !start ||
    !end ||
    !Number.isInteger(start.line) ||
    !Number.isInteger(start.column) ||
    !Number.isInteger(end.line) ||
    !Number.isInteger(end.column)
  ) {
    throw new TypeError(`mutation report mutant ${JSON.stringify(mutant.id)} has an invalid location`);
  }
  return {
    id: mutant.id,
    file: fileName,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    mutator: typeof mutant.mutatorName === "string" ? mutant.mutatorName : "Unknown",
    replacement: typeof mutant.replacement === "string" ? mutant.replacement : null,
    status: mutant.status,
    statusReason: mutant.status !== "Killed" && typeof mutant.statusReason === "string" ? mutant.statusReason : null,
    killedBy: stringList(mutant.killedBy),
    coveredBy: stringList(mutant.coveredBy),
    classification: null,
    rationale: null
  };
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").sort() : [];
}

function summarizeFile(path, file) {
  if (!file || typeof file !== "object" || !Array.isArray(file.mutants)) {
    throw new TypeError(`mutation report file ${JSON.stringify(path)} must contain a mutants array`);
  }
  const mutants = file.mutants
    .map((mutant) => summarizeMutant(path, mutant))
    .sort((left, right) => left.line - right.line || left.column - right.column || left.id.localeCompare(right.id));
  const counts = emptyCounts();
  for (const mutant of mutants) {
    counts[statusCountKey(mutant.status)] += 1;
    counts.total += 1;
  }
  return { path, counts: withScore(counts), mutants };
}

export function summarizeMutationReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report) || !report.files) {
    throw new TypeError("mutation report must contain a files object");
  }
  const files = Object.entries(report.files)
    .map(([path, file]) => summarizeFile(path, file))
    .sort((left, right) => left.path.localeCompare(right.path));
  const totals = emptyCounts();
  for (const file of files) {
    for (const key of Object.keys(totals)) totals[key] += file.counts[key];
  }
  return {
    formatVersion: 1,
    schemaVersion: typeof report.schemaVersion === "string" ? report.schemaVersion : null,
    totals: withScore(totals),
    files,
    mutants: files.flatMap((file) => file.mutants)
  };
}

export function checkMutationPolicy(summary, policy, { partial = false } = {}) {
  if (!summary || !Array.isArray(summary.files) || !policy || typeof policy.files !== "object") {
    throw new TypeError("mutation summary and policy are malformed");
  }
  const failures = [];
  const filesByPath = new Map(summary.files.map((file) => [file.path, file]));
  for (const file of summary.files) {
    if (!Object.hasOwn(policy.files, file.path)) failures.push(`${file.path}: missing policy rule`);
  }
  for (const [path, rule] of Object.entries(policy.files)) {
    if (partial && !filesByPath.has(path)) continue;
    if (!rule || typeof rule !== "object") throw new TypeError(`${path}: policy rule must be an object`);
    if (
      rule.minimumScore !== null &&
      (typeof rule.minimumScore !== "number" || rule.minimumScore < 0 || rule.minimumScore > 100)
    ) {
      throw new TypeError(`${path}: minimumScore must be null or between 0 and 100`);
    }
    if (typeof rule.targetScore !== "number" || rule.targetScore < 0 || rule.targetScore > 100) {
      throw new TypeError(`${path}: targetScore must be between 0 and 100`);
    }
    if (typeof rule.minimumScore === "number" && rule.targetScore < rule.minimumScore) {
      throw new TypeError(`${path}: targetScore must not be below minimumScore`);
    }
    if (rule.maximumSurvived !== null && (!Number.isInteger(rule.maximumSurvived) || rule.maximumSurvived < 0)) {
      throw new TypeError(`${path}: maximumSurvived must be null or a non-negative integer`);
    }
    const file = filesByPath.get(path);
    if (!file) {
      failures.push(`${path}: missing from mutation report`);
      continue;
    }
    const score = file.counts?.mutationScore;
    if (typeof score !== "number") failures.push(`${path}: has no scored mutants`);
    else if (typeof rule.minimumScore === "number" && score < rule.minimumScore) {
      failures.push(`${path}: score ${score.toFixed(2)} is below ${rule.minimumScore.toFixed(2)}`);
    }
    const survived = file.counts?.survived;
    if (!Number.isInteger(survived)) failures.push(`${path}: has no survived count`);
    else if (Number.isInteger(rule.maximumSurvived) && survived > rule.maximumSurvived) {
      failures.push(`${path}: ${survived} survived mutants exceeds ${rule.maximumSurvived}`);
    }
  }
  return failures;
}

export function proposeMutationRatchet(summary, policy, { partial = false } = {}) {
  if (!summary || !Array.isArray(summary.files) || !policy || typeof policy.files !== "object") {
    throw new TypeError("mutation summary and policy are malformed");
  }
  const step = policy.ratchetStep;
  if (!Number.isInteger(step) || step < 1 || step > 100) {
    throw new TypeError("mutation policy ratchetStep must be an integer between 1 and 100");
  }
  // Validate all rules and observed values before proposing a policy update.
  const failures = checkMutationPolicy(summary, policy, { partial });
  if (failures.length) {
    throw new Error(`cannot advance a mutation policy while its current baseline fails:\n- ${failures.join("\n- ")}`);
  }
  const proposed = structuredClone(policy);
  const changes = [];
  for (const file of summary.files) {
    const rule = proposed.files[file.path];
    if (!rule) continue;
    const score = file.counts?.mutationScore;
    const survived = file.counts?.survived;
    if (typeof score !== "number" || !Number.isInteger(survived)) continue;
    const measuredFloor = Math.min(rule.targetScore, Math.floor(score / step) * step);
    if (rule.minimumScore === null || measuredFloor > rule.minimumScore) {
      changes.push(`${file.path}: minimumScore ${String(rule.minimumScore)} -> ${measuredFloor}`);
      rule.minimumScore = measuredFloor;
    }
    if (rule.maximumSurvived === null || survived < rule.maximumSurvived) {
      changes.push(`${file.path}: maximumSurvived ${String(rule.maximumSurvived)} -> ${survived}`);
      rule.maximumSurvived = survived;
    }
  }
  return { policy: proposed, changes };
}

async function summarizeCommand([inputPath, outputPath]) {
  if (!inputPath || !outputPath) throw new Error("usage: mutation-report summarize <raw.json> <summary.json>");
  const report = JSON.parse(await readFile(inputPath, "utf8"));
  await writeFile(outputPath, `${JSON.stringify(summarizeMutationReport(report), null, 2)}\n`, "utf8");
}

async function checkCommand([summaryPath, policyPath, ...flags]) {
  if (!summaryPath || !policyPath) throw new Error("usage: mutation-report check <summary.json> <policy.json>");
  const [summary, policy] = await Promise.all(
    [summaryPath, policyPath].map(async (path) => JSON.parse(await readFile(path, "utf8")))
  );
  const unknownFlags = flags.filter((flag) => flag !== "--partial");
  if (unknownFlags.length) throw new Error(`unknown mutation policy option: ${unknownFlags.join(", ")}`);
  const failures = checkMutationPolicy(summary, policy, {
    partial: flags.includes("--partial") || Boolean(process.env.MULTAIPLAYER_MUTATION_SHARD)
  });
  if (failures.length) throw new Error(`mutation policy drift:\n- ${failures.join("\n- ")}`);
  process.stdout.write("Mutation policy passed.\n");
}

async function githubCommand([label, summaryPath]) {
  if (!label || !summaryPath) throw new Error("usage: mutation-report github <label> <summary.json>");
  if (!process.env.GITHUB_STEP_SUMMARY) throw new Error("GITHUB_STEP_SUMMARY is not configured");
  const report = JSON.parse(await readFile(summaryPath, "utf8"));
  const totals = report?.totals;
  if (!totals || typeof totals !== "object") throw new Error("mutation summary has no totals");
  const score = totals.mutationScore === null ? "n/a" : `${totals.mutationScore}%`;
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## ${label}\n\n| Score | Detected | Survived | No coverage | Total |\n| ---: | ---: | ---: | ---: | ---: |\n| ${score} | ${totals.detected} | ${totals.survived} | ${totals.noCoverage} | ${totals.total} |\n`,
    "utf8"
  );
}

async function ratchetCommand([summaryPath, policyPath, outputPath, ...flags]) {
  if (!summaryPath || !policyPath || !outputPath) {
    throw new Error("usage: mutation-report ratchet <summary.json> <policy.json> <candidate.json> [--partial]");
  }
  const unknownFlags = flags.filter((flag) => flag !== "--partial");
  if (unknownFlags.length) throw new Error(`unknown mutation ratchet option: ${unknownFlags.join(", ")}`);
  const [summary, policy] = await Promise.all(
    [summaryPath, policyPath].map(async (path) => JSON.parse(await readFile(path, "utf8")))
  );
  const proposal = proposeMutationRatchet(summary, policy, {
    partial: flags.includes("--partial") || Boolean(process.env.MULTAIPLAYER_MUTATION_SHARD)
  });
  await writeFile(outputPath, `${JSON.stringify(proposal.policy, null, 2)}\n`, "utf8");
  process.stdout.write(
    proposal.changes.length > 0
      ? `Mutation ratchet candidate:\n- ${proposal.changes.join("\n- ")}\n`
      : "Mutation policy already matches the measured ratchet.\n"
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [command, ...args] = process.argv.slice(2);
  const commands = { summarize: summarizeCommand, check: checkCommand, github: githubCommand, ratchet: ratchetCommand };
  if (!commands[command]) {
    console.error("usage: mutation-report <summarize|check|github|ratchet> ...");
    process.exitCode = 1;
  } else {
    commands[command](args).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
