import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { registerRoomSettingsRoute } from "../../src/http/room-settings-route.js";
import type { RegisterRoomRoutesOptions } from "../../src/http/room-route-types.js";
import { createRelayStore } from "../../src/state.js";

const team: TeamRecord = { id: "team-settings", name: "Settings team", members: 2 };
const room: RoomRecord = {
  id: "room-settings",
  teamId: team.id,
  name: "Settings room",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  browserAllowedOrigins: ["https://github.com"],
  browserProfilePersistent: false
};

test("room settings enforce mutation, access, host, and existence authorization", async () => {
  const harness = await startSettingsRouteHarness();
  try {
    harness.setMutationAllowed(false);
    assert.deepEqual(await responseBody(await harness.patch({ name: "Blocked" })), {
      status: 401,
      body: { code: "authentication_required" }
    });

    harness.setMutationAllowed(true);
    harness.store.rooms.delete(room.id);
    assert.deepEqual(await responseBody(await harness.patch({ name: "Missing" })), {
      status: 404,
      body: { error: "Room not found", code: "room_not_found" }
    });

    harness.reset();
    harness.setCanAccess(false);
    assert.deepEqual(await responseBody(await harness.patch({ name: "No access" })), {
      status: 403,
      body: { error: "Join this room before changing room settings.", code: "forbidden" }
    });

    harness.setSessionEnabled(false);
    assert.equal((await harness.patch({ name: "Anonymous host" })).status, 200);

    harness.reset();
    harness.setSessionEnabled(true);
    harness.setIsHost(false);
    assert.deepEqual(await responseBody(await harness.patch({ name: "Peer edit" })), {
      status: 403,
      body: { error: "Only the active host can change room settings.", code: "forbidden" }
    });

    harness.reset({ ...room, hostStatus: "offline" });
    harness.setIsHost(false);
    assert.equal((await harness.patch({ name: "Offline edit" })).status, 200);
  } finally {
    await harness.close();
  }
});

test("room settings accept requests when cookie parsing has not populated req.cookies", async () => {
  const harness = await startSettingsRouteHarness({ attachCookies: false });
  try {
    harness.setSessionEnabled(false);
    assert.equal((await harness.patch({ name: "No cookies" })).status, 200);
  } finally {
    await harness.close();
  }
});

test("room settings reject each archived or deleted room and team state", async () => {
  const harness = await startSettingsRouteHarness();
  try {
    for (const unavailableRoom of [
      { ...room, archivedAt: "2026-01-01T00:00:00.000Z" },
      { ...room, deletedAt: "2026-01-01T00:00:00.000Z" }
    ]) {
      harness.reset(unavailableRoom);
      assert.deepEqual(await responseBody(await harness.patch({ name: "Unavailable" })), {
        status: 409,
        body: { error: "Restore this room before changing room settings.", code: "conflict" }
      });
    }
    for (const unavailableTeam of [
      { ...team, archivedAt: "2026-01-01T00:00:00.000Z" },
      { ...team, deletedAt: "2026-01-01T00:00:00.000Z" }
    ]) {
      harness.reset();
      harness.store.setTeam(unavailableTeam);
      assert.equal((await harness.patch({ name: "Unavailable" })).status, 409);
    }
  } finally {
    await harness.close();
  }
});

test("room settings reject host-local fields and invalid public settings with precise errors", async () => {
  const harness = await startSettingsRouteHarness();
  try {
    assert.deepEqual(await responseBody(await harness.patch({ codexModel: "gpt-5.4" })), {
      status: 400,
      body: {
        error: "Host-local room configuration must be published through MLS.",
        code: "invalid_request"
      }
    });
    const invalidInputs: Array<[Record<string, unknown>, string]> = [
      [{ name: "" }, "Room name is required and must be up to 160 characters"],
      [{ name: "x".repeat(161) }, "Room name is required and must be up to 160 characters"],
      [{ approvalPolicy: "sometimes" }, "approvalPolicy is invalid"],
      [{ approvalDelegationPolicy: "everyone" }, "approvalDelegationPolicy is invalid"],
      [{ trustedApproverUserIds: "github:peer" }, "trustedApproverUserIds must be up to 50 user ids"],
      [
        { trustedApproverUserIds: Array.from({ length: 51 }, (_, index) => `user:${index}`) },
        "trustedApproverUserIds must be up to 50 user ids"
      ],
      [{ trustedApproverUserIds: [""] }, "trustedApproverUserIds must be up to 50 user ids"],
      [{ trustedApproverUserIds: ["x".repeat(161)] }, "trustedApproverUserIds must be up to 50 user ids"],
      [{ trustedApproverUserIds: ["github:peer\u0000"] }, "trustedApproverUserIds must be up to 50 user ids"],
      [{ mode: { chat: true } }, "mode must include boolean chat, code, workspace, and browser fields"],
      [
        { browserAllowedOrigins: ["ftp://example.com"] },
        "browserAllowedOrigins must be up to 20 http(s) origins such as https://github.com"
      ],
      [{ browserProfilePersistent: "yes" }, "browserProfilePersistent must be a boolean"]
    ];
    for (const [input, error] of invalidInputs) {
      assert.deepEqual(await responseBody(await harness.patch(input)), {
        status: 400,
        body: { error, code: "invalid_request" }
      });
    }
    assert.equal(harness.saves(), 0);
    assert.equal(harness.broadcasts(), 0);
  } finally {
    await harness.close();
  }
});

test("room settings normalize and persist every public setting while preserving omitted values", async () => {
  const harness = await startSettingsRouteHarness();
  try {
    const mode = { chat: false, code: true, workspace: false, browser: true };
    const response = await harness.patch({
      name: "  Renamed room  ",
      approvalPolicy: "never",
      approvalDelegationPolicy: "trusted_approvers",
      trustedApproverUserIds: [" github:peer ", "github:peer", "github:second"],
      mode,
      browserAllowedOrigins: ["https://example.com/path", "https://github.com"],
      browserProfilePersistent: true
    });
    assert.equal(response.status, 200);
    const updated = ((await response.json()) as { room: RoomRecord }).room;
    assert.deepEqual(updated, {
      ...room,
      name: "Renamed room",
      approvalPolicy: "never",
      approvalDelegationPolicy: "trusted_approvers",
      trustedApproverUserIds: ["github:peer", "github:second"],
      mode,
      browserAllowedOrigins: ["https://example.com", "https://github.com"],
      browserProfilePersistent: true
    });
    assert.deepEqual(harness.store.getRoom(room.id), updated);
    assert.equal(harness.saves(), 1);
    assert.equal(harness.broadcasts(), 1);

    harness.reset(updated);
    const omitted = ((await (await harness.patch({})).json()) as { room: RoomRecord }).room;
    assert.deepEqual(omitted, updated);
    assert.equal(harness.browserNormalizationCalls(), 0);
    assert.equal(harness.saves(), 1);
    assert.equal(harness.broadcasts(), 1);

    harness.reset(updated);
    const cleared = ((await (await harness.patch({ trustedApproverUserIds: [] })).json()) as { room: RoomRecord }).room;
    assert.deepEqual(cleared.trustedApproverUserIds, []);
  } finally {
    await harness.close();
  }
});

async function startSettingsRouteHarness({ attachCookies = true } = {}) {
  const app = express();
  app.use(express.json());
  if (attachCookies) {
    app.use((req, _res, next) => {
      req.cookies = req.headers["x-test-session"] === "enabled" ? { multaiplayer_session: "session" } : {};
      next();
    });
  }
  const store = createRelayStore();
  let saves = 0;
  let broadcasts = 0;
  let mutationAllowed = true;
  let canAccess = true;
  let isHost = true;
  let sessionEnabled = true;
  let browserNormalizationCalls = 0;
  const session = {
    sessionIdHash: "c".repeat(64),
    user: { id: room.hostUserId, login: "maddie" },
    expiresAt: Date.now() + 60_000
  };
  const reset = (value: RoomRecord = room) => {
    store.rooms.clear();
    store.teams.clear();
    store.setTeam(team);
    store.setRoom({ ...value });
    saves = 0;
    broadcasts = 0;
    browserNormalizationCalls = 0;
    canAccess = true;
    isHost = true;
  };
  reset();
  registerRoomSettingsRoute({
    app,
    store,
    getAuthSession: (token) => (token === "session" ? session : null),
    allowMutation: (_session, res) => {
      if (mutationAllowed) return true;
      res.status(401).json({ code: "authentication_required" });
      return false;
    },
    canAccessRoom: () => canAccess,
    requesterFromRequest: () => ({ id: room.hostUserId, name: "Maddie" }),
    isRoomHost: () => isHost,
    normalizeMetadataText: (value, maxChars) => {
      if (typeof value !== "string") return null;
      const normalized = value.trim();
      return normalized && normalized.length <= maxChars ? normalized : null;
    },
    normalizeBrowserAllowedOrigins: (value) => {
      browserNormalizationCalls++;
      if (!Array.isArray(value) || value.length > 20) return null;
      const origins: string[] = [];
      for (const item of value) {
        try {
          const url = new URL(typeof item === "string" ? item : "");
          if (url.protocol !== "http:" && url.protocol !== "https:") return null;
          origins.push(url.origin);
        } catch {
          return null;
        }
      }
      return origins;
    },
    isApprovalPolicy: (value) => ["ask_every_turn", "never"].includes(value),
    isApprovalDelegationPolicy: (value) => ["host_only", "trusted_approvers"].includes(value),
    isRoomMode: (value): value is RoomRecord["mode"] => {
      if (!value || typeof value !== "object") return false;
      const candidate = value as Record<string, unknown>;
      return ["chat", "code", "workspace", "browser"].every((key) => typeof candidate[key] === "boolean");
    },
    scheduleStoreSave: () => saves++,
    broadcastRoomUpdated: () => broadcasts++,
    maxRoomNameChars: 160,
    maxUserIdChars: 160
  } as RegisterRoomRoutesOptions);
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    store,
    reset,
    saves: () => saves,
    broadcasts: () => broadcasts,
    browserNormalizationCalls: () => browserNormalizationCalls,
    setMutationAllowed: (value: boolean) => (mutationAllowed = value),
    setCanAccess: (value: boolean) => (canAccess = value),
    setIsHost: (value: boolean) => (isHost = value),
    setSessionEnabled: (value: boolean) => (sessionEnabled = value),
    patch: (body: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${port}/rooms/${room.id}/settings`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(sessionEnabled ? { "x-test-session": "enabled" } : {})
        },
        body: JSON.stringify(body)
      }),
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function responseBody(response: Response) {
  return { status: response.status, body: await response.json() };
}
