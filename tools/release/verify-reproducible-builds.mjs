#!/usr/bin/env node

// This is scheduled release evidence, not a day-to-day maintainer command.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [documentation, release, lockfile, tauriConfigText, updaterPublicKey, nativeUpdater, nativeApp] =
  await Promise.all([
    readFile("docs/reproducible-builds.md", "utf8"),
    readFile(".github/workflows/release.yml", "utf8"),
    readFile("package-lock.json", "utf8"),
    readFile("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
    readFile("apps/desktop/src-tauri/updater-public.key", "utf8"),
    readFile("apps/desktop/src-tauri/src/updater_auth.rs", "utf8"),
    readFile("apps/desktop/src-tauri/src/lib.rs", "utf8")
  ]);

for (const command of ["npm ci", "npm run release:preflight", "npm run tauri:build:release -w @multaiplayer/desktop"]) {
  assert.ok(documentation.includes(command), `reproducibility guide must document: ${command}`);
  assert.ok(release.includes(command), `release workflow must execute: ${command}`);
}
assert.match(documentation, /macOS 15/);
assert.match(release, /runs-on: macos-15/);
assert.match(documentation, /Node\.js 22/);
assert.match(release, /node-version: 22/);
for (const evidence of [
  "multaiplayer.spdx.json",
  "desktop-reproducibility-evidence.zip",
  "compare-macos-app-payloads.mjs",
  "write-tauri-update-manifest.mjs",
  "verify_update_manifest",
  "npx tauri signer sign",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
]) {
  assert.ok(release.includes(evidence), `release workflow must publish or require: ${evidence}`);
}
for (const evidence of [
  "multaiplayer.spdx.json",
  "desktop-reproducibility-evidence.zip",
  "compare-macos-app-payloads.mjs"
]) {
  assert.ok(documentation.includes(evidence), `reproducibility guide must document: ${evidence}`);
}
const tauriConfig = JSON.parse(tauriConfigText);
assert.equal(
  tauriConfig.plugins?.updater?.pubkey,
  updaterPublicKey.trim(),
  "embedded updater key must match its public file"
);
assert.deepEqual(tauriConfig.plugins?.updater?.endpoints, [
  "https://raw.githubusercontent.com/maddiedreese/multAIplayer/update-channel/releases/latest.json"
]);
assert.match(nativeApp, /default_version_comparator\(updater_auth::authenticated_update_is_newer\)/);
for (const binding of [
  "metadata.version != version",
  "metadata.url != url",
  "metadata.archive_signature != archive_signature"
]) {
  assert.ok(nativeUpdater.includes(binding), `native updater comparator must enforce: ${binding}`);
}
assert.match(nativeUpdater, /release\.version <= current/);
JSON.parse(lockfile);
console.log("Reproducible-build, SBOM, and signed-updater contracts match the locked release inputs.");
