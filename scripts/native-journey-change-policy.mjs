#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function isSafelySkippableDocumentationPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized.endsWith(".md")) return false;
  return !normalized.includes("/") || normalized.startsWith("docs/") || normalized === "e2e/README.md";
}

export function nativeJourneyDecision(paths) {
  const changedPaths = paths.filter((path) => path.length > 0);
  if (changedPaths.length === 0) {
    return { run: true, reason: "No changed-file list was available; running conservatively." };
  }
  const nonDocumentationPaths = changedPaths.filter((path) => !isSafelySkippableDocumentationPath(path));
  if (nonDocumentationPaths.length > 0) {
    const displayPath = Array.from(nonDocumentationPaths[0], (character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? "?" : character;
    })
      .join("")
      .slice(0, 200);
    return {
      run: true,
      reason: `Changed executable, configuration, dependency, asset, or unclassified path: ${displayPath}`
    };
  }
  return {
    run: false,
    reason: `All ${changedPaths.length} changed file${changedPaths.length === 1 ? " is" : "s are"} safely classified Markdown documentation.`
  };
}

async function main() {
  const fileIndex = process.argv.indexOf("--changed-files");
  if (fileIndex < 0 || !process.argv[fileIndex + 1]) {
    throw new Error("Usage: native-journey-change-policy.mjs --changed-files <NUL-delimited-path-file>");
  }
  const raw = await readFile(resolve(process.argv[fileIndex + 1]), "utf8");
  const decision = nativeJourneyDecision(raw.split("\0"));
  process.stdout.write(`run=${String(decision.run)}\nreason=${decision.reason}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
