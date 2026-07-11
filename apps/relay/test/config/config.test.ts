import { test } from "node:test";
import { assert, join, mkdtemp, rm, startRelay, tmpdir, writeFile } from "../support/relay.js";
import { loadRelayConfig } from "../../src/config.js";

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

test("relay defaults to SQLite and requires an explicit JSON compatibility choice", () => {
  const previousStorage = process.env.MULTAIPLAYER_RELAY_STORAGE;
  const previousDataPath = process.env.MULTAIPLAYER_RELAY_DATA_PATH;
  try {
    delete process.env.MULTAIPLAYER_RELAY_STORAGE;
    delete process.env.MULTAIPLAYER_RELAY_DATA_PATH;
    const defaultConfig = loadRelayConfig();
    assert.equal(defaultConfig.storageBackend, "sqlite");
    assert.match(defaultConfig.dataPath, /relay-store\.sqlite$/);

    process.env.MULTAIPLAYER_RELAY_STORAGE = "json";
    const jsonConfig = loadRelayConfig();
    assert.equal(jsonConfig.storageBackend, "json");
    assert.match(jsonConfig.dataPath, /relay-store\.json$/);

    process.env.MULTAIPLAYER_RELAY_STORAGE = "invalid";
    assert.equal(loadRelayConfig().storageBackend, "sqlite");
  } finally {
    if (previousStorage === undefined) delete process.env.MULTAIPLAYER_RELAY_STORAGE;
    else process.env.MULTAIPLAYER_RELAY_STORAGE = previousStorage;
    if (previousDataPath === undefined) delete process.env.MULTAIPLAYER_RELAY_DATA_PATH;
    else process.env.MULTAIPLAYER_RELAY_DATA_PATH = previousDataPath;
  }
});

test("relay loads configuration from env files without overriding process env", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-relay-env-test-"));
  const envPath = join(tempDir, ".env");
  await writeFile(
    envPath,
    [
      'GITHUB_OAUTH_SCOPES="read:user repo"',
      "MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://env-file.example/ # normalized",
      "MULTAIPLAYER_RELAY_REQUIRE_AUTH=false"
    ].join("\n"),
    "utf8"
  );
  const relay = await startRelay({
    GITHUB_OAUTH_SCOPES: "read:user workflow",
    MULTAIPLAYER_RELAY_ENV_FILE: envPath
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      scopes: string[];
      mutationsRequireAuth: boolean;
      allowedOrigins: string[];
    };
    assert.deepEqual(body.scopes, ["read:user", "workflow"]);
    assert.equal(body.mutationsRequireAuth, false);
    assert.deepEqual(body.allowedOrigins, ["https://env-file.example"]);
  } finally {
    await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
