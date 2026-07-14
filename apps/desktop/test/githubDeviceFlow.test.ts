import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deleteHostedAccount,
  HostedAccountDeletionIndeterminateError,
  githubDevicePollDelayMs,
  nextGitHubDevicePollIntervalSeconds,
  pollGitHubDeviceFlow,
  recheckHostedAccountDeletion,
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

test("hosted account deletion sends exact confirmation and preserves typed blockers", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | null = null;
  try {
    globalThis.fetch = async (input, init) => {
      request = { input: String(input), init };
      return new Response(
        JSON.stringify({
          error: "Transfer ownership first.",
          code: "account_deletion_blocked",
          blockers: {
            ownedTeams: [{ id: "team-one", name: "One" }],
            hostedRooms: [{ id: "room-one", name: "One", teamId: "team-one" }]
          }
        }),
        { status: 409, headers: { "content-type": "application/json" } }
      );
    };
    assert.deepEqual(await deleteHostedAccount(), {
      status: "blocked",
      blockers: {
        ownedTeams: [{ id: "team-one", name: "One" }],
        hostedRooms: [{ id: "room-one", name: "One", teamId: "team-one" }]
      }
    });
    assert.equal(request?.input, "https://relay.example/auth/account");
    assert.equal(request?.init?.method, "DELETE");
    assert.equal(request?.init?.credentials, "include");
    assert.equal(request?.init?.body, JSON.stringify({ confirmation: "delete my account" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted account deletion treats a lost response plus signed-out session as indeterminate", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("response lost");
      return new Response(JSON.stringify({ error: "Not signed in", code: "authentication_required" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });
    };
    const result = await deleteHostedAccount();
    assert.deepEqual(result, { status: "indeterminate", signedOut: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted account deletion reports an indeterminate result when both deletion and status responses are lost", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError("network unavailable");
    };
    const error = await deleteHostedAccount().catch((caught: unknown) => caught);
    assert.ok(error instanceof HostedAccountDeletionIndeterminateError);
    assert.match(error.message, /could not be verified/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted account deletion preserves its transport failure when the relay still authenticates the user", async () => {
  const originalFetch = globalThis.fetch;
  const transportFailure = new TypeError("response lost");
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) throw transportFailure;
      return new Response(JSON.stringify({ user: { id: "github:still-here", login: "still-here" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    assert.equal(await deleteHostedAccount().catch((caught: unknown) => caught), transportFailure);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted account deletion recheck distinguishes a live session from ambiguous sign-out", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ user: { id: "user-one", login: "one" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    assert.deepEqual(await recheckHostedAccountDeletion(), {
      status: "signed_in",
      user: { id: "user-one", login: "one" }
    });

    globalThis.fetch = async () => new Response(null, { status: 401 });
    assert.deepEqual(await recheckHostedAccountDeletion(), { status: "signed_out_or_deleted" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
