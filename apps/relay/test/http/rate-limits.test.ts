import { test } from "node:test";
import { assert, startRelay } from "../support/relay.js";

test("relay rate limits repeated HTTP reads and mutations", async () => {
  const readLimitedRelay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_READ: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000"
  });
  try {
    const headers = { "x-forwarded-for": "203.0.113.10" };
    const first = await fetch(`${readLimitedRelay.baseUrl}/teams`, { headers });
    assert.equal(first.status, 200);
    const second = await fetch(`${readLimitedRelay.baseUrl}/teams`, { headers });
    assert.equal(second.status, 429);
    assert.equal(second.headers.get("retry-after"), "60");
    assert.match(await second.text(), /Rate limit exceeded/);
  } finally {
    await readLimitedRelay.close();
  }

  const mutationLimitedRelay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_MUTATION: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000"
  });
  try {
    const headers = {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.11"
    };
    const first = await fetch(`${mutationLimitedRelay.baseUrl}/teams`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "One team" })
    });
    assert.equal(first.status, 201);
    const second = await fetch(`${mutationLimitedRelay.baseUrl}/teams`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Second team" })
    });
    assert.equal(second.status, 429);
  } finally {
    await mutationLimitedRelay.close();
  }
});

test("relay ignores forwarded IP headers for rate limits unless explicitly trusted", async () => {
  const directRelay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_READ: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000"
  });
  try {
    const first = await fetch(`${directRelay.baseUrl}/teams`, { headers: { "x-forwarded-for": "203.0.113.20" } });
    assert.equal(first.status, 200);
    const spoofedSecond = await fetch(`${directRelay.baseUrl}/teams`, {
      headers: { "x-forwarded-for": "203.0.113.21" }
    });
    assert.equal(spoofedSecond.status, 429);
  } finally {
    await directRelay.close();
  }

  const trustedProxyRelay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_READ: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000",
    MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS: "true",
    MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED: "true"
  });
  try {
    const first = await fetch(`${trustedProxyRelay.baseUrl}/teams`, { headers: { "x-forwarded-for": "203.0.113.30" } });
    assert.equal(first.status, 200);
    const secondIp = await fetch(`${trustedProxyRelay.baseUrl}/teams`, {
      headers: { "x-forwarded-for": "203.0.113.31" }
    });
    assert.equal(secondIp.status, 200);
    const repeatedSecondIp = await fetch(`${trustedProxyRelay.baseUrl}/teams`, {
      headers: { "x-forwarded-for": "203.0.113.31" }
    });
    assert.equal(repeatedSecondIp.status, 429);
  } finally {
    await trustedProxyRelay.close();
  }
});
