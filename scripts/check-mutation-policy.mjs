#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const alwaysRejectedStatuses = new Set(["NoCoverage", "RuntimeError", "Pending"]);

/** Enforce repository-owned mutation quality gates against a deterministic summary. */
export function checkMutationPolicy(summary, policy, sources = {}) {
  requireObject(summary, "mutation summary");
  requireObject(policy, "mutation policy");
  if (!Array.isArray(summary.files) || !Array.isArray(summary.mutants)) {
    throw new TypeError("mutation summary must contain files and mutants arrays");
  }
  requireObject(policy.files, "mutation policy files");
  if (!Array.isArray(policy.allowedTimeouts)) {
    throw new TypeError("mutation policy must contain an allowedTimeouts array");
  }
  if (!Array.isArray(policy.allowedIgnored)) {
    throw new TypeError("mutation policy must contain an allowedIgnored array");
  }
  if (!Array.isArray(policy.regions)) {
    throw new TypeError("mutation policy must contain a regions array");
  }

  const failures = [];
  const governedFiles = new Set([
    ...Object.keys(policy.files),
    ...policy.regions.map((region) => (region && typeof region === "object" ? region.file : undefined))
  ]);
  const filesByPath = new Map(summary.files.map((file) => [file.path, file]));
  for (const [path, rule] of Object.entries(policy.files)) {
    requireObject(rule, `mutation policy rule for ${JSON.stringify(path)}`);
    if (
      rule.minimumScore !== undefined &&
      (typeof rule.minimumScore !== "number" || rule.minimumScore < 0 || rule.minimumScore > 100)
    ) {
      throw new TypeError(`mutation policy rule for ${JSON.stringify(path)} has an invalid minimumScore`);
    }
    if (!Number.isInteger(rule.maximumSurvived) || rule.maximumSurvived < 0) {
      throw new TypeError(`mutation policy rule for ${JSON.stringify(path)} has an invalid maximumSurvived`);
    }
    const file = filesByPath.get(path);
    if (!file) {
      failures.push(`${path}: missing from mutation summary`);
      continue;
    }
    if (rule.minimumScore !== undefined) {
      const score = file.counts?.mutationScore;
      if (typeof score !== "number") {
        failures.push(`${path}: has no mutation score`);
      } else if (score < rule.minimumScore) {
        failures.push(`${path}: mutation score ${score.toFixed(2)} is below ${rule.minimumScore.toFixed(2)}`);
      }
    }
    const survived = file.counts?.survived;
    if (!Number.isInteger(survived)) {
      failures.push(`${path}: has no survived-mutant count`);
    } else if (survived > rule.maximumSurvived) {
      failures.push(`${path}: ${survived} survived mutants exceeds maximum ${rule.maximumSurvived}`);
    }
  }

  const allowedTimeouts = policy.allowedTimeouts.map(validateTimeoutRule);
  const allowedIgnored = policy.allowedIgnored.map((rule, index) => validateIgnoredRule(rule, index));
  for (const mutant of summary.mutants) {
    if (alwaysRejectedStatuses.has(mutant.status)) {
      failures.push(describeMutant(mutant, `${mutant.status} is not allowed`));
    } else if (
      mutant.status === "CompileError" &&
      (typeof mutant.statusReason !== "string" || !/error TS\d+:/.test(mutant.statusReason))
    ) {
      failures.push(describeMutant(mutant, "CompileError has no TypeScript checker diagnostic"));
    } else if (mutant.status === "Timeout" && !allowedTimeouts.some((rule) => matchesTimeout(mutant, rule))) {
      failures.push(describeMutant(mutant, "Timeout has no matching policy rationale"));
    } else if (
      mutant.status === "Ignored" &&
      governedFiles.has(mutant.file) &&
      (typeof mutant.statusReason !== "string" || mutant.statusReason.length === 0)
    ) {
      failures.push(describeMutant(mutant, "Ignored has no rationale"));
    } else if (
      mutant.status === "Ignored" &&
      governedFiles.has(mutant.file) &&
      mutant.statusReason.includes("excluded mutation")
    ) {
      failures.push(describeMutant(mutant, "broad mutator exclusions are not allowed in governed files"));
    } else if (mutant.status === "Ignored" && !allowedIgnored.some((rule) => matchesIgnored(mutant, rule))) {
      failures.push(describeMutant(mutant, "Ignored has no exact policy ledger entry"));
    } else if (!knownStatus(mutant.status)) {
      failures.push(describeMutant(mutant, `unknown status ${JSON.stringify(mutant.status)}`));
    }
  }
  for (const rule of allowedIgnored) {
    if (!summary.mutants.some((mutant) => mutant.status === "Ignored" && matchesIgnored(mutant, rule))) {
      failures.push(`${rule.file}:${rule.line}:${rule.column}: stale allowedIgnored policy entry`);
    }
  }

  for (const [index, rule] of policy.regions.entries()) {
    requireObject(rule, `mutation policy region ${index}`);
    for (const field of ["file", "marker"]) {
      if (typeof rule[field] !== "string" || rule[field].length === 0) {
        throw new TypeError(`mutation policy region ${index} must have a non-empty ${field}`);
      }
    }
    if (!/^[a-z0-9-]+$/.test(rule.marker)) {
      throw new TypeError(`mutation policy region ${index} has an invalid marker`);
    }
    for (const field of [
      "maximumSurvived",
      "maximumNoCoverage",
      "maximumRuntimeError",
      "maximumPending",
      "maximumTimeout"
    ]) {
      if (!Number.isInteger(rule[field]) || rule[field] < 0) {
        throw new TypeError(`mutation policy region ${index} has an invalid ${field}`);
      }
    }
    if (typeof sources[rule.file] !== "string") {
      failures.push(`${rule.file} [${rule.marker}]: source is unavailable`);
      continue;
    }
    const region = findRegion(sources[rule.file], rule.file, rule.marker);
    const overlapping = summary.mutants.filter(
      (mutant) => mutant.file === rule.file && mutant.endLine >= region.start && mutant.line <= region.end
    );
    const crossing = overlapping.filter((mutant) => mutant.line <= region.start || mutant.endLine >= region.end);
    for (const mutant of crossing) {
      failures.push(describeMutant(mutant, `crosses mutation-policy region ${JSON.stringify(rule.marker)}`));
    }
    const inside = overlapping.filter((mutant) => mutant.line > region.start && mutant.endLine < region.end);
    const limits = {
      Survived: rule.maximumSurvived,
      NoCoverage: rule.maximumNoCoverage,
      RuntimeError: rule.maximumRuntimeError,
      Pending: rule.maximumPending,
      Timeout: rule.maximumTimeout
    };
    for (const [status, maximum] of Object.entries(limits)) {
      const count = inside.filter((mutant) => mutant.status === status).length;
      if (count > maximum) {
        failures.push(`${rule.file} [${rule.marker}]: ${count} ${status} mutants exceeds maximum ${maximum}`);
      }
    }
  }

  return failures;
}

export function findRegion(source, file, marker) {
  const starts = [];
  const ends = [];
  const stack = [];
  for (const [offset, line] of source.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*\/\/ mutation-policy:(start|end) ([a-z0-9-]+)\s*$/);
    if (!match) continue;
    const [, kind, name] = match;
    const lineNumber = offset + 1;
    if (kind === "start") {
      if (stack.length > 0) throw new Error(`${file}:${lineNumber}: mutation-policy regions may not be nested`);
      stack.push({ name, line: lineNumber });
      if (name === marker) starts.push(lineNumber);
    } else {
      const start = stack.pop();
      if (!start || start.name !== name) {
        throw new Error(`${file}:${lineNumber}: unmatched mutation-policy end marker ${JSON.stringify(name)}`);
      }
      if (name === marker) ends.push(lineNumber);
    }
  }
  if (stack.length > 0)
    throw new Error(`${file}:${stack[0].line}: unclosed mutation-policy region ${JSON.stringify(stack[0].name)}`);
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error(
      `${file}: mutation-policy region ${JSON.stringify(marker)} must have exactly one start and end marker`
    );
  }
  return { start: starts[0], end: ends[0] };
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

function validateTimeoutRule(rule, index) {
  requireObject(rule, `allowed timeout ${index}`);
  for (const field of ["file", "mutator", "replacement", "rationale"]) {
    if (typeof rule[field] !== "string" || rule[field].length === 0) {
      throw new TypeError(`allowed timeout ${index} must have a non-empty ${field}`);
    }
  }
  for (const field of ["line", "column", "endLine", "endColumn"]) {
    if (!Number.isInteger(rule[field]) || rule[field] < 0) {
      throw new TypeError(`allowed timeout ${index} must have a non-negative integer ${field}`);
    }
  }
  return rule;
}

function validateIgnoredRule(rule, index) {
  requireObject(rule, `allowed ignored ${index}`);
  for (const field of ["file", "mutator", "replacement", "rationale"]) {
    if (typeof rule[field] !== "string" || rule[field].length === 0) {
      throw new TypeError(`allowed ignored ${index} must have a non-empty ${field}`);
    }
  }
  for (const field of ["line", "column", "endLine", "endColumn"]) {
    if (!Number.isInteger(rule[field]) || rule[field] < 0) {
      throw new TypeError(`allowed ignored ${index} must have a non-negative integer ${field}`);
    }
  }
  return rule;
}

function matchesIgnored(mutant, rule) {
  return (
    mutant.file === rule.file &&
    mutant.line === rule.line &&
    mutant.column === rule.column &&
    mutant.endLine === rule.endLine &&
    mutant.endColumn === rule.endColumn &&
    mutant.mutator === rule.mutator &&
    mutant.replacement === rule.replacement &&
    mutant.statusReason === rule.rationale
  );
}

function matchesTimeout(mutant, rule) {
  return (
    mutant.file === rule.file &&
    mutant.mutator === rule.mutator &&
    mutant.replacement === rule.replacement &&
    mutant.line === rule.line &&
    mutant.column === rule.column &&
    mutant.endLine === rule.endLine &&
    mutant.endColumn === rule.endColumn
  );
}

function knownStatus(status) {
  return ["Killed", "Survived", "CompileError", "Ignored", "Timeout"].includes(status);
}

function describeMutant(mutant, problem) {
  return `${mutant.file}:${mutant.line}:${mutant.column} [${mutant.id}] ${problem}`;
}

export async function runCli(args) {
  if (args.length !== 2) {
    throw new Error("usage: node scripts/check-mutation-policy.mjs <summary.json> <policy.json>");
  }
  const [summary, policy] = await Promise.all(args.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  const sources = Object.fromEntries(
    await Promise.all(
      [...new Set(policy.regions.map((region) => region.file))].map(async (path) => [
        path,
        await readFile(path, "utf8")
      ])
    )
  );
  const failures = checkMutationPolicy(summary, policy, sources);
  if (failures.length > 0) throw new Error(`mutation policy failed:\n- ${failures.join("\n- ")}`);
  process.stdout.write("Mutation policy passed.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
