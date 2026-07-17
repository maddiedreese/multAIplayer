import { test } from "node:test";
import { assert, startRelay } from "../support/relay.js";
import { createRelayRequestGuards } from "../../src/http/middleware.js";
import { createRelayMetrics } from "../../src/observability.js";
import { hashAuthSessionId } from "../../src/auth/session.js";
import type { TokenBucketRecord } from "../../src/state.js";

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

test("rotating caller-supplied session cookies cannot bypass the mandatory IP bucket", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_READ: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000"
  });
  try {
    const first = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: "multaiplayer_session=attacker-selected-cookie-one" }
    });
    assert.equal(first.status, 200);
    const rotated = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: "multaiplayer_session=attacker-selected-cookie-two" }
    });
    assert.equal(rotated.status, 429);
  } finally {
    await relay.close();
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
    MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS: "true"
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

test("trusted proxy rate limits prefer the provider-authenticated real IP header", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_READ: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000",
    MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS: "true"
  });
  try {
    const first = await fetch(`${relay.baseUrl}/teams`, {
      headers: { "x-real-ip": "203.0.113.40", "x-forwarded-for": "198.51.100.1" }
    });
    assert.equal(first.status, 200);

    const spoofedForwardedFor = await fetch(`${relay.baseUrl}/teams`, {
      headers: { "x-real-ip": "203.0.113.40", "x-forwarded-for": "198.51.100.2" }
    });
    assert.equal(spoofedForwardedFor.status, 429);

    const secondRealIp = await fetch(`${relay.baseUrl}/teams`, {
      headers: { "x-real-ip": "203.0.113.41", "x-forwarded-for": "198.51.100.1" }
    });
    assert.equal(secondRealIp.status, 200);
  } finally {
    await relay.close();
  }
});

test("token buckets refill continuously and do not permit a fixed-window boundary burst", () => {
  const records = new Map<string, TokenBucketRecord>();
  let now = 99;
  const guards = createRelayRequestGuards({
    rateLimitsEnabled: true,
    rateLimitWindowMs: 100,
    rateLimitCaps: { auth: 2, read: 2, mutation: 2, attachment: 2, websocket: 2, websocketConnect: 2 },
    rateLimitStore: records,
    trustProxyHeaders: false,
    metrics: createRelayMetrics(),
    now: () => now,
    normalizeSessionId: (value) => (typeof value === "string" ? value : "")
  });
  assert.equal(guards.consumeRateLimit("read", "session:boundary").allowed, true);
  assert.equal(guards.consumeRateLimit("read", "session:boundary").allowed, true);
  now = 100;
  assert.equal(guards.consumeRateLimit("read", "session:boundary").allowed, false);
  now = 149;
  assert.equal(guards.consumeRateLimit("read", "session:boundary").allowed, true);
});

test("rate-limit identifiers prune after two idle refill windows without scanning on every request", () => {
  class CountingMap extends Map<string, TokenBucketRecord> {
    entryScans = 0;
    override entries(): MapIterator<[string, TokenBucketRecord]> {
      this.entryScans += 1;
      return super.entries();
    }
    override [Symbol.iterator](): MapIterator<[string, TokenBucketRecord]> {
      return this.entries();
    }
  }
  const records = new CountingMap([
    ["read:session:expired", { tokens: 0, updatedAt: 700, lastSeenAt: 799 }],
    ["read:session:live", { tokens: 0, updatedAt: 900, lastSeenAt: 900 }]
  ]);
  let now = 1_000;
  const guards = createRelayRequestGuards({
    rateLimitsEnabled: true,
    rateLimitWindowMs: 100,
    rateLimitCaps: { auth: 10, read: 10, mutation: 10, attachment: 10, websocket: 10, websocketConnect: 10 },
    rateLimitStore: records,
    trustProxyHeaders: false,
    metrics: createRelayMetrics(),
    now: () => now,
    normalizeSessionId: (value) => (typeof value === "string" ? value : "")
  });
  guards.consumeRateLimit("read", "session:first");
  assert.equal(records.has("read:session:expired"), false);
  assert.equal(records.entryScans, 1);
  guards.consumeRateLimit("read", "session:second");
  assert.equal(records.entryScans, 1, "a live window must not trigger another full scan");
  now = 1_100;
  guards.consumeRateLimit("read", "session:third");
  assert.equal(records.has("read:session:live"), false);
  assert.equal(records.entryScans, 2);
});

test("signed-in rate-limit keys contain only a digest of the bearer session", () => {
  const records = new Map<string, TokenBucketRecord>();
  const rawSession = "raw-session-cookie-that-must-not-be-retained";
  const guards = createRelayRequestGuards({
    rateLimitsEnabled: true,
    rateLimitWindowMs: 100,
    rateLimitCaps: { auth: 2, read: 2, mutation: 2, attachment: 2, websocket: 2, websocketConnect: 2 },
    rateLimitStore: records,
    trustProxyHeaders: false,
    metrics: createRelayMetrics(),
    normalizeSessionId: (value) => (typeof value === "string" ? value : ""),
    trustedSessionIdentity: (value) => (value === rawSession ? `session:${hashAuthSessionId(rawSession)}` : null)
  });
  const request = {
    headers: { cookie: `multaiplayer_session=${rawSession}` },
    socket: { remoteAddress: "127.0.0.1" }
  } as never;
  const identities = guards.clientRateLimitIdentitiesFromIncomingMessage(request);
  assert.deepEqual(identities, ["trusted-network:127.0.0.1", `session:${hashAuthSessionId(rawSession)}`]);
  for (const identity of identities) guards.consumeRateLimit("read", identity);
  assert.equal(
    [...records.keys()].some((key) => /^read:session:[a-f0-9]{64}$/.test(key)),
    true
  );
  assert.equal(
    [...records.keys()].some((key) => key.includes(rawSession)),
    false
  );

  const rotatedIdentities = guards.clientRateLimitIdentitiesFromIncomingMessage({
    headers: { cookie: "multaiplayer_session=untrusted-rotated-cookie" },
    socket: { remoteAddress: "127.0.0.1" }
  } as never);
  assert.deepEqual(rotatedIdentities, ["ip:127.0.0.1"]);
});

test("trusted sessions keep individual caps while sharing a higher bounded network cap", () => {
  const records = new Map<string, TokenBucketRecord>();
  const now = 1_000;
  const guards = createRelayRequestGuards({
    rateLimitsEnabled: true,
    rateLimitWindowMs: 60_000,
    trustedNetworkRateLimitMultiplier: 3,
    rateLimitCaps: { auth: 2, read: 2, mutation: 2, attachment: 2, websocket: 2, websocketConnect: 2 },
    rateLimitStore: records,
    trustProxyHeaders: false,
    metrics: createRelayMetrics(),
    now: () => now,
    normalizeSessionId: (value) => (typeof value === "string" ? value : ""),
    trustedSessionIdentity: (value) =>
      typeof value === "string" && value.startsWith("valid-") ? `session:${value}` : null
  });
  const consumeRequest = (sessionId: string, remoteAddress = "203.0.113.60") => {
    const identities = guards.clientRateLimitIdentitiesFromIncomingMessage({
      headers: { cookie: `multaiplayer_session=${sessionId}` },
      socket: { remoteAddress }
    } as never);
    return identities.every((identity) => guards.consumeRateLimit("read", identity).allowed);
  };

  assert.equal(consumeRequest("valid-single", "203.0.113.61"), true);
  assert.equal(consumeRequest("valid-single", "203.0.113.61"), true);
  assert.equal(consumeRequest("valid-single", "203.0.113.61"), false, "the strict session cap still wins");
  for (const sessionId of ["valid-a", "valid-a", "valid-b", "valid-b", "valid-c", "valid-c"]) {
    assert.equal(consumeRequest(sessionId), true);
  }
  assert.equal(
    consumeRequest("valid-d"),
    false,
    "a valid-session rotation must not bypass the bounded shared-network bucket"
  );
  assert.equal(records.get("read:session:valid-a")?.tokens, 0, "each trusted session keeps the strict base cap");
  const sharedNetworkTokens = records.get("read:trusted-network:203.0.113.60")?.tokens;
  assert.ok(
    sharedNetworkTokens !== undefined && sharedNetworkTokens >= 0 && sharedNetworkTokens < 1,
    "continuous refill remains below the next admissible request"
  );
});
