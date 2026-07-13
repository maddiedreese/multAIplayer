import { test } from "node:test";
import { assert, createDebugSession, join, mkdtemp, rm, startRelay, tmpdir, writeFile } from "../support/relay.js";

test("relay reports configured GitHub OAuth scopes", async () => {
  const relay = await startRelay({
    GITHUB_OAUTH_SCOPES: "read:user,repo workflow",
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com,tauri://localhost",
    MULTAIPLAYER_RELAY_SESSION_SECRET: "test-session-secret-with-at-least-32-characters"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      scopes: string[];
      mutationsRequireAuth: boolean;
      allowedOrigins: string[];
      sessionPersistence: string;
    };
    assert.deepEqual(body.scopes, ["read:user", "repo", "workflow"]);
    assert.equal(body.mutationsRequireAuth, true);
    assert.deepEqual(body.allowedOrigins, ["https://multaiplayer.com", "tauri://localhost"]);
    assert.equal(body.sessionPersistence, "encrypted");
  } finally {
    await relay.close();
  }
});

test("relay bounds GitHub device-code polling input", async () => {
  const relay = await startRelay({ GITHUB_CLIENT_ID: "test-client-id" });
  try {
    const missing = await fetch(`${relay.baseUrl}/auth/github/device/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(missing.status, 400);

    const oversized = await fetch(`${relay.baseUrl}/auth/github/device/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: "x".repeat(257) })
    });
    assert.equal(oversized.status, 400);

    const controlCharacter = await fetch(`${relay.baseUrl}/auth/github/device/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: "device\ncode" })
    });
    assert.equal(controlCharacter.status, 400);
  } finally {
    await relay.close();
  }
});

test("relay distinguishes pending and slowdown device states from terminal GitHub errors", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-github-device-test-"));
  const mockPath = join(tempDir, "mock-github-device-fetch.mjs");
  await writeFile(
    mockPath,
    `
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  if (String(input) === "https://github.com/login/oauth/access_token") {
    const deviceCode = JSON.parse(String(init.body)).device_code;
    return Response.json({ error: deviceCode });
  }
  return nativeFetch(input, init);
};
`,
    "utf8"
  );
  const relay = await startRelay({
    GITHUB_CLIENT_ID: "test-client-id",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${mockPath}`.trim()
  });
  try {
    const poll = (deviceCode: string) =>
      fetch(`${relay.baseUrl}/auth/github/device/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode })
      });

    const pending = await poll("authorization_pending");
    assert.equal(pending.status, 202);
    assert.deepEqual(await pending.json(), { status: "pending" });

    const slowDown = await poll("slow_down");
    assert.equal(slowDown.status, 202);
    assert.deepEqual(await slowDown.json(), { status: "slow_down", retryAfterSeconds: 5 });

    const denied = await poll("access_denied");
    assert.equal(denied.status, 400);
    assert.deepEqual(await denied.json(), { error: "GitHub sign-in was denied.", code: "invalid_request" });

    const expired = await poll("expired_token");
    assert.equal(expired.status, 400);
    assert.deepEqual(await expired.json(), {
      error: "The GitHub sign-in code expired. Start sign-in again.",
      code: "invalid_request"
    });

    const unknown = await poll("unexpected_error");
    assert.equal(unknown.status, 502);
    assert.deepEqual(await unknown.json(), {
      error: "GitHub did not complete sign-in.",
      code: "upstream_unavailable"
    });
  } finally {
    await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("relay validates GitHub PR and Actions inputs before proxying", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");

    const pullResponse = await fetch(`${relay.baseUrl}/github/pulls`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        owner: "maddiedreese/bad",
        repo: "multAIplayer",
        title: "Ship it",
        body: "",
        head: "codex/branch",
        base: "main",
        draft: true
      })
    });
    assert.equal(pullResponse.status, 400);
    assert.match(await pullResponse.text(), /GitHub owner/);

    const actionsResponse = await fetch(
      `${relay.baseUrl}/github/actions/runs?owner=maddiedreese&repo=multAIplayer&branch=bad%20branch`,
      {
        headers: { cookie }
      }
    );
    assert.equal(actionsResponse.status, 400);
    assert.match(await actionsResponse.text(), /Unsafe GitHub branch name/);
  } finally {
    await relay.close();
  }
});

test("relay normalizes GitHub proxy responses before returning them", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-github-proxy-test-"));
  const mockPath = join(tempDir, "mock-github-fetch.mjs");
  await writeFile(
    mockPath,
    `
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes("https://api.github.com/repos/") && url.endsWith("/pulls")) {
    if (url.includes("/repos/maddiedreese/error/pulls")) {
      return new Response(JSON.stringify({
        message: "x".repeat(20000),
        access_token: "should-never-be-relayed"
      }), { status: 422, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: 123,
      number: 42,
      html_url: "https://github.com/maddiedreese/multAIplayer/pull/42",
      title: "Ship it",
      body: "should-not-be-relayed",
      token: "should-not-be-relayed"
    }), { status: 201, headers: { "content-type": "application/json" } });
  }
  if (url.includes("https://api.github.com/repos/") && url.includes("/actions/runs")) {
    return new Response(JSON.stringify({
      total_count: 2,
      workflow_runs: [
        {
          id: 456,
          name: "CI",
          display_title: "Harden proxy",
          run_number: 7,
          workflow_id: 8,
          status: "completed",
          conclusion: "success",
          head_branch: "codex/security-relay-hardening",
          head_sha: "abc123",
          event: "push",
          html_url: "https://github.com/maddiedreese/multAIplayer/actions/runs/456",
          created_at: "2026-07-05T00:00:00Z",
          updated_at: "2026-07-05T00:01:00Z",
          access_token: "should-not-be-relayed"
        },
        {
          id: 789,
          name: "x".repeat(20000),
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/maddiedreese/multAIplayer/actions/runs/789",
          created_at: "2026-07-05T00:00:00Z",
          updated_at: "2026-07-05T00:01:00Z"
        }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return nativeFetch(input, init);
};
`,
    "utf8"
  );

  const relay = await startRelay({
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${mockPath}`.trim()
  });
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");

    const pullResponse = await fetch(`${relay.baseUrl}/github/pulls`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        owner: "maddiedreese",
        repo: "multAIplayer",
        title: "Ship it",
        body: "",
        head: "codex/branch",
        base: "main",
        draft: true
      })
    });
    assert.equal(pullResponse.status, 201);
    assert.deepEqual(await pullResponse.json(), {
      id: 123,
      number: 42,
      url: "https://github.com/maddiedreese/multAIplayer/pull/42",
      title: "Ship it"
    });

    const errorResponse = await fetch(`${relay.baseUrl}/github/pulls`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        owner: "maddiedreese",
        repo: "error",
        title: "Ship it",
        body: "",
        head: "codex/branch",
        base: "main",
        draft: true
      })
    });
    assert.equal(errorResponse.status, 422);
    assert.deepEqual(await errorResponse.json(), { error: "GitHub request failed.", code: "upstream_unavailable" });

    const actionsResponse = await fetch(
      `${relay.baseUrl}/github/actions/runs?owner=maddiedreese&repo=multAIplayer&branch=codex%2Fbranch`,
      {
        headers: { cookie }
      }
    );
    assert.equal(actionsResponse.status, 200);
    assert.deepEqual(await actionsResponse.json(), {
      totalCount: 2,
      runs: [
        {
          id: 456,
          name: "CI",
          displayTitle: "Harden proxy",
          runNumber: 7,
          workflowId: 8,
          status: "completed",
          conclusion: "success",
          branch: "codex/security-relay-hardening",
          headSha: "abc123",
          event: "push",
          url: "https://github.com/maddiedreese/multAIplayer/actions/runs/456",
          createdAt: "2026-07-05T00:00:00Z",
          updatedAt: "2026-07-05T00:01:00Z"
        }
      ]
    });
  } finally {
    await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
