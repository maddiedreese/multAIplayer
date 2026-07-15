import { test } from "node:test";
import { chmod, mkdir, rm } from "node:fs/promises";
import {
  WebSocket,
  Database,
  assert,
  createDebugSession,
  join,
  randomUUID,
  onceOpen,
  patchHostStatus,
  patchRoomSettings,
  postJsonStatus,
  startRelay,
  tmpdir,
  waitForError,
  waitForStoredState,
  writeFile,
  type RelayHarness,
  type StoredRelayStateFixture
} from "../support/relay.js";

test("relay can require auth for workspace mutations", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  try {
    assert.equal(await postJsonStatus(relay.baseUrl, "/teams", { name: "Private Team" }), 401);
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/devices", {
        userId: "github:maddiedreese",
        deviceId: "device-private-123",
        displayName: "Maddie",
        publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
        publicKeyFingerprint: "sha256:private-device"
      }),
      401
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Private Room",
        projectPath: "/tmp/multaiplayer"
      }),
      401
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/invites", {
        teamId: "team-core",
        roomId: "room-desktop"
      }),
      401
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/attachment-blobs", {
        teamId: "team-core",
        roomId: "room-desktop",
        name: "private.txt",
        type: "text/plain",
        size: 4,
        payload: {
          algorithm: "AES-GCM-256",
          nonce: "test-nonce",
          ciphertext: "test-ciphertext"
        }
      }),
      401
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, {
        host: "Maddie",
        hostUserId: "github:maddiedreese",
        hostStatus: "handoff"
      }),
      401
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        codexModel: "gpt-5.4-thinking"
      }),
      401
    );
  } finally {
    await relay.close();
  }
});

test("relay treats malformed session cookies as unauthenticated", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  let socket: WebSocket | null = null;
  try {
    const validCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const validMe = await fetch(`${relay.baseUrl}/auth/me`, {
      headers: { cookie: validCookie }
    });
    assert.equal(validMe.status, 200);

    const me = await fetch(`${relay.baseUrl}/auth/me`, {
      headers: { cookie: "multaiplayer_session=%E0%A4%A" }
    });
    assert.equal(me.status, 401);

    const oversized = await fetch(`${relay.baseUrl}/auth/me`, {
      headers: { cookie: `multaiplayer_session=${"x".repeat(500)}` }
    });
    assert.equal(oversized.status, 401);

    const teams = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: "multaiplayer_session=%E0%A4%A" }
    });
    assert.equal(teams.status, 401);

    socket = new WebSocket(relay.wsUrl, {
      headers: { cookie: "multaiplayer_session=%E0%A4%A" }
    });
    await onceOpen(socket);
    const error = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:maddiedreese",
        deviceId: "device-bad-cookie"
      })
    );
    assert.match(await error, /Sign in and use a valid invite/);
    socket.close();

    socket = new WebSocket(relay.wsUrl, {
      headers: { cookie: `multaiplayer_session=${"x".repeat(500)}` }
    });
    await onceOpen(socket);
    const oversizedCookieError = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:maddiedreese",
        deviceId: "device-oversized-cookie"
      })
    );
    assert.match(await oversizedCookieError, /Sign in and use a valid invite/);
  } finally {
    socket?.close();
    await relay.close();
  }
});

test("relay expires server-side auth sessions independently of cookies", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  try {
    const expiredCookie = await createDebugSession(relay.baseUrl, "github:expired", "expired", -1);

    const me = await fetch(`${relay.baseUrl}/auth/me`, {
      headers: { cookie: expiredCookie }
    });
    assert.equal(me.status, 401);

    const teams = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: expiredCookie }
    });
    assert.equal(teams.status, 401);
  } finally {
    await relay.close();
  }
});

test("relay bounds debug auth session metadata before storing", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  try {
    const oversizedLogin = await fetch(`${relay.baseUrl}/debug/auth-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "github:debug", login: "x".repeat(121) })
    });
    assert.equal(oversizedLogin.status, 400);

    const controlName = await fetch(`${relay.baseUrl}/debug/auth-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "github:debug", login: "debug", name: "bad\nname" })
    });
    assert.equal(controlName.status, 400);

    const validCookie = await createDebugSession(relay.baseUrl, "github:debug", "debug");
    const me = await fetch(`${relay.baseUrl}/auth/me`, {
      headers: { cookie: validCookie }
    });
    assert.equal(me.status, 200);
  } finally {
    await relay.close();
  }
});

test("relay logout clears the session cookie with matching attributes", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:logout", "logout");
    const response = await fetch(`${relay.baseUrl}/auth/logout`, {
      method: "POST",
      headers: { cookie }
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get("set-cookie");
    assert.ok(setCookie);
    assert.match(setCookie, /^multaiplayer_session=;/);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);

    const me = await fetch(`${relay.baseUrl}/auth/me`, {
      headers: { cookie }
    });
    assert.equal(me.status, 401);
  } finally {
    await relay.close();
  }
});

test("hosted account deletion requires explicit confirmation and reports ownership blockers", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  try {
    const unauthenticated = await fetch(`${relay.baseUrl}/auth/account`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "delete my account" })
    });
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).code, "authentication_required");

    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const unconfirmed = await fetch(`${relay.baseUrl}/auth/account`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmation: "delete" })
    });
    assert.equal(unconfirmed.status, 400);
    assert.equal((await unconfirmed.json()).code, "invalid_request");

    const blocked = await fetch(`${relay.baseUrl}/auth/account`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmation: "delete my account" })
    });
    assert.equal(blocked.status, 409);
    assert.deepEqual(await blocked.json(), {
      error: "Transfer or delete every owned team and hand off every hosted room before deleting your hosted data.",
      code: "account_deletion_blocked",
      blockers: {
        ownedTeams: [{ id: "team-core", name: "Core Team" }],
        hostedRooms: [{ id: "room-desktop", name: "Desktop app", teamId: "team-core" }]
      }
    });
    assert.equal((await fetch(`${relay.baseUrl}/auth/me`, { headers: { cookie } })).status, 200);
  } finally {
    await relay.close();
  }
});

test("hosted account deletion removes identity-owned relay data durably and retains shared records", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true"
  });
  let restarted = null as Awaited<ReturnType<typeof startRelay>> | null;
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:tester", "tester");
    const response = await fetch(`${relay.baseUrl}/auth/account`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmation: "delete my account" })
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      ok: boolean;
      deleted: { authSessions: number; teamMemberships: number };
      retainedSharedData: string[];
    };
    assert.equal(body.ok, true);
    assert.equal(body.deleted.authSessions, 1);
    assert.equal(body.deleted.teamMemberships, 1);
    assert.deepEqual(body.retainedSharedData, [
      "team_and_room_records",
      "mls_ciphertext_and_routing_metadata",
      "encrypted_attachment_blobs",
      "accepted_message_receipts"
    ]);
    assert.match(response.headers.get("set-cookie") ?? "", /^multaiplayer_session=;/);
    assert.equal((await fetch(`${relay.baseUrl}/auth/me`, { headers: { cookie } })).status, 401);

    const stored = await waitForStoredState(
      relay.dataPath,
      (state) =>
        Array.isArray(state.authSessions) &&
        state.authSessions.length === 0 &&
        Array.isArray(state.teamMembers) &&
        !JSON.stringify(state.teamMembers).includes("github:tester")
    );
    assert.equal(JSON.stringify(stored.authSessions), "[]");
    assert.match(JSON.stringify(stored.teams), /team-core/);
    assert.match(JSON.stringify(stored.rooms), /room-desktop/);

    await relay.close({ preserveData: true });
    restarted = await startRelay(
      {
        MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true"
      },
      undefined,
      relay.dataPath
    );
    const newCookie = await createDebugSession(restarted.baseUrl, "github:tester", "tester");
    const workspace = await fetch(`${restarted.baseUrl}/teams`, { headers: { cookie: newCookie } });
    assert.equal(workspace.status, 401);
  } finally {
    if (restarted) await restarted.close();
    else await relay.close();
  }
});

test(
  "hosted account deletion denies authentication after the ledger commits even when primary persistence fails",
  { skip: process.platform === "win32" || process.geteuid?.() === 0 },
  async () => {
    const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
    const cookie = await createDebugSession(relay.baseUrl, "github:tester", "tester");
    try {
      await chmod(relay.tempDir, 0o500);
      const failed = await fetch(`${relay.baseUrl}/auth/account`, {
        method: "DELETE",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ confirmation: "delete my account" })
      });
      assert.equal(failed.status, 202);
      assert.equal((await failed.json()).status, "pending");
      assert.equal((await fetch(`${relay.baseUrl}/auth/me`, { headers: { cookie } })).status, 401);
    } finally {
      await chmod(relay.tempDir, 0o700).catch(() => undefined);
      await relay.close();
    }
  }
);

test(
  "hosted account deletion leaves identity data and authentication intact when the external ledger fails",
  { skip: process.platform === "win32" || process.geteuid?.() === 0 },
  async () => {
    const ledgerPath = join(tmpdir(), `multaiplayer-unwritable-ledger-${randomUUID()}`);
    await mkdir(ledgerPath, { recursive: true });
    const relay = await startRelay({
      MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
      MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH: ledgerPath
    });
    const cookie = await createDebugSession(relay.baseUrl, "github:tester", "tester");
    try {
      await chmod(ledgerPath, 0o500);
      const failed = await fetch(`${relay.baseUrl}/auth/account`, {
        method: "DELETE",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ confirmation: "delete my account" })
      });
      assert.equal(failed.status, 503);
      assert.equal((await failed.json()).code, "persistence_unavailable");
      assert.equal((await fetch(`${relay.baseUrl}/auth/me`, { headers: { cookie } })).status, 200);
    } finally {
      await chmod(ledgerPath, 0o700).catch(() => undefined);
      await relay.close();
      await rm(ledgerPath, { recursive: true, force: true });
    }
  }
);

test("relay hashes persisted session ids, migrates legacy ids, and purges legacy token fields", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  let restarted: RelayHarness | null = null;
  let closed = false;
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:persisted", "persisted");
    const sessionId = cookie.replace(/^multaiplayer_session=([^;]+).*$/, "$1");
    const stored = await waitForStoredState(relay.dataPath, (state) => state.authSessions?.length === 1);
    const serialized = JSON.stringify(stored);
    assert.doesNotMatch(serialized, new RegExp(sessionId));
    assert.doesNotMatch(serialized, /debug-token|accessToken|encryptedAccessToken/);
    assert.match(String((stored.authSessions![0] as Record<string, unknown>).sessionIdHash), /^[a-f0-9]{64}$/);
    await relay.close({ preserveData: true });
    closed = true;
    const legacy = stored.authSessions![0] as StoredRelayStateFixture["authSessions"][number] & Record<string, unknown>;
    delete legacy.sessionIdHash;
    legacy.sessionId = sessionId;
    legacy.accessToken = "legacy-secret";
    legacy.encryptedAccessToken = {
      algorithm: "AES-GCM-256",
      nonce: "legacy",
      ciphertext: "legacy-secret",
      tag: "legacy"
    };
    await writeFile(relay.dataPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    restarted = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" }, undefined, relay.dataPath);
    assert.equal((await fetch(`${restarted.baseUrl}/auth/me`, { headers: { cookie } })).status, 200);
    const rewritten = await waitForStoredState(restarted.dataPath, (state) => state.authSessions?.length === 1);
    assert.doesNotMatch(
      JSON.stringify(rewritten),
      new RegExp(`${sessionId}|legacy-secret|accessToken|encryptedAccessToken`)
    );
    assert.match(String((rewritten.authSessions![0] as Record<string, unknown>).sessionIdHash), /^[a-f0-9]{64}$/);
    const logout = await fetch(`${restarted.baseUrl}/auth/logout`, { method: "POST", headers: { cookie } });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(`${restarted.baseUrl}/auth/me`, { headers: { cookie } })).status, 401);
    await waitForStoredState(restarted.dataPath, (state) => state.authSessions?.length === 0);
  } finally {
    if (restarted) await restarted.close();
    else if (!closed) await relay.close();
  }
});

test("relay migrates plaintext ids and purges legacy token fields from normalized SQLite session rows", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
    MULTAIPLAYER_RELAY_STORAGE: "sqlite"
  });
  let restarted: RelayHarness | null = null;
  let closed = false;
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:sqlite-persisted", "sqlite-persisted");
    const sessionId = cookie.replace(/^multaiplayer_session=([^;]+).*$/, "$1");
    await relay.close({ preserveData: true });
    closed = true;
    const db = new Database(relay.dataPath);
    const row = db.prepare("select session_id, data_json from relay_auth_sessions limit 1").get() as {
      session_id: string;
      data_json: string;
    };
    assert.match(row.session_id, /^[a-f0-9]{64}$/);
    assert.notEqual(row.session_id, sessionId);
    assert.doesNotMatch(row.data_json, new RegExp(sessionId));
    const legacy = JSON.parse(row.data_json) as Record<string, unknown>;
    delete legacy.sessionIdHash;
    legacy.sessionId = sessionId;
    legacy.accessToken = "sqlite-legacy-secret";
    legacy.encryptedAccessToken = { ciphertext: "sqlite-legacy-secret" };
    db.prepare("update relay_auth_sessions set session_id = ?, data_json = ? where session_id = ?").run(
      sessionId,
      JSON.stringify(legacy),
      row.session_id
    );
    db.close();
    restarted = await startRelay(
      { MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true", MULTAIPLAYER_RELAY_STORAGE: "sqlite" },
      undefined,
      relay.dataPath
    );
    assert.equal((await fetch(`${restarted.baseUrl}/auth/me`, { headers: { cookie } })).status, 200);
    const verifyDb = new Database(restarted.dataPath, { readonly: true });
    const rewritten = verifyDb.prepare("select session_id, data_json from relay_auth_sessions limit 1").get() as {
      session_id: string;
      data_json: string;
    };
    verifyDb.close();
    assert.match(rewritten.session_id, /^[a-f0-9]{64}$/);
    assert.notEqual(rewritten.session_id, sessionId);
    assert.doesNotMatch(
      rewritten.data_json,
      new RegExp(`${sessionId}|sqlite-legacy-secret|accessToken|encryptedAccessToken`)
    );
  } finally {
    if (restarted) await restarted.close();
    else if (!closed) await relay.close();
  }
});

test("relay requires auth in production while native GitHub OAuth remains available", async () => {
  const relay = await startRelay({ NODE_ENV: "production" });
  try {
    const config = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(config.status, 200);
    const configBody = (await config.json()) as { configured: boolean; mutationsRequireAuth: boolean };
    assert.equal(configBody.configured, true);
    assert.equal(configBody.mutationsRequireAuth, true);

    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 401);
  } finally {
    await relay.close();
  }
});
