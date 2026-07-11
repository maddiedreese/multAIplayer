import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifestPath = process.argv[2];
if (!manifestPath) {
  throw new Error("Usage: check-latest-codex-contract MANIFEST.json");
}

const latest = JSON.parse(await readFile(manifestPath, "utf8"));
const baseline = JSON.parse(
  await readFile(new URL("../contracts/codex-app-server/0.144.0.json", import.meta.url), "utf8")
);

const fields = [
  "requestIdTypes",
  "clientRequestMethods",
  "serverRequestMethods",
  "serverNotificationMethods",
  "initializeCapabilities",
  "authModes",
  "appToolApprovalModes",
  "threadItemTypes"
];

assert.equal(latest.manifestVersion, baseline.manifestVersion, "manifest format changed");
assert.match(latest.codexVersion, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
for (const field of fields) {
  assert.ok(Array.isArray(latest[field]), `${field} must be an array`);
  const current = new Set(latest[field]);
  for (const required of baseline[field]) {
    assert.ok(current.has(required), `${latest.codexVersion} removed ${field} entry: ${required}`);
  }
}

console.log(`Codex ${latest.codexVersion} preserves the 0.144.0 app-server contract.`);
