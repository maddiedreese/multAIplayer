import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { WebSocket } from "ws";
import { createAccountRestrictionManager, isAccountRestricted } from "../src/auth/account-restrictions.js";
import { createRelayRoomSocketManager } from "../src/ws/rooms.js";
import { createRelayStore } from "../src/state.js";
import { createRelayPersistence } from "../src/persistence.js";
import { assert, startRelay } from "./support/relay.js";

const execFileAsync = promisify(execFile);

test("restricting an account durably evicts every live identity surface", async () => {
  const store = createRelayStore();
  const closed: Array<[number, string]> = [];
  const sent: unknown[] = [];
  const socket = {
    close(code: number, reason: string) {
      closed.push([code, reason]);
    }
  } as unknown as WebSocket;
  const allowedSocket = { close: () => assert.fail("unrelated account socket was closed") } as unknown as WebSocket;
  const roomSockets = new Map([["team:room" as const, new Set([socket, allowedSocket])]]);
  const teamSockets = new Map([["team", new Set([socket, allowedSocket])]]);
  const workspaceSockets = new Set([socket, allowedSocket]);
  store.sessions.set(socket, {
    socket,
    authSession: {
      sessionIdHash: "a".repeat(64),
      user: { id: "github:blocked", login: "blocked" },
      expiresAt: Date.now() + 60_000
    },
    rateClientId: "session:blocked",
    teamId: "team",
    roomId: "room",
    userId: "github:blocked",
    deviceId: "device",
    subscribedTeamIds: new Set(["team"]),
    workspaceSubscribed: true
  });
  store.sessions.set(allowedSocket, {
    socket: allowedSocket,
    authSession: {
      sessionIdHash: "b".repeat(64),
      user: { id: "github:allowed", login: "allowed" },
      expiresAt: Date.now() + 60_000
    },
    rateClientId: "session:allowed",
    teamId: "team",
    roomId: "room",
    userId: "github:allowed",
    deviceId: "allowed-device",
    subscribedTeamIds: new Set(["team"]),
    workspaceSubscribed: true
  });
  store.authSessions.set("a".repeat(64), store.sessions.get(socket)!.authSession!);
  store.authSessions.set("b".repeat(64), store.sessions.get(allowedSocket)!.authSession!);
  store.deviceSessions.set("device-token", {
    token: "device-token",
    userId: "github:blocked",
    deviceId: "device",
    expiresAt: Date.now() + 60_000
  });
  store.deviceSessions.set("allowed-token", {
    token: "allowed-token",
    userId: "github:allowed",
    deviceId: "allowed-device",
    expiresAt: Date.now() + 60_000
  });
  store.deviceChallenges.set("challenge", {
    userId: "github:blocked",
    deviceId: "device",
    expiresAt: Date.now() + 60_000
  });
  store.roomPresence.set(
    "team:room",
    new Map([
      [
        "device",
        { teamId: "team", roomId: "room", userId: "github:blocked", deviceId: "device", displayName: "Blocked" }
      ],
      [
        "allowed-device",
        {
          teamId: "team",
          roomId: "room",
          userId: "github:allowed",
          deviceId: "allowed-device",
          displayName: "Allowed"
        }
      ]
    ])
  );
  let saves = 0;
  const roomManager = createRelayRoomSocketManager({
    store,
    roomSockets,
    teamSockets,
    workspaceSockets,
    roomPresence: store.roomPresence,
    sessions: store.sessions,
    mutationsRequireAuth: true,
    roomKey: (teamId, roomId) => `${teamId}:${roomId}`,
    canAccessRoom: () => true,
    isTeamMember: () => true,
    addTeamMember: () => undefined,
    scheduleStoreSave: () => undefined,
    send: (_socket, message) => sent.push(message),
    broadcast: () => undefined
  });
  const manager = createAccountRestrictionManager({
    store,
    liveControl: roomManager,
    persist: async () => {
      saves += 1;
    }
  });

  await manager.restrictAccount({
    userId: "github:blocked",
    reasonCode: "abuse",
    createdAt: new Date().toISOString()
  });

  assert.equal(saves, 2);
  assert.deepEqual(
    Array.from(store.authSessions.values()).map((session) => session.user.id),
    ["github:allowed"]
  );
  assert.deepEqual(
    Array.from(store.deviceSessions.values()).map((session) => session.userId),
    ["github:allowed"]
  );
  assert.equal(store.deviceChallenges.size, 0);
  assert.deepEqual(
    Array.from(store.sessions.values()).map((session) => session.userId),
    ["github:allowed"]
  );
  assert.deepEqual(
    Array.from(store.roomPresence.values()).flatMap((roster) => Array.from(roster.keys())),
    ["allowed-device"]
  );
  assert.deepEqual(
    Array.from(roomSockets.values()).flatMap((sockets) => Array.from(sockets)),
    [allowedSocket]
  );
  assert.deepEqual(
    Array.from(teamSockets.values()).flatMap((sockets) => Array.from(sockets)),
    [allowedSocket]
  );
  assert.deepEqual(Array.from(workspaceSockets), [allowedSocket]);
  assert.deepEqual(closed, [[1008, "Account restricted"]]);
  assert.match(JSON.stringify(sent), /restricted by the relay operator/);
});

test("offline restriction CLI survives restart, denies a stored session, and can unrestrict", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multaiplayer-restriction-test-"));
  const dataPath = join(dir, "relay.sqlite");
  const rawSessionId = "blocked-session-token";
  const expiresAt = Date.now() + 60_000;
  const initial = createRelayPersistence({ dataPath });
  await initial.save({
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [],
    rooms: [],
    invites: [],
    teamMembers: [],
    mlsBacklog: [],
    authSessions: [
      {
        sessionIdHash: createHash("sha256").update(rawSessionId).digest("hex"),
        user: { id: "github:blocked", login: "blocked" },
        expiresAt
      }
    ]
  });
  initial.close();
  try {
    await runRestrictionCli("restrict", "github:blocked", "abuse", dataPath);
    let reopened = createRelayPersistence({ dataPath });
    const restricted = (await reopened.load()) as { accountRestrictions?: unknown[] };
    assert.equal(restricted.accountRestrictions?.length, 1);
    reopened.close();

    const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" }, undefined, dataPath);
    try {
      const response = await fetch(`${relay.baseUrl}/auth/me`, {
        headers: { cookie: `multaiplayer_session=${rawSessionId}` }
      });
      assert.equal(response.status, 401);
      assert.equal(isAccountRestricted({ accountRestrictions: new Map() }, "github:blocked"), false);
    } finally {
      await relay.close({ preserveData: true });
    }
    reopened = createRelayPersistence({ dataPath });
    const afterRestart = (await reopened.load()) as { authSessions?: unknown[] };
    assert.deepEqual(afterRestart.authSessions, []);
    reopened.close();

    await runRestrictionCli("unrestrict", "github:blocked", "operator_restriction", dataPath);
    reopened = createRelayPersistence({ dataPath });
    const unrestricted = (await reopened.load()) as { accountRestrictions?: unknown[] };
    assert.deepEqual(unrestricted.accountRestrictions, []);
    reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("expired restrictions no longer deny an identity", () => {
  const accountRestrictions = new Map([
    [
      "github:expired",
      {
        userId: "github:expired",
        reasonCode: "temporary",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-02T00:00:00.000Z"
      }
    ]
  ]);
  assert.equal(
    isAccountRestricted({ accountRestrictions }, "github:expired", Date.parse("2026-01-03T00:00:00Z")),
    false
  );
});

async function runRestrictionCli(action: string, userId: string, reasonCode: string, dataPath: string) {
  return execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("../src/manage-account-restriction.ts", import.meta.url)),
      action,
      userId,
      reasonCode,
      `--data-path=${dataPath}`,
      "--confirm-relay-stopped"
    ],
    { cwd: process.cwd() }
  );
}
