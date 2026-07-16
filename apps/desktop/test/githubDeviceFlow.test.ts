import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deleteHostedAccount,
  HostedAccountDeletionIndeterminateError,
  githubDevicePollDelayMs,
  logout,
  nextGitHubDevicePollIntervalSeconds,
  recheckHostedAccountDeletion,
  summarizeGitHubOAuthPurposes,
  type GitHubDevicePollResult
} from "../src/lib/identity/authClient";

test("GitHub OAuth copy separates identity from repository authority", () => {
  assert.deepEqual(summarizeGitHubOAuthPurposes(["read:user", "repo"]), {
    identity: "read:user — workspace identity",
    repositoryWorkflows: "repo — public and private repository workflows"
  });
  assert.deepEqual(summarizeGitHubOAuthPurposes(["read:user"]), {
    identity: "read:user — workspace identity",
    repositoryWorkflows: "No repository workflow scope"
  });
});

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

test("sign-out removes the native GitHub credential even when relay logout is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const relayFailure = new TypeError("relay unavailable");
  const invoked: string[] = [];
  try {
    globalThis.fetch = async () => {
      throw relayFailure;
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __TAURI_INTERNALS__: {
          invoke: async (command: string) => {
            invoked.push(command);
          }
        }
      }
    });

    assert.equal(await logout().catch((error: unknown) => error), relayFailure);
    assert.deepEqual(invoked, ["github_token_delete"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("sign-out reports both relay and credential-store failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const relayFailure = new TypeError("relay unavailable");
  const credentialFailure = { code: "storage_error", message: "credential store unavailable" };
  try {
    globalThis.fetch = async () => {
      throw relayFailure;
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __TAURI_INTERNALS__: {
          invoke: async () => {
            throw credentialFailure;
          }
        }
      }
    });

    const error = await logout().catch((caught: unknown) => caught);
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0], relayFailure);
    assert.equal((error.errors[1] as Error).message, credentialFailure.message);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
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

test("hosted account deletion preserves an accepted pending primary-cleanup result", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          status: "pending",
          deleted: null,
          retainedSharedData: ["team_and_room_records"]
        }),
        { status: 202, headers: { "content-type": "application/json" } }
      );
    assert.deepEqual(await deleteHostedAccount(), {
      status: "pending",
      retainedSharedData: ["team_and_room_records"]
    });
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
