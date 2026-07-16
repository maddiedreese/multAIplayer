import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const doctorPath = fileURLToPath(new URL("../../../scripts/doctor.mjs", import.meta.url));
const repositoryRoot = dirname(dirname(doctorPath));
const ledgerEnvironmentNames = [
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY",
  "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_URL_STYLE"
] as const;

function runDoctor(extraEnv: NodeJS.ProcessEnv): string {
  const env = { ...process.env, NODE_ENV: "production", ...extraEnv };
  for (const name of ledgerEnvironmentNames) {
    if (!(name in extraEnv)) delete env[name];
  }
  const result = spawnSync(process.execPath, [doctorPath, "--production-relay"], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8"
  });
  return `${result.stdout}\n${result.stderr}`;
}

test("production doctor accepts primary-only deletion without external ledger credentials", () => {
  const output = runDoctor({ MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only" });
  assert.match(output, /\[ok\] production account deletion protection: primary-only deletion configured/);
  assert.doesNotMatch(output, /\[fail\] production external deletion ledger/);
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
  assert.match(
    runDoctor(restoreSafeEnvironment),
    /\[ok\] production external deletion ledger: S3-compatible ledger configured/
  );
  const output = runDoctor({
    ...restoreSafeEnvironment,
    MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY: reusedKey
  });
  assert.match(output, /\[fail\] production external deletion ledger/);
});
