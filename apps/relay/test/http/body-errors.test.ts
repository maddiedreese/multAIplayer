import test from "node:test";
import { assert, startRelay } from "../support/relay.js";

test("relay returns typed JSON for malformed and oversized JSON request bodies", async () => {
  const relay = await startRelay({ MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES: "1" });
  try {
    const malformed = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"name":'
    });
    assert.equal(malformed.status, 400);
    assert.match(malformed.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await malformed.json(), {
      error: "JSON request body is malformed.",
      code: "invalid_request"
    });

    const oversized = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(1_100_000) })
    });
    assert.equal(oversized.status, 413);
    assert.match(oversized.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await oversized.json(), {
      error: "JSON request body exceeds the relay limit.",
      code: "payload_too_large"
    });
  } finally {
    await relay.close();
  }
});

test("rate limiting runs before JSON parsing and unknown routes remain typed", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_MUTATION: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000"
  });
  try {
    const first = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "One" })
    });
    assert.equal(first.status, 201);
    const rejectedBeforeParsing = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"name":'
    });
    assert.equal(rejectedBeforeParsing.status, 429);
    assert.equal(rejectedBeforeParsing.headers.get("x-powered-by"), null);

    const missing = await fetch(`${relay.baseUrl}/definitely-not-a-route`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Route not found.", code: "not_found" });
    assert.equal(missing.headers.get("x-powered-by"), null);
  } finally {
    await relay.close();
  }
});
