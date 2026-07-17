import { test } from "node:test";
import { WebSocket, assert, startRelay } from "../support/relay.js";
import type { ClientOptions } from "ws";

async function openSocket(url: string, options?: ClientOptions): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function rejectedSocketStatus(url: string, options?: ClientOptions): Promise<number> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
      response.resume();
    });
    socket.once("open", () => {
      socket.close();
      reject(new Error("expected the WebSocket upgrade to be rejected"));
    });
    socket.once("error", reject);
  });
}

test("relay deduplicates configured CORS origins", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com https://multaiplayer.com tauri://localhost"
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
    assert.deepEqual(await disallowed.json(), { error: "Origin not allowed", code: "forbidden" });
    assert.equal(disallowed.headers.get("access-control-allow-origin"), null);

    const nonBrowserClient = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(nonBrowserClient.status, 200);
  } finally {
    await relay.close();
  }
});

test("relay applies configured CORS origin allowlist", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com http://127.0.0.1:1420"
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
    assert.deepEqual(await denied.json(), { error: "Origin not allowed", code: "forbidden" });
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
    assert.deepEqual(await response.json(), { error: "Origin not allowed", code: "forbidden" });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    await relay.close();
  }
});

test("empty origin allowlist is permissive only for development browser clients", async () => {
  const relay = await startRelay({
    NODE_ENV: "development",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: " , "
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "https://development.example" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://development.example");

    const socket = await openSocket(relay.wsUrl, { origin: "https://development.example" });
    socket.close();
  } finally {
    await relay.close();
  }
});

test("empty production allowlist denies browser origins but permits clients that omit Origin", async () => {
  const relay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: " , "
  });
  try {
    const browserResponse = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "https://browser.example" }
    });
    assert.equal(browserResponse.status, 403);

    const nativeResponse = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(nativeResponse.status, 200);

    assert.equal(await rejectedSocketStatus(relay.wsUrl, { origin: "https://browser.example" }), 403);
    const nativeSocket = await openSocket(relay.wsUrl);
    nativeSocket.close();
  } finally {
    await relay.close();
  }
});

test("an empty Origin header is invalid rather than a native-client omission", async () => {
  const relay = await startRelay({ NODE_ENV: "production" });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "" }
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Origin not allowed", code: "forbidden" });
  } finally {
    await relay.close();
  }
});

test("cookie-authenticated browser mutations require an allowed Origin", async () => {
  const relay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com"
  });
  try {
    const missingOrigin = await fetch(`${relay.baseUrl}/auth/logout`, {
      method: "POST",
      headers: {
        cookie: "multaiplayer_session=browser-session",
        "sec-fetch-site": "cross-site"
      }
    });
    assert.equal(missingOrigin.status, 403);
    assert.deepEqual(await missingOrigin.json(), {
      error: "Browser mutations require an allowed Origin.",
      code: "forbidden"
    });

    const allowedOrigin = await fetch(`${relay.baseUrl}/auth/logout`, {
      method: "POST",
      headers: {
        cookie: "multaiplayer_session=browser-session",
        origin: "https://multaiplayer.com",
        "sec-fetch-site": "cross-site"
      }
    });
    assert.equal(allowedOrigin.status, 200);
  } finally {
    await relay.close();
  }
});

test("cookie-authenticated native mutations may omit browser-only request headers", async () => {
  const relay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/logout`, {
      method: "POST",
      headers: { cookie: "multaiplayer_session=native-session" }
    });
    assert.equal(response.status, 200);
  } finally {
    await relay.close();
  }
});

test("CSRF protection does not turn unauthenticated mutation endpoints into an Origin oracle", async () => {
  const relay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/logout`, {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" }
    });
    assert.equal(response.status, 200);
  } finally {
    await relay.close();
  }
});
