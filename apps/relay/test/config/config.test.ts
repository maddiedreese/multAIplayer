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

test("relay supports only SQLite persistence", () => {
  const previousStorage = process.env.MULTAIPLAYER_RELAY_STORAGE;
  const previousDataPath = process.env.MULTAIPLAYER_RELAY_DATA_PATH;
  try {
    delete process.env.MULTAIPLAYER_RELAY_STORAGE;
    delete process.env.MULTAIPLAYER_RELAY_DATA_PATH;
    const defaultConfig = loadRelayConfig();
    assert.match(defaultConfig.dataPath, /relay-store\.sqlite$/);

    process.env.MULTAIPLAYER_RELAY_STORAGE = "json";
    assert.throws(() => loadRelayConfig(), /JSON runtime backend has been removed/);

    process.env.MULTAIPLAYER_RELAY_STORAGE = "invalid";
    assert.throws(() => loadRelayConfig(), /must be sqlite/);
  } finally {
    if (previousStorage === undefined) delete process.env.MULTAIPLAYER_RELAY_STORAGE;
    else process.env.MULTAIPLAYER_RELAY_STORAGE = previousStorage;
    if (previousDataPath === undefined) delete process.env.MULTAIPLAYER_RELAY_DATA_PATH;
    else process.env.MULTAIPLAYER_RELAY_DATA_PATH = previousDataPath;
  }
});

test("relay rejects one-sided trusted-proxy configuration", () => {
  const previousTrust = process.env.MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS;
  const previousConfigured = process.env.MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED;
  try {
    process.env.MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS = "true";
    process.env.MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED = "false";
    assert.throws(() => loadRelayConfig(), /must be enabled or disabled together/);
    process.env.MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS = "false";
    process.env.MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED = "true";
    assert.throws(() => loadRelayConfig(), /must be enabled or disabled together/);
  } finally {
    restoreEnv("MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS", previousTrust);
    restoreEnv("MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED", previousConfigured);
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
    assert.deepEqual(body.scopes, ["read:user", "repo"]);
    assert.equal(body.mutationsRequireAuth, false);
    assert.deepEqual(body.allowedOrigins, ["https://env-file.example"]);
  } finally {
    await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
