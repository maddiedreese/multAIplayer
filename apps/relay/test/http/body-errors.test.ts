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
