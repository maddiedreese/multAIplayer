import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const doctorPath = fileURLToPath(new URL("../../../scripts/doctor.mjs", import.meta.url));
const repositoryRoot = dirname(dirname(doctorPath));
const ledgerEnvironmentNames = [
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_URL_STYLE"
] as const;

const validProductionEnvironment: NodeJS.ProcessEnv = {
  MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://app.example.test",
  MULTAIPLAYER_RELAY_DATA_PATH: `${repositoryRoot}/doctor-test.sqlite`,
  MULTAIPLAYER_RELAY_DEBUG: "false",
  MULTAIPLAYER_RELAY_EXIT_ON_PERSISTENCE_POISON: "true",
  MULTAIPLAYER_RELAY_RATE_LIMITS: "true",
  MULTAIPLAYER_RELAY_STRUCTURED_LOGS: "true",
  MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS: "false",
  MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false",
  MULTAIPLAYER_MLS_VALIDATOR_PATH: process.execPath
};

function runDoctor(extraEnv: NodeJS.ProcessEnv): { status: number | null; output: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", ...validProductionEnvironment, ...extraEnv };
  for (const name of ledgerEnvironmentNames) {
    if (!(name in extraEnv)) delete env[name];
  }
  const result = spawnSync(process.execPath, [doctorPath, "--production-relay"], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8"
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

test("production doctor accepts primary-only deletion without external ledger credentials", () => {
  const { status, output } = runDoctor({ MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only" });
  assert.equal(status, 0, output);
  assert.match(output, /\[ok\] production account deletion protection: primary-only deletion configured/);
  assert.doesNotMatch(output, /\[fail\] production external deletion ledger/);

  const fileLedgerResult = runDoctor({
    MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only",
    MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH: "/tmp/deletion-ledger.json"
  });
  assert.notEqual(fileLedgerResult.status, 0);
  assert.match(fileLedgerResult.output, /\[fail\] production account deletion protection/);
});

test("production doctor requires distinct S3 transport and HMAC keys in restore-safe mode", () => {
  const reusedKey = "test-reused-key-with-at-least-32-characters";
  const restoreSafeEnvironment = {
    MULTAIPLAYER_RELAY_DELETION_PROTECTION: "restore_safe",
    MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT: "https://ledger.example.test",
    MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET: "relay",
    MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION: "us-test-1",
    MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID: "test-access-key",
    MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY: reusedKey,
    MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY: "independent-hmac-key-with-at-least-32-characters",
    MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_URL_STYLE: "path"
  };
  const validResult = runDoctor(restoreSafeEnvironment);
  assert.equal(validResult.status, 0, validResult.output);
  assert.match(validResult.output, /\[ok\] production external deletion ledger: S3-compatible ledger configured/);
  const invalidResult = runDoctor({
    ...restoreSafeEnvironment,
    MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY: reusedKey
  });
  assert.notEqual(invalidResult.status, 0);
  assert.match(invalidResult.output, /\[fail\] production external deletion ledger/);
});

test("production doctor warns when the single trusted-proxy opt-in is enabled", () => {
  const { status, output } = runDoctor({
    MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only",
    MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS: "true"
  });
  assert.equal(status, 0, output);
  assert.match(
    output,
    /\[ok\] production trusted-proxy configuration: WARNING: forwarded headers are trusted; ensure the relay is unreachable except through a proxy that overwrites client forwarding headers/
  );
});

test("production doctor accepts only the packaged desktop custom origin", () => {
  const desktopResult = runDoctor({
    MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://app.example.test,tauri://localhost"
  });
  assert.equal(desktopResult.status, 0, desktopResult.output);

  const customSchemeResult = runDoctor({
    MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "multaiplayer://localhost"
  });
  assert.notEqual(customSchemeResult.status, 0);
  assert.match(customSchemeResult.output, /exact tauri:\/\/localhost desktop origin/);

  const mixedInvalidResult = runDoctor({
    MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://app.example.test,https://app.example.test/path"
  });
  assert.notEqual(mixedInvalidResult.status, 0);
  assert.match(mixedInvalidResult.output, /must be a bare origin without path, query, or hash/);
});

test("production doctor rejects configuration the relay would reject at startup", () => {
  const invalidBoolean = runDoctor({
    MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only",
    MULTAIPLAYER_RELAY_DEBUG: ""
  });
  assert.notEqual(invalidBoolean.status, 0);
  assert.match(invalidBoolean.output, /production MULTAIPLAYER_RELAY_DEBUG: must be true or false/);

  const invalidInteger = runDoctor({
    MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only",
    MULTAIPLAYER_RELAY_MIN_DISK_HEADROOM_BYTES: "1e9"
  });
  assert.notEqual(invalidInteger.status, 0);
  assert.match(
    invalidInteger.output,
    /production MULTAIPLAYER_RELAY_MIN_DISK_HEADROOM_BYTES: must be a decimal integer/
  );
});

test("production doctor derives a valid per-team default from a lowered global durable cap", () => {
  const result = runDoctor({
    MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only",
    MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES: "1000"
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /per-team ceiling 999; global ceiling 1000/);
});
