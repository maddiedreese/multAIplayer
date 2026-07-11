#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const alwaysRejectedStatuses = new Set(["NoCoverage", "RuntimeError", "Pending"]);

/** Enforce repository-owned mutation quality gates against a deterministic summary. */
export function checkMutationPolicy(summary, policy) {
  requireObject(summary, "mutation summary");
  requireObject(policy, "mutation policy");
  if (!Array.isArray(summary.files) || !Array.isArray(summary.mutants)) {
    throw new TypeError("mutation summary must contain files and mutants arrays");
  }
  requireObject(policy.files, "mutation policy files");
  if (!Array.isArray(policy.allowedTimeouts)) {
    throw new TypeError("mutation policy must contain an allowedTimeouts array");
  }

  const failures = [];
  const governedFiles = new Set(Object.keys(policy.files));
  const filesByPath = new Map(summary.files.map((file) => [file.path, file]));
  for (const [path, rule] of Object.entries(policy.files)) {
    requireObject(rule, `mutation policy rule for ${JSON.stringify(path)}`);
    if (typeof rule.minimumScore !== "number" || rule.minimumScore < 0 || rule.minimumScore > 100) {
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
    const score = file.counts?.mutationScore;
    if (typeof score !== "number") {
      failures.push(`${path}: has no mutation score`);
    } else if (score < rule.minimumScore) {
      failures.push(`${path}: mutation score ${score.toFixed(2)} is below ${rule.minimumScore.toFixed(2)}`);
    }
    const survived = file.counts?.survived;
    if (!Number.isInteger(survived)) {
      failures.push(`${path}: has no survived-mutant count`);
    } else if (survived > rule.maximumSurvived) {
      failures.push(`${path}: ${survived} survived mutants exceeds maximum ${rule.maximumSurvived}`);
    }
  }

  const allowedTimeouts = policy.allowedTimeouts.map(validateTimeoutRule);
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
    } else if (!knownStatus(mutant.status)) {
      failures.push(describeMutant(mutant, `unknown status ${JSON.stringify(mutant.status)}`));
    }
  }

  return failures;
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
  const failures = checkMutationPolicy(summary, policy);
  if (failures.length > 0) throw new Error(`mutation policy failed:\n- ${failures.join("\n- ")}`);
  process.stdout.write("Mutation policy passed.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
