import { createRelayApp } from "../../src/server.js";
import { logRelayEvent } from "../../src/observability.js";
import { FileDeletionLedger } from "../../src/auth/deletion-ledger.js";

// The production entry point cannot enable a filesystem deletion ledger. This
// fixture removes its private file settings before config parsing, supplies a
// syntactically complete external production config, and injects the file
// implementation directly for isolated process tests.
const ledgerPath = process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH;
const ledgerKey = process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY;
const primaryOnlyDeletion = process.env.MULTAIPLAYER_RELAY_DELETION_PROTECTION === "primary_only";
const ledgerProtectionSeconds = Number(process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS ?? 7_776_000);
delete process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH;
if (primaryOnlyDeletion) {
  for (const key of [
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY"
  ]) {
    delete process.env[key];
  }
} else {
  process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT ??= "https://relay-ledger.invalid";
  process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET ??= "relay-tests";
  process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION ??= "us-test-1";
  process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID ??= "relay-test-access-key";
  process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY ??=
    "relay-test-secret-access-key-at-least-32-characters";
}

if (!primaryOnlyDeletion && (!ledgerPath || !ledgerKey)) {
  throw new Error("Relay process fixture requires an injected deletion ledger.");
}
const relay = await createRelayApp(
  primaryOnlyDeletion
    ? {}
    : { deletionLedgerForTests: new FileDeletionLedger(ledgerPath!, ledgerKey!, ledgerProtectionSeconds) }
);
relay.listen();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    relay
      .shutdown()
      .catch(() => {
        logRelayEvent("error", "relay_shutdown_failed");
        process.exitCode = 1;
      })
      .finally(() => process.exit(process.exitCode ?? 0));
  });
}
