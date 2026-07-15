import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  assessCodexVersion,
  latestContractTestedCodexVersion,
  minimumSupportedCodexVersion
} from "./codex-compatibility.mjs";

const productionRelayEnv = {
  ...process.env,
  GITHUB_CLIENT_ID: "dummy-client-id",
  MULTAIPLAYER_RELAY_SESSION_SECRET: "12345678901234567890123456789012",
  MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT: "https://bucket.example.test",
  MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET: "relay-deletions",
  MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION: "auto",
  MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID: "dummy-access-key",
  MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY: "12345678901234567890123456789012",
  MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_URL_STYLE: "virtual-host",
  MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY: "abcdefghijklmnopqrstuvwxzy123456",
  MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS: "7776000",
  MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com,https://app.multaiplayer.com",
  MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
  MULTAIPLAYER_RELAY_DEBUG: "false",
  MULTAIPLAYER_RELAY_RATE_LIMITS: "true",
  MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS: "false",
  MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED: "false",
  MULTAIPLAYER_RELAY_STORAGE: "sqlite",
  MULTAIPLAYER_RELAY_DATA_PATH: ".multaiplayer/relay-store.sqlite",
  MULTAIPLAYER_MLS_VALIDATOR_PATH: process.execPath,
  MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES: "5000000",
  MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES: "250000000",
  MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW: "100000000",
  MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER: "20",
  MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT: "120",
  MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER: "500"
};

test("Codex compatibility policy classifies the supported range and its boundaries", () => {
  assert.equal(minimumSupportedCodexVersion, "0.133.0");
  assert.equal(latestContractTestedCodexVersion, "0.144.0");
  assert.equal(assessCodexVersion("codex-cli 0.132.9").status, "unsupported_older");
  assert.equal(assessCodexVersion("codex-cli 0.133.0").status, "supported");
  assert.equal(assessCodexVersion("codex-cli 0.144.0").status, "supported");
  assert.equal(assessCodexVersion("codex-cli 0.145.0-alpha.1").status, "unverified_newer");
  assert.equal(assessCodexVersion("development build").status, "unknown");
});

test("development doctor always reports Codex compatibility and the tested range", () => {
  const result = spawnSync(process.execPath, ["scripts/doctor.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  assert.match(result.stdout, /\[ok\] codex compatibility: .*tested app-server range 0\.133\.0–0\.144\.0/);
});

test("production relay doctor accepts a hardened representative environment", () => {
  const result = runProductionDoctor(productionRelayEnv);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /production MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: configured with exact http\(s\) origins/);
  assert.match(result.stdout, /production MULTAIPLAYER_RELAY_RATE_LIMITS: rate limits enabled/);
  assert.match(result.stdout, /production external deletion ledger: S3-compatible ledger configured/);
  assert.match(result.stdout, /production MULTAIPLAYER_RELAY_STORAGE: sqlite storage configured/);
  assert.match(result.stdout, /production MULTAIPLAYER_RELAY_DATA_PATH: configured/);
  assert.match(result.stdout, /production MULTAIPLAYER_MLS_VALIDATOR_PATH: configured executable/);
  assert.match(result.stdout, /production MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW: configured/);
  assert.match(result.stdout, /production MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT: configured/);
  assert.match(result.stdout, /production MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER: configured/);
  assert.doesNotMatch(result.stdout, /\bcargo:/);
  assert.doesNotMatch(result.stdout, /\brustc:/);
});

test("production relay doctor rejects an unsafe deletion-ledger protection horizon", () => {
  const result = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS: "7689600"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /protection horizon >= 7776000 seconds/);
});

test("production relay doctor rejects a missing MLS validator executable", () => {
  const result = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_MLS_VALIDATOR_PATH: "/definitely/missing/mls-validator"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /MLS_VALIDATOR_PATH: must point to an executable validator/);
});

test("production relay doctor rejects unsupported storage backends", () => {
  const result = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_RELAY_STORAGE: "spreadsheet"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /MULTAIPLAYER_RELAY_STORAGE/);
  assert.match(result.stdout, /must be sqlite/);
});

test("production relay doctor requires sqlite storage", () => {
  const result = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_RELAY_STORAGE: "json"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /MULTAIPLAYER_RELAY_STORAGE/);
  assert.match(result.stdout, /must be sqlite for a hosted production relay/);
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

test("production relay doctor rejects an explicitly empty origin allowlist", () => {
  const result = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: " , "
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /MULTAIPLAYER_RELAY_ALLOWED_ORIGINS/);
  assert.match(result.stdout, /no origins were provided/);
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

test("production relay doctor requires explicit trusted-proxy pairing", () => {
  const unsafe = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS: "true"
  });
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stdout, /requires MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED=true/);

  const paired = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS: "true",
    MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED: "true"
  });
  assert.equal(paired.status, 0, paired.stderr || paired.stdout);
});

test("production relay doctor rejects missing cost guardrail bounds", () => {
  const result = runProductionDoctor({
    ...productionRelayEnv,
    MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW: "1",
    MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER: "0",
    MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER: "0"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW/);
  assert.match(result.stdout, /WEBSOCKET_CONNECTION_CAP_USER/);
  assert.match(result.stdout, /TOTAL_ROOM_CAP_USER/);
});

function runProductionDoctor(env) {
  return spawnSync(process.execPath, ["scripts/doctor.mjs", "--production-relay"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
