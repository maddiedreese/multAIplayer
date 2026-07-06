import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const productionRelayEnv = {
  ...process.env,
  GITHUB_CLIENT_ID: "dummy-client-id",
  MULTAIPLAYER_RELAY_SESSION_SECRET: "12345678901234567890123456789012",
  MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com,https://app.multaiplayer.com",
  MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
  MULTAIPLAYER_RELAY_DEBUG: "false",
  MULTAIPLAYER_RELAY_SEED_DEMO: "false",
  MULTAIPLAYER_RELAY_RATE_LIMITS: "true",
  MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS: "false",
  MULTAIPLAYER_RELAY_STORAGE: "sqlite",
  MULTAIPLAYER_RELAY_DATA_PATH: ".multaiplayer/relay-store.json"
};

test("production relay doctor accepts a hardened representative environment", () => {
  const result = runProductionDoctor(productionRelayEnv);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /production MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: configured with exact http\(s\) origins/);
  assert.match(result.stdout, /production MULTAIPLAYER_RELAY_RATE_LIMITS: rate limits enabled/);
  assert.match(result.stdout, /production MULTAIPLAYER_RELAY_STORAGE: sqlite storage configured/);
  assert.match(result.stdout, /production MULTAIPLAYER_RELAY_DATA_PATH: configured/);
  assert.doesNotMatch(result.stdout, /\bcargo:/);
  assert.doesNotMatch(result.stdout, /\brustc:/);
});

test("production relay doctor rejects unsupported storage backends", () => {
  const result = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_RELAY_STORAGE: "spreadsheet"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /MULTAIPLAYER_RELAY_STORAGE/);
  assert.match(result.stdout, /must be json or sqlite/);
});

test("production relay doctor rejects wildcard and pathful origins", () => {
  const wildcard = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "*"
  });
  assert.notEqual(wildcard.status, 0);
  assert.match(wildcard.stdout, /\* is not allowed/);

  const pathful = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com/app"
  });
  assert.notEqual(pathful.status, 0);
  assert.match(pathful.stdout, /bare origin/);
});

test("production relay doctor rejects disabled rate limits and temporary storage", () => {
  const result = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_RELAY_RATE_LIMITS: "false",
    MULTAIPLAYER_RELAY_DATA_PATH: "/tmp/multaiplayer-relay-store.json"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /RATE_LIMITS|rate limits/i);
  assert.match(result.stdout, /must not point at \/tmp/);
});

function runProductionDoctor(env) {
  return spawnSync(process.execPath, ["scripts/doctor.mjs", "--production-relay"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
