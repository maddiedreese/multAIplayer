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

test("relay validates PORT with the bounded integer parser", () => {
  const previous = process.env.PORT;
  try {
    process.env.PORT = "not-a-port";
    assert.equal(loadRelayConfig().port, 4321);
    process.env.PORT = "999999";
    assert.equal(loadRelayConfig().port, 65_535);
  } finally {
    if (previous === undefined) delete process.env.PORT;
    else process.env.PORT = previous;
  }
});

test("relay bounds durable per-account device and retained-session caps", () => {
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
    assert.equal(loadRelayConfig().registeredDeviceCapPerUser, 1);
    assert.equal(loadRelayConfig().retainedAuthSessionCapPerUser, 1);

    process.env[registeredDeviceName] = "10001";
    process.env[retainedSessionName] = "1001";
    assert.equal(loadRelayConfig().registeredDeviceCapPerUser, 10_000);
    assert.equal(loadRelayConfig().retainedAuthSessionCapPerUser, 1_000);

    process.env[registeredDeviceName] = "invalid";
    process.env[retainedSessionName] = "invalid";
    assert.equal(loadRelayConfig().registeredDeviceCapPerUser, 25);
    assert.equal(loadRelayConfig().retainedAuthSessionCapPerUser, 20);
  } finally {
    restoreEnv(registeredDeviceName, previousRegisteredDeviceCap);
    restoreEnv(retainedSessionName, previousRetainedSessionCap);
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

test("relay falls back safely for invalid shutdown drain values", () => {
  const previous = process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS;
  try {
    process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS = "not-a-number";
    assert.equal(loadRelayConfig().shutdown.drainMs, 0);
    process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS = "-1";
    assert.equal(loadRelayConfig().shutdown.drainMs, 0);
    process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS = "60001";
    assert.equal(loadRelayConfig().shutdown.drainMs, 60_000);
  } finally {
    if (previous === undefined) delete process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS;
    else process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS = previous;
  }
});

test("relay bounds the trusted-network rate-limit multiplier", () => {
  const previous = process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER;
  try {
    delete process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER;
    assert.equal(loadRelayConfig().trustedNetworkRateLimitMultiplier, 8);
    process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER = "0";
    assert.equal(loadRelayConfig().trustedNetworkRateLimitMultiplier, 1);
    process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER = "500";
    assert.equal(loadRelayConfig().trustedNetworkRateLimitMultiplier, 100);
  } finally {
    restoreEnv("MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER", previous);
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
