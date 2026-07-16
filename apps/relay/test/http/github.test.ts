import { test } from "node:test";
import {
  assert,
  join,
  mkdtemp,
  readFile,
  rm,
  startRelay,
  tmpdir,
  waitForStoredState,
  writeFile
} from "../support/relay.js";

test("relay advertises native OAuth configuration without a secret", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com,tauri://localhost"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      provider: "github",
      configured: true,
      scopes: ["read:user", "repo"],
      mutationsRequireAuth: true,
      allowedOrigins: ["https://multaiplayer.com", "tauri://localhost"],
      sessionPersistence: "identity_only",
      accountDeletion: "external_ledger_protected"
    });
  } finally {
    await relay.close();
  }
});

test("primary-only self-hosts expose account deletion without claiming backup restore protection", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_DELETION_PROTECTION: "primary_only",
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false"
  });
  try {
    const config = (await (await fetch(`${relay.baseUrl}/auth/config`)).json()) as { accountDeletion: string };
    assert.equal(config.accountDeletion, "primary_store_only");
  } finally {
    await relay.close();
  }
});

test("relay removes device flow and GitHub proxy routes", async () => {
  const relay = await startRelay({});
  try {
    for (const path of [
      "/auth/github/device/start",
      "/auth/github/device/poll",
      "/github/pulls",
      "/github/actions/runs"
    ]) {
      const response = await fetch(`${relay.baseUrl}${path}`, { method: path.includes("actions") ? "GET" : "POST" });
      assert.equal(response.status, 404, path);
    }
  } finally {
    await relay.close();
  }
});

test("verify rejects missing, oversized, and control-character credentials before GitHub", async () => {
  const relay = await startRelay({});
  try {
    for (const access_token of [undefined, "x".repeat(8193), "token\nvalue"]) {
      const response = await fetch(`${relay.baseUrl}/auth/github/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(access_token === undefined ? {} : { access_token })
      });
      assert.equal(response.status, 400);
    }
  } finally {
    await relay.close();
  }
});

test("verify binds identity, discards the token, and persists identity-only sessions", async () => {
  const token = "ghp_RELAY_TOKEN_MUST_NEVER_PERSIST_0123456789";
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-github-verify-test-"));
  const mockPath = join(tempDir, "mock-github-fetch.mjs");
  await writeFile(
    mockPath,
    `
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  if (String(input) === "https://api.github.com/user") {
    if (init.headers.authorization !== "Bearer ${token}") return Response.json({}, { status: 401 });
    return Response.json({ id: 42, login: "octocat", name: "Octo Cat", avatar_url: "https://avatars.githubusercontent.com/u/42" });
  }
  return nativeFetch(input, init);
};
`,
    "utf8"
  );
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${mockPath}`.trim()
  });
  let restarted: Awaited<ReturnType<typeof startRelay>> | null = null;
  try {
    const verified = await fetch(`${relay.baseUrl}/auth/github/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token: token })
    });
    assert.equal(verified.status, 200);
    assert.deepEqual(await verified.json(), {
      user: {
        id: "github:42",
        login: "octocat",
        name: "Octo Cat",
        avatarUrl: "https://avatars.githubusercontent.com/u/42"
      }
    });
    const cookie = verified.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const stored = await waitForStoredState(relay.dataPath, (state) => state.authSessions?.length === 1);
    const serialized = JSON.stringify(stored);
    assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes("accessToken"), false);
    assert.equal(serialized.includes("encryptedAccessToken"), false);
    for (const path of [relay.dataPath, `${relay.dataPath}-wal`, `${relay.dataPath}-shm`]) {
      const bytes = await readFile(path).catch(() => Buffer.alloc(0));
      assert.equal(bytes.includes(Buffer.from(token)), false, path);
    }
    await relay.close({ preserveData: true });
    restarted = await startRelay({ MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" }, undefined, relay.dataPath);
    const me = await fetch(`${restarted.baseUrl}/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, "github:42");
  } finally {
    if (restarted) await restarted.close();
    else await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify denies an operator-restricted identity with a stable error code", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-restricted-github-test-"));
  const mockPath = join(tempDir, "mock-github-fetch.mjs");
  await writeFile(
    mockPath,
    `
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) =>
  String(input) === "https://api.github.com/user"
    ? Response.json({ id: 42, login: "octocat" })
    : nativeFetch(input, init);
`,
    "utf8"
  );
  const relay = await startRelay(
    {
      MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${mockPath}`.trim()
    },
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [],
      rooms: [],
      invites: [],
      teamMembers: [],
      encryptedBacklog: [],
      mlsBacklog: [],
      accountRestrictions: [{ userId: "github:42", reasonCode: "abuse", createdAt: new Date().toISOString() }]
    }
  );
  try {
    const response = await fetch(`${relay.baseUrl}/auth/github/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token: "bounded-test-token" })
    });
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { code: string }).code, "account_restricted");
  } finally {
    await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
