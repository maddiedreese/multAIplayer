#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const excludedNames = new Set(["_CodeSignature", "CodeResources", "embedded.provisionprofile"]);
const machoMagics = new Set(["cafebabe", "bebafeca", "feedface", "cefaedfe", "feedfacf", "cffaedfe"]);

async function walk(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (excludedNames.has(entry.name)) continue;
    const path = join(current, entry.name);
    paths.push(path);
    if (entry.isDirectory()) paths.push(...(await walk(root, path)));
  }
  return paths;
}

async function isMachO(path) {
  const handle = await import("node:fs/promises").then(({ open }) => open(path, "r"));
  try {
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    return bytesRead === 4 && machoMagics.has(buffer.toString("hex"));
  } finally {
    await handle.close();
  }
}

async function removeSignatureResources(current) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (excludedNames.has(entry.name)) {
      await rm(path, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      await removeSignatureResources(path);
    }
  }
}

async function normalizeCopy(source, destination) {
  await cp(source, destination, { recursive: true, verbatimSymlinks: true });
  await removeSignatureResources(destination);
  const paths = await walk(destination);
  for (const path of paths) {
    const stat = await lstat(path).catch(() => null);
    if (!stat?.isFile() || !(await isMachO(path))) continue;
    await execFileAsync("/usr/bin/codesign", ["--remove-signature", path]).catch(() => undefined);
  }
}

async function contentManifest(root) {
  const manifest = [];
  for (const path of await walk(root)) {
    const stat = await lstat(path);
    const name = relative(root, path);
    if (stat.isDirectory()) continue;
    if (stat.isSymbolicLink()) {
      manifest.push({ path: name, type: "symlink", target: await readlink(path) });
      continue;
    }
    if (stat.isFile()) {
      const content = await readFile(path);
      manifest.push({
        path: name,
        type: "file",
        executable: (stat.mode & 0o111) !== 0,
        size: content.length,
        sha256: createHash("sha256").update(content).digest("hex")
      });
    }
  }
  return manifest.sort((left, right) => left.path.localeCompare(right.path));
}

export function compareManifests(published, rebuilt) {
  const publishedByPath = new Map(published.map((entry) => [entry.path, entry]));
  const rebuiltByPath = new Map(rebuilt.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...publishedByPath.keys(), ...rebuiltByPath.keys()])].sort();
  return paths.flatMap((path) => {
    const left = publishedByPath.get(path);
    const right = rebuiltByPath.get(path);
    return JSON.stringify(left) === JSON.stringify(right)
      ? []
      : [{ path, published: left ?? null, rebuilt: right ?? null }];
  });
}

export async function compareMacOSAppPayloads({ publishedApp, rebuiltApp, evidenceDirectory }) {
  assert.ok(publishedApp.endsWith(".app") && rebuiltApp.endsWith(".app"), "both inputs must be macOS app bundles");
  const temporary = await mkdtemp(join(tmpdir(), "multaiplayer-payload-"));
  const publishedCopy = join(temporary, "published.app");
  const rebuiltCopy = join(temporary, "rebuilt.app");
  try {
    await Promise.all([normalizeCopy(publishedApp, publishedCopy), normalizeCopy(rebuiltApp, rebuiltCopy)]);
    const [published, rebuilt] = await Promise.all([contentManifest(publishedCopy), contentManifest(rebuiltCopy)]);
    const differences = compareManifests(published, rebuilt);
    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(evidenceDirectory, "published-payload.json"), `${JSON.stringify(published, null, 2)}\n`),
      writeFile(join(evidenceDirectory, "rebuilt-payload.json"), `${JSON.stringify(rebuilt, null, 2)}\n`),
      writeFile(join(evidenceDirectory, "payload-differences.json"), `${JSON.stringify(differences, null, 2)}\n`),
      writeFile(
        join(evidenceDirectory, "comparison.json"),
        `${JSON.stringify(
          {
            matched: differences.length === 0,
            differenceCount: differences.length,
            comparison:
              "file paths, executable bits, symlink targets, and SHA-256 hashes after removing code signatures",
            caveat:
              "This evidence does not claim bit-for-bit reproducibility of signed, notarized, stapled, or packaged outputs."
          },
          null,
          2
        )}\n`
      )
    ]);
    return differences;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("compare-macos-app-payloads.mjs")) {
  const [publishedApp, rebuiltApp, evidenceDirectory] = process.argv.slice(2);
  assert.ok(
    publishedApp && rebuiltApp && evidenceDirectory,
    "expected published app, rebuilt app, and evidence directory"
  );
  const differences = await compareMacOSAppPayloads({ publishedApp, rebuiltApp, evidenceDirectory });
  if (differences.length > 0) process.exitCode = 1;
}
