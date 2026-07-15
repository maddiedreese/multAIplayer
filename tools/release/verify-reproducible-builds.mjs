#!/usr/bin/env node

// This is scheduled release evidence, not a day-to-day maintainer command.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [documentation, release, lockfile] = await Promise.all([
  readFile("docs/reproducible-builds.md", "utf8"),
  readFile(".github/workflows/release.yml", "utf8"),
  readFile("package-lock.json", "utf8")
]);

for (const command of ["npm ci", "npm run release:preflight", "npm run tauri:build:release -w @multaiplayer/desktop"]) {
  assert.ok(documentation.includes(command), `reproducibility guide must document: ${command}`);
  assert.ok(release.includes(command), `release workflow must execute: ${command}`);
}
assert.match(documentation, /macOS 15/);
assert.match(release, /runs-on: macos-15/);
assert.match(documentation, /Node\.js 22/);
assert.match(release, /node-version: 22/);
JSON.parse(lockfile);
console.log("Reproducible-build documentation matches the locked release inputs.");
