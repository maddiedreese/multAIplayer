import { test } from "node:test";
import { assert, join, mkdtemp, rm, startRelay, tmpdir, writeFile } from "../support/relay.js";
import { loadRelayConfig } from "../../src/config.js";
import { configuredKeyPackageValidator } from "../../src/relay-app.js";

test("production requires a configured MLS KeyPackage validator", () => {
  const previous = process.env.MULTAIPLAYER_MLS_VALIDATOR_PATH;
  try {
    delete process.env.MULTAIPLAYER_MLS_VALIDATOR_PATH;
    assert.throws(() => configuredKeyPackageValidator("production"), /MLS_VALIDATOR_PATH/);
  } finally {
    if (previous === undefined) delete process.env.MULTAIPLAYER_MLS_VALIDATOR_PATH;
    else process.env.MULTAIPLAYER_MLS_VALIDATOR_PATH = previous;
  }
});

test("relay defaults absent integers and rejects malformed or out-of-range values", () => {
  const previous = process.env.PORT;
  try {
    delete process.env.PORT;
    assert.equal(loadRelayConfig().port, 4321);
    for (const invalid of ["", "not-a-port", "4321.5", "1e3", "999999"]) {
      process.env.PORT = invalid;
      assert.throws(() => loadRelayConfig(), /PORT must be an integer between 1 and 65535/);
    }
    process.env.PORT = " 4321 ";
    assert.equal(loadRelayConfig().port, 4321);
  } finally {
    if (previous === undefined) delete process.env.PORT;
    else process.env.PORT = previous;
  }
});

test("relay rejects invalid durable per-account device and retained-session caps", () => {
  const registeredDeviceName = "MULTAIPLAYER_RELAY_REGISTERED_DEVICE_CAP_USER";
  const retainedSessionName = "MULTAIPLAYER_RELAY_RETAINED_AUTH_SESSION_CAP_USER";
  const previousRegisteredDeviceCap = process.env[registeredDeviceName];
  const previousRetainedSessionCap = process.env[retainedSessionName];
  try {
    delete process.env[registeredDeviceName];
    delete process.env[retainedSessionName];
    assert.equal(loadRelayConfig().registeredDeviceCapPerUser, 25);
    assert.equal(loadRelayConfig().retainedAuthSessionCapPerUser, 20);

    process.env[registeredDeviceName] = "0";
    process.env[retainedSessionName] = "0";
    assert.throws(() => loadRelayConfig(), /REGISTERED_DEVICE_CAP_USER must be an integer between 1 and 10000/);

    process.env[registeredDeviceName] = "10001";
    process.env[retainedSessionName] = "1001";
    assert.throws(() => loadRelayConfig(), /REGISTERED_DEVICE_CAP_USER must be an integer between 1 and 10000/);

    process.env[registeredDeviceName] = "25";
    process.env[retainedSessionName] = "invalid";
    assert.throws(() => loadRelayConfig(), /RETAINED_AUTH_SESSION_CAP_USER must be an integer between 1 and 1000/);
  } finally {
    restoreEnv(registeredDeviceName, previousRegisteredDeviceCap);
    restoreEnv(retainedSessionName, previousRetainedSessionCap);
  }
});

test("lowering the global durable-entry cap keeps the absent per-team default valid", () => {
  const globalName = "MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES";
  const teamName = "MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES_PER_TEAM";
  const previousGlobal = process.env[globalName];
  const previousTeam = process.env[teamName];
  try {
    process.env[globalName] = "1000";
    delete process.env[teamName];
    assert.equal(loadRelayConfig().maxDurableEntriesPerTeam, 999);
    process.env[teamName] = "1000";
    assert.throws(
      () => loadRelayConfig(),
      /MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES_PER_TEAM must be an integer between 100 and 999/
    );
  } finally {
    restoreEnv(globalName, previousGlobal);
    restoreEnv(teamName, previousTeam);
  }
});

test("ciphertext defaults fit the hosted memory budget and reject contradictory ceilings", () => {
  const names = [
    "MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES",
    "MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES",
    "MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES",
    "MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES_PER_TEAM",
    "MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES",
    "MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_TEAM",
    "MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_ROOM"
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    const defaults = loadRelayConfig();
    assert.equal(defaults.maxAttachmentBlobBytes, 100_000_000);
    assert.equal(defaults.maxAttachmentBlobBytesPerTeam, 50_000_000);
    assert.equal(defaults.attachmentBlobLiveQuotaBytes, 50_000_000);
    assert.equal(defaults.maxMlsBacklogBytes, 50_000_000);
    assert.equal(defaults.maxMlsBacklogBytesPerTeam, 25_000_000);
    assert.equal(defaults.maxMlsBacklogBytesPerRoom, 5_000_000);

    process.env.MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES = "50000000";
    process.env.MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES_PER_TEAM = "60000000";
    assert.throws(() => loadRelayConfig(), /Attachment byte ceilings must be ordered team <= relay/);

    process.env.MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES_PER_TEAM = "50000000";
    process.env.MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES = "60000000";
    assert.throws(() => loadRelayConfig(), /Per-user live attachment quota must not exceed/);

    process.env.MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES = "50000000";
    process.env.MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES = "10000000";
    assert.throws(() => loadRelayConfig(), /MLS backlog byte ceilings must be ordered/);
  } finally {
    for (const name of names) restoreEnv(name, previous.get(name));
  }
});

test("relay only enables metrics with a strong bearer token", () => {
  const previous = process.env.MULTAIPLAYER_RELAY_METRICS_TOKEN;
  try {
    delete process.env.MULTAIPLAYER_RELAY_METRICS_TOKEN;
    assert.equal(loadRelayConfig().metricsToken, null);
    process.env.MULTAIPLAYER_RELAY_METRICS_TOKEN = "too-short";
    assert.equal(loadRelayConfig().metricsToken, null);
    process.env.MULTAIPLAYER_RELAY_METRICS_TOKEN = "a-strong-metrics-token-with-32-characters";
    assert.equal(loadRelayConfig().metricsToken, "a-strong-metrics-token-with-32-characters");
  } finally {
    if (previous === undefined) delete process.env.MULTAIPLAYER_RELAY_METRICS_TOKEN;
    else process.env.MULTAIPLAYER_RELAY_METRICS_TOKEN = previous;
  }
});

test("relay rejects invalid shutdown drain values", () => {
  const previous = process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS;
  try {
    for (const invalid of ["", "not-a-number", "1.5", "-1", "60001"]) {
      process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS = invalid;
      assert.throws(
        () => loadRelayConfig(),
        /MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS must be an integer between 0 and 60000/
      );
    }
  } finally {
    if (previous === undefined) delete process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS;
    else process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS = previous;
  }
});

test("relay rejects an out-of-range trusted-network rate-limit multiplier", () => {
  const previous = process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER;
  try {
    delete process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER;
    assert.equal(loadRelayConfig().trustedNetworkRateLimitMultiplier, 8);
    process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER = "0";
    assert.throws(() => loadRelayConfig(), /TRUSTED_NETWORK_MULTIPLIER must be an integer between 1 and 100/);
    process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER = "500";
    assert.throws(() => loadRelayConfig(), /TRUSTED_NETWORK_MULTIPLIER must be an integer between 1 and 100/);
  } finally {
    restoreEnv("MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER", previous);
  }
});

test("relay bounds per-account KeyPackage validation work", () => {
  const name = "MULTAIPLAYER_RELAY_KEY_PACKAGE_VALIDATION_CAP_USER";
  const previous = process.env[name];
  try {
    delete process.env[name];
    assert.equal(loadRelayConfig().keyPackageValidationCapPerUser, 40);
    process.env[name] = "0";
    assert.throws(() => loadRelayConfig(), /KEY_PACKAGE_VALIDATION_CAP_USER must be an integer between 1 and 10000/);
    process.env[name] = "10001";
    assert.throws(() => loadRelayConfig(), /KEY_PACKAGE_VALIDATION_CAP_USER must be an integer between 1 and 10000/);
  } finally {
    restoreEnv(name, previous);
  }
});

test("authentication defaults on and only the explicit unsafe opt-out disables it", () => {
  const previous = process.env.MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH;
  try {
    delete process.env.MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH;
    assert.equal(loadRelayConfig().mutationsRequireAuth, true);
    process.env.MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH = "true";
    assert.equal(loadRelayConfig().mutationsRequireAuth, false);
  } finally {
    restoreEnv("MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH", previous);
  }
});

test("relay accepts common explicit booleans and rejects empty or unrecognized values", () => {
  const name = "MULTAIPLAYER_RELAY_DEBUG";
  const previous = process.env[name];
  try {
    delete process.env[name];
    assert.equal(loadRelayConfig().debugEndpointsEnabled, false);
    for (const enabled of ["1", "true", "yes", "on", " TRUE "]) {
      process.env[name] = enabled;
      assert.equal(loadRelayConfig().debugEndpointsEnabled, true);
    }
    for (const disabled of ["0", "false", "no", "off"]) {
      process.env[name] = disabled;
      assert.equal(loadRelayConfig().debugEndpointsEnabled, false);
    }
    for (const invalid of ["", "enabled", "2"]) {
      process.env[name] = invalid;
      assert.throws(() => loadRelayConfig(), /MULTAIPLAYER_RELAY_DEBUG must be true or false/);
    }
  } finally {
    restoreEnv(name, previous);
  }
});

test("production supports primary-only deletion but restore-safe mode requires an external ledger", () => {
  const names = [
    "NODE_ENV",
    "MULTAIPLAYER_RELAY_DELETION_PROTECTION",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY"
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.NODE_ENV = "production";
    assert.equal(loadRelayConfig().deletionProtection, "primary_only");
    process.env.MULTAIPLAYER_RELAY_DELETION_PROTECTION = "restore_safe";
    assert.throws(() => loadRelayConfig(), /requires a complete external deletion ledger/);
  } finally {
    for (const name of names) restoreEnv(name, previous.get(name));
  }
});

test("production fail-stop exits for supervisor restart unless explicitly overridden", () => {
  const keys = [
    "NODE_ENV",
    "MULTAIPLAYER_RELAY_EXIT_ON_PERSISTENCE_POISON",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY"
  ] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = "production";
    delete process.env.MULTAIPLAYER_RELAY_EXIT_ON_PERSISTENCE_POISON;
    delete process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH;
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT = "https://ledger.example.test";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET = "relay";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION = "us-test-1";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID = "test-access-key";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY = "test-secret-key-at-least-32-characters";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY = "test-deletion-ledger-key-at-least-32-characters";
    assert.equal(loadRelayConfig().exitOnPersistencePoison, true);
    process.env.MULTAIPLAYER_RELAY_EXIT_ON_PERSISTENCE_POISON = "false";
    assert.equal(loadRelayConfig().exitOnPersistencePoison, false);
  } finally {
    for (const key of keys) restoreEnv(key, previous.get(key));
  }
});

test("S3 deletion ledger requires independent transport and HMAC keys", () => {
  const names = [
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY"
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const reusedKey = "test-reused-key-with-at-least-32-characters";
  try {
    delete process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH;
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT = "https://ledger.example.test";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET = "relay";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION = "us-test-1";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID = "test-access-key";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY = reusedKey;
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY = reusedKey;
    assert.throws(() => loadRelayConfig(), /HMAC key must differ from the S3 secret access key/);
  } finally {
    for (const name of names) restoreEnv(name, previous.get(name));
  }
});

test("production rejects the development filesystem deletion ledger", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    ledgerPath: process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH,
    ledgerKey: process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY
  };
  try {
    process.env.NODE_ENV = "production";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH = ".multaiplayer/test-deletion-ledger";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY = "test-deletion-ledger-key-at-least-32-characters";
    assert.throws(() => loadRelayConfig(), /external S3-compatible deletion ledger/);
  } finally {
    restoreEnv("NODE_ENV", previous.nodeEnv);
    restoreEnv("MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH", previous.ledgerPath);
    restoreEnv("MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY", previous.ledgerKey);
  }
});

test("deletion ledger protection horizon rejects malformed and out-of-range values", () => {
  const names = [
    "NODE_ENV",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS"
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.NODE_ENV = "development";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH = ".multaiplayer/test-deletion-ledger";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY = "test-deletion-ledger-key-at-least-32-characters";
    for (const invalid of ["not-an-integer", "7776000.5", "86399", "31536001"]) {
      process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS = invalid;
      assert.throws(
        () => loadRelayConfig(),
        /MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS must be an integer between 86400 and 31536000/
      );
    }
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS = "31536000";
    assert.equal(loadRelayConfig().deletionLedger?.protectionSeconds, 31_536_000);
  } finally {
    for (const name of names) restoreEnv(name, previous.get(name));
  }
});

test("production S3 deletion ledger requires HTTPS while development permits HTTP", () => {
  const names = [
    "NODE_ENV",
    "MULTAIPLAYER_RELAY_DELETION_PROTECTION",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_URL_STYLE",
    "MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS"
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.MULTAIPLAYER_RELAY_DELETION_PROTECTION = "restore_safe";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET = "relay";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION = "us-test-1";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID = "test-access-key";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY = "test-secret-key-at-least-32-characters";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY = "test-deletion-ledger-key-at-least-32-characters";

    process.env.NODE_ENV = "production";
    for (const invalidEndpoint of ["http://ledger.example.test", "not-a-url"]) {
      process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT = invalidEndpoint;
      assert.throws(() => loadRelayConfig(), /S3 endpoint must be a valid HTTPS URL/);
    }

    process.env.NODE_ENV = "development";
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT = "http://ledger.example.test";
    assert.equal(loadRelayConfig().deletionLedger?.backend, "s3");
  } finally {
    for (const name of names) restoreEnv(name, previous.get(name));
  }
});

test("relay defaults to SQLite persistence", () => {
  const previousDataPath = process.env.MULTAIPLAYER_RELAY_DATA_PATH;
  try {
    delete process.env.MULTAIPLAYER_RELAY_DATA_PATH;
    const defaultConfig = loadRelayConfig();
    assert.match(defaultConfig.dataPath, /relay-store\.sqlite$/);
  } finally {
    if (previousDataPath === undefined) delete process.env.MULTAIPLAYER_RELAY_DATA_PATH;
    else process.env.MULTAIPLAYER_RELAY_DATA_PATH = previousDataPath;
  }
});

test("relay trusts proxy headers only through the explicit opt-in", () => {
  const previousTrust = process.env.MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS;
  try {
    delete process.env.MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS;
    assert.equal(loadRelayConfig().trustProxyHeaders, false);
    process.env.MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS = "true";
    assert.equal(loadRelayConfig().trustProxyHeaders, true);
  } finally {
    restoreEnv("MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS", previousTrust);
  }
});

test("relay loads configuration from env files without overriding process env", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-relay-env-test-"));
  const envPath = join(tempDir, ".env");
  await writeFile(
    envPath,
    [
      "MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://env-file.example/ # normalized",
      "MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH=false"
    ].join("\n"),
    "utf8"
  );
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_ENV_FILE: envPath,
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "true"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      scopes: string[];
      mutationsRequireAuth: boolean;
      allowedOrigins: string[];
    };
    assert.deepEqual(body.scopes, ["read:user"]);
    assert.equal(body.mutationsRequireAuth, false);
    assert.deepEqual(body.allowedOrigins, ["https://env-file.example"]);
  } finally {
    await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("relay rejects the entire allowed-origin configuration when any entry is invalid", () => {
  const previous = process.env.MULTAIPLAYER_RELAY_ALLOWED_ORIGINS;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    process.env.MULTAIPLAYER_RELAY_ALLOWED_ORIGINS = "https://app.example.test,https://app.example.test/path";
    assert.throws(
      () => loadRelayConfig(),
      /ALLOWED_ORIGINS entries must be bare HTTP\(S\) origins or the exact tauri:\/\/localhost/
    );

    process.env.MULTAIPLAYER_RELAY_ALLOWED_ORIGINS = "https://app.example.test,tauri://localhost";
    assert.deepEqual(loadRelayConfig().allowedCorsOrigins, ["https://app.example.test", "tauri://localhost"]);
  } finally {
    restoreEnv("MULTAIPLAYER_RELAY_ALLOWED_ORIGINS", previous);
    restoreEnv("NODE_ENV", previousNodeEnv);
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
