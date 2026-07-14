#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultSourceRoot = fileURLToPath(new URL("../apps/desktop/src-tauri/src", import.meta.url));
const defaultRustContract = fileURLToPath(new URL("../apps/desktop/src-tauri/src/command_error.rs", import.meta.url));
const defaultTypeScriptContract = fileURLToPath(
  new URL("../apps/desktop/src/lib/nativeCommandError.ts", import.meta.url)
);

/**
 * Tauri serializes a command's error type directly across IPC. A direct
 * `Result<_, _>` therefore bypasses the repository's stable CommandError
 * contract, regardless of whether its error happens to be String today.
 */
export function inspectTauriCommandErrors(source, path = "source.rs") {
  const violations = [];
  const attribute = /#\s*\[\s*tauri::command(?:\s*\([^\]]*\))?\s*\]/g;

  for (const match of source.matchAll(attribute)) {
    const declaration = source.slice(match.index + match[0].length);
    const functionMatch =
      /^(?:\s|#\s*\[[^\]]*\])*?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(declaration);
    if (!functionMatch) {
      violations.push(`${path}: could not inspect the function following #[tauri::command]`);
      continue;
    }

    const signatureStart = functionMatch.index;
    const bodyStart = declaration.indexOf("{", signatureStart);
    if (bodyStart === -1) {
      violations.push(`${path}: ${functionMatch[1]} has no inspectable body`);
      continue;
    }
    const signature = declaration.slice(signatureStart, bodyStart);
    if (/->\s*(?:(?:std|core)::result::)?Result\s*</s.test(signature)) {
      violations.push(`${path}: ${functionMatch[1]} returns Result directly; use crate::command_error::CommandResult`);
    }
  }

  return violations;
}

export async function findTauriCommandErrorViolations(sourceRoot = defaultSourceRoot) {
  const paths = await rustFiles(sourceRoot);
  const results = await Promise.all(
    paths.map(async (path) => inspectTauriCommandErrors(await readFile(path, "utf8"), relative(workspaceRoot, path)))
  );
  return results.flat().sort();
}

export function compareNativeCommandErrorCodes(rustSource, typeScriptSource) {
  const rustBody = /enum\s+CommandErrorCode\s*\{(?<body>[^}]*)\}/s.exec(rustSource)?.groups?.body;
  const typeScriptBody = /type\s+NativeCommandErrorCode\s*=\s*(?<body>[\s\S]*?);/.exec(typeScriptSource)?.groups?.body;
  if (rustBody === undefined || typeScriptBody === undefined) {
    return ["Could not parse both native command error code contracts."];
  }
  const rustCodes = rustBody
    .replaceAll(/\/\/.*$/gm, "")
    .split(",")
    .map((variant) => /^\s*([A-Z][A-Za-z0-9]*)/.exec(variant)?.[1])
    .filter(Boolean)
    .map((variant) => variant.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
  const typeScriptCodes = [...typeScriptBody.matchAll(/"([a-z][a-z0-9_]*)"/g)].map((match) => match[1]);
  const onlyRust = rustCodes.filter((code) => !typeScriptCodes.includes(code));
  const onlyTypeScript = typeScriptCodes.filter((code) => !rustCodes.includes(code));
  const failures = [];
  if (onlyRust.length > 0) failures.push(`Rust-only native command error codes: ${onlyRust.join(", ")}`);
  if (onlyTypeScript.length > 0) {
    failures.push(`TypeScript-only native command error codes: ${onlyTypeScript.join(", ")}`);
  }
  return failures;
}

export async function findNativeCommandErrorCodeMismatches(
  rustPath = defaultRustContract,
  typeScriptPath = defaultTypeScriptContract
) {
  const [rustSource, typeScriptSource] = await Promise.all([
    readFile(rustPath, "utf8"),
    readFile(typeScriptPath, "utf8")
  ]);
  return compareNativeCommandErrorCodes(rustSource, typeScriptSource);
}

async function rustFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return rustFiles(path);
      return entry.isFile() && path.endsWith(".rs") ? [path] : [];
    })
  );
  return nested.flat();
}

async function main() {
  const violations = [...(await findTauriCommandErrorViolations()), ...(await findNativeCommandErrorCodeMismatches())];
  if (violations.length > 0) {
    throw new Error(`Tauri command error contract failed:\n- ${violations.join("\n- ")}`);
  }
  console.log("Tauri commands use CommandResult and Rust/TypeScript error codes match.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
