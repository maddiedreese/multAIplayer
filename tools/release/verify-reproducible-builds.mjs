#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const [tauriConfigText, updaterPublicKey] = await Promise.all([
  readFile("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
  readFile("apps/desktop/src-tauri/updater-public.key", "utf8")
]);
const tauriConfig = JSON.parse(tauriConfigText);
assert.equal(
  tauriConfig.plugins?.updater?.pubkey,
  updaterPublicKey.trim(),
  "embedded updater key must match its public file"
);
assert.deepEqual(tauriConfig.plugins?.updater?.endpoints, [
  "https://raw.githubusercontent.com/maddiedreese/multAIplayer/update-channel/releases/latest.json"
]);

execFileSync(
  "cargo",
  [
    "test",
    "--locked",
    "--manifest-path",
    "apps/desktop/src-tauri/Cargo.toml",
    "--lib",
    "updater_auth::tests",
    "--",
    "--nocapture"
  ],
  { stdio: "inherit" }
);
console.log("Updater key/endpoint configuration agrees and executable Rust authentication tests passed.");
