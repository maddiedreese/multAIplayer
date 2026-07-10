import { test } from "node:test";
import { assert, startRelay } from "../support/relay.js";

test("relay normalizes configured CORS origins", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS:
      "https://multaiplayer.com/ https://multaiplayer.com tauri://localhost https://bad.example/path"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { allowedOrigins: string[] };
    assert.deepEqual(body.allowedOrigins, ["https://multaiplayer.com", "tauri://localhost"]);
  } finally {
    await relay.close();
  }
});

test("relay rejects disallowed browser origins before handling requests", async () => {
  const relay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com"
  });
  try {
    const allowed = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "https://multaiplayer.com" }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://multaiplayer.com");

    const disallowed = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "https://attacker.example" }
    });
    assert.equal(disallowed.status, 403);
    assert.deepEqual(await disallowed.json(), { error: "Origin not allowed" });
    assert.equal(disallowed.headers.get("access-control-allow-origin"), null);

    const nonBrowserClient = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(nonBrowserClient.status, 200);
  } finally {
    await relay.close();
  }
});

test("relay applies configured CORS origin allowlist", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com/ http://127.0.0.1:1420"
  });
  try {
    const allowed = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "https://multaiplayer.com" }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://multaiplayer.com");
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");

    const denied = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "https://example.com" }
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "Origin not allowed" });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    assert.equal(denied.headers.get("access-control-allow-credentials"), null);
  } finally {
    await relay.close();
  }
});

test("relay denies browser CORS origins by default in production", async () => {
  const relay = await startRelay({ NODE_ENV: "production" });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "https://multaiplayer.com" }
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Origin not allowed" });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    await relay.close();
  }
});
