import assert from "node:assert/strict";
import { test } from "node:test";
import {
  githubDevicePollDelayMs,
  nextGitHubDevicePollIntervalSeconds,
  pollGitHubDeviceFlow,
  startGitHubDeviceFlow,
  type GitHubDevicePollResult
} from "../src/lib/authClient";
import { RelayHttpError } from "../src/lib/httpResponse";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => JSON.stringify({ relayHttpUrl: "https://relay.example", relayWsUrl: "wss://relay.example" }),
    removeItem: () => undefined
  }
});

test("GitHub device polling preserves the interval while authorization is pending", () => {
  const pending: GitHubDevicePollResult = { status: "pending" };
  assert.equal(nextGitHubDevicePollIntervalSeconds(5, pending), 5);
});

test("GitHub device polling increases its interval when GitHub requests slowdown", () => {
  const slowDown: GitHubDevicePollResult = { status: "slow_down", retryAfterSeconds: 5 };
  assert.equal(nextGitHubDevicePollIntervalSeconds(5, slowDown), 10);
  assert.equal(nextGitHubDevicePollIntervalSeconds(10, slowDown), 15);
});

test("GitHub device polling never schedules beyond code expiry", () => {
  assert.equal(githubDevicePollDelayMs(5, 12_000, 10_000), 2_000);
  assert.equal(githubDevicePollDelayMs(5, 9_000, 10_000), 0);
});

test("GitHub device start preserves typed relay error codes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "GitHub OAuth is unavailable.", code: "upstream_unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" }
    });
  try {
    const error = await startGitHubDeviceFlow().catch((caught: unknown) => caught);
    assert.ok(error instanceof RelayHttpError);
    assert.equal(error.code, "upstream_unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub device start rejects an untrusted verification address before exposing the flow", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        device_code: "must-stay-private",
        user_code: "VISIBLE-CODE",
        verification_uri: "https://github.com.evil.test/login/device",
        expires_in: 900,
        interval: 5
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  try {
    const error = await startGitHubDeviceFlow().catch((caught: unknown) => caught);
    assert.ok(error instanceof Error);
    assert.equal(error.message, "GitHub returned an unsupported verification address.");
    assert.doesNotMatch(error.message, /must-stay-private|VISIBLE-CODE/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub device polling keeps 202 pending semantics and propagates terminal codes", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ status: "slow_down", retryAfterSeconds: 7 }), {
        status: 202,
        headers: { "content-type": "application/json" }
      });
    assert.deepEqual(await pollGitHubDeviceFlow("device-code"), { status: "slow_down", retryAfterSeconds: 7 });

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "The sign-in code expired.", code: "invalid_request" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    const error = await pollGitHubDeviceFlow("device-code").catch((caught: unknown) => caught);
    assert.ok(error instanceof RelayHttpError);
    assert.equal(error.code, "invalid_request");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
