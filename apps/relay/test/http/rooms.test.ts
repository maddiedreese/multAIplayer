import { test } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { acquireAccountMutationTurn } from "../../src/auth/account-mutation-transaction.js";
import { registerRoomCreateRoute } from "../../src/http/room-create-route.js";
import { registerRoomHostRoute } from "../../src/http/room-host-route.js";
import { registerRoomLifecycleRoute } from "../../src/http/room-lifecycle-route.js";
import type { RegisterRoomRoutesOptions } from "../../src/http/room-route-types.js";
import { createRelayStore } from "../../src/state.js";
import {
  assert,
  createDebugSession,
  patchHostStatus,
  patchRoomSettings,
  postJsonStatus,
  startRelay,
  type DailyCreationQuotaErrorBody
} from "../support/relay.js";

test("relay accepts public room metadata and rejects host-local configuration", async () => {
  const relay = await startRelay();
  try {
    const response = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        name: "Approval room",
        approvalPolicy: "ask_every_turn"
      })
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      room: {
        approvalPolicy: string;
      };
    };
    assert.equal(body.room.approvalPolicy, "ask_every_turn");
    assert.equal("projectPath" in body.room, false);
    assert.equal("codexModel" in body.room, false);

    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Bad policy room",
        approvalPolicy: "surprise"
      }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Leaking raw reasoning setting",
        codexRawReasoningEnabled: "yes"
      }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Leaking model room",
        codexModel: "gpt-5.4"
      }),
      400
    );
  } finally {
    await relay.close();
  }
});

test("relay rejects every legacy encrypted-config field on create and update", async () => {
  const relay = await startRelay();
  try {
    for (const [field, value] of Object.entries({
      projectPath: "/private/repo",
      codexModel: "gpt-5.4",
      codexModelPolicy: "pinned",
      codexReasoningEffort: "high",
      codexReasoningEffortPolicy: "pinned",
      codexRawReasoningEnabled: true,
      codexSpeed: "fast",
      codexServiceTierPolicy: "pinned",
      codexSandboxLevel: "workspace_write"
    })) {
      const createResponse = await fetch(`${relay.baseUrl}/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: "team-core", name: "Legacy config", [field]: value })
      });
      assert.equal(createResponse.status, 400, field);
      const updateResponse = await fetch(`${relay.baseUrl}/rooms/room-desktop/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requesterName: "Maddie", requesterUserId: "github:maddiedreese", [field]: value })
      });
      assert.equal(updateResponse.status, 400, field);
    }
  } finally {
    await relay.close();
  }
});

test("relay enforces authenticated user daily team and room creation quotas", async () => {
  const metricsToken = "room-quota-metrics-token-with-at-least-32-chars";
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_DAILY_TEAM_CREATION_CAP: "1",
    MULTAIPLAYER_RELAY_DAILY_ROOM_CREATION_CAP: "1",
    MULTAIPLAYER_RELAY_METRICS_TOKEN: metricsToken
  });
  try {
    const firstUserCookie = await createDebugSession(relay.baseUrl, "github:quota-user", "quota-user");
    const secondUserCookie = await createDebugSession(relay.baseUrl, "github:quota-peer", "quota-peer");
    const maddieCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");

    const firstTeam = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: firstUserCookie },
      body: JSON.stringify({ name: "Quota team one" })
    });
    assert.equal(firstTeam.status, 201);

    const limitedTeam = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: firstUserCookie },
      body: JSON.stringify({ name: "Quota team two" })
    });
    assert.equal(limitedTeam.status, 429);
    assert.ok(limitedTeam.headers.get("retry-after"));
    const limitedTeamBody = (await limitedTeam.json()) as DailyCreationQuotaErrorBody;
    assert.equal(limitedTeamBody.error, "Daily team creation quota exceeded.");
    assert.equal(limitedTeamBody.code, "quota_exceeded");
    assert.equal(limitedTeamBody.retryAfterSeconds, Number(limitedTeam.headers.get("retry-after")));
    assert.deepEqual(limitedTeamBody.quota, {
      type: "daily_user_team_creations",
      limit: 1,
      used: 1,
      remaining: 0,
      resetsAt: limitedTeamBody.quota.resetsAt
    });
    assert.ok(Number.isFinite(Date.parse(limitedTeamBody.quota.resetsAt)));

    const peerTeam = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: secondUserCookie },
      body: JSON.stringify({ name: "Quota peer team" })
    });
    assert.equal(peerTeam.status, 201);

    const firstRoom = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maddieCookie },
      body: JSON.stringify({
        teamId: "team-core",
        name: "Quota room one"
      })
    });
    assert.equal(firstRoom.status, 201);

    const limitedRoom = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maddieCookie },
      body: JSON.stringify({
        teamId: "team-core",
        name: "Quota room two"
      })
    });
    assert.equal(limitedRoom.status, 429);
    assert.ok(limitedRoom.headers.get("retry-after"));
    const limitedRoomBody = (await limitedRoom.json()) as DailyCreationQuotaErrorBody;
    assert.deepEqual(limitedRoomBody, {
      error: "Daily room creation quota exceeded.",
      code: "quota_exceeded",
      retryAfterSeconds: limitedRoomBody.retryAfterSeconds,
      quota: {
        type: "daily_user_room_creations",
        limit: 1,
        used: 1,
        remaining: 0,
        resetsAt: limitedRoomBody.quota.resetsAt
      }
    });
    assert.equal(limitedRoomBody.retryAfterSeconds, Number(limitedRoom.headers.get("retry-after")));
    assert.ok(Number.isFinite(Date.parse(limitedRoomBody.quota.resetsAt)));

    const metrics = await fetch(`${relay.baseUrl}/metrics`, {
      headers: { authorization: `Bearer ${metricsToken}` }
    });
    assert.equal(metrics.status, 200);
    const metricsBody = await metrics.text();
    assert.match(metricsBody, /multaiplayer_relay_quota_rejections_total 2/);
    assert.match(metricsBody, /type="daily_user_team_creations"} 1/);
    assert.match(metricsBody, /type="daily_user_room_creations"} 1/);
  } finally {
    await relay.close();
  }
});

test("relay enforces authenticated total room ceiling", async () => {
  const metricsToken = "total-room-metrics-token-with-at-least-32-chars";
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER: "2",
    MULTAIPLAYER_RELAY_METRICS_TOKEN: metricsToken
  });
  try {
    const maddieCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const limited = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maddieCookie },
      body: JSON.stringify({
        teamId: "team-core",
        name: "Too many rooms"
      })
    });
    assert.equal(limited.status, 429);
    const body = (await limited.json()) as {
      error: string;
      code: string;
      quota: { type: string; limit: number; used: number; remaining: number };
    };
    assert.deepEqual(body, {
      error: "Total room quota exceeded.",
      code: "quota_exceeded",
      quota: {
        type: "total_user_rooms",
        limit: 2,
        used: 2,
        remaining: 0
      }
    });

    const metrics = await fetch(`${relay.baseUrl}/metrics`, {
      headers: { authorization: `Bearer ${metricsToken}` }
    });
    assert.equal(metrics.status, 200);
    const metricsBody = await metrics.text();
    assert.match(metricsBody, /multaiplayer_relay_quota_rejections_total 1/);
    assert.match(metricsBody, /type="total_user_rooms"} 1/);
  } finally {
    await relay.close();
  }
});

test("concurrent room creation enforces the exact total-room boundary", async () => {
  const app = express();
  app.use(express.json());
  const store = createRelayStore();
  const userId = "github:boundary-user";
  const session = {
    sessionIdHash: "b".repeat(64),
    user: { id: userId, login: "boundary-user" },
    expiresAt: Date.now() + 60_000
  };
  store.authSessions.set(session.sessionIdHash, session);
  store.setTeam({ id: "team-boundary", name: "Boundary team", ownerUserId: userId });
  for (let index = 0; index < 499; index += 1) {
    store.setRoom({
      id: `room-boundary-${index}`,
      teamId: "team-boundary",
      name: `Existing room ${index}`,
      host: "Boundary user",
      hostUserId: userId,
      hostStatus: "offline",
      approvalPolicy: "ask_every_turn"
    });
  }

  let initialMembershipChecks = 0;
  let bothRequestsValidated!: () => void;
  const bothRequestsValidatedPromise = new Promise<void>((resolve) => {
    bothRequestsValidated = resolve;
  });
  let quotaRejections = 0;
  registerRoomCreateRoute({
    app,
    store,
    getAuthSession: () => session,
    allowMutation: () => true,
    teamIdsForUser: () => new Set(["team-boundary"]),
    isTeamMember: () => {
      initialMembershipChecks += 1;
      if (initialMembershipChecks === 2) bothRequestsValidated();
      return true;
    },
    scheduleStoreSave: () => undefined,
    saveRelayStore: async () => undefined,
    broadcastRoomUpdated: () => undefined,
    recordQuotaRejection: () => quotaRejections++,
    isApprovalPolicy: (value): value is RoomRecord["approvalPolicy"] => value === "ask_every_turn",
    normalizeMetadataText: (value, maxChars) =>
      typeof value === "string" && value.length > 0 && value.length <= maxChars ? value : null,
    displayNameForUser: () => "Boundary user",
    maxHostNameChars: 120,
    maxRoomNameChars: 120,
    dailyCreationCaps: { roomsPerUser: 100 },
    totalRoomCapPerUser: 500
  } as RegisterRoomRoutesOptions);
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = (server.address() as AddressInfo).port;
  const releaseAccountTurn = await acquireAccountMutationTurn(store, userId);
  let turnReleased = false;

  try {
    const create = (name: string) =>
      fetch(`http://127.0.0.1:${port}/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: "team-boundary", name })
      });
    const first = create("Boundary contender one");
    const second = create("Boundary contender two");
    await bothRequestsValidatedPromise;
    releaseAccountTurn();
    turnReleased = true;

    const responses = await Promise.all([first, second]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 429]);
    assert.equal(store.allRooms().length, 500);
    assert.equal(quotaRejections, 1);
    const rejected = responses.find((response) => response.status === 429);
    assert.ok(rejected);
    assert.deepEqual(await rejected.json(), {
      error: "Total room quota exceeded.",
      code: "quota_exceeded",
      quota: { type: "total_user_rooms", limit: 500, used: 500, remaining: 0 }
    });
  } finally {
    if (!turnReleased) releaseAccountTurn();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("relay lets only the active host change public room settings", async () => {
  const relay = await startRelay();
  try {
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Peer",
        requesterUserId: "github:peer",
        name: "Peer rename"
      }),
      403
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        name: "Host rename"
      }),
      200
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Peer",
        requesterUserId: "github:peer"
      }),
      403
    );
    const rawReasoningResponse = await fetch(`${relay.baseUrl}/rooms/room-desktop/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese"
      })
    });
    assert.equal(rawReasoningResponse.status, 200);
    await rawReasoningResponse.json();
  } finally {
    await relay.close();
  }
});

test("relay never accepts room project paths or Codex model metadata", async () => {
  const relay = await startRelay();
  try {
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Bad path",
        projectPath: "/tmp/project\u0000secret"
      }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Long path",
        projectPath: "/tmp/another-project"
      }),
      400
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        codexModel: "gpt-5.4"
      }),
      400
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        projectPath: "/Users/maddie/dev/multAIplayer",
        codexModel: "provider/custom-model:v1"
      }),
      400
    );
  } finally {
    await relay.close();
  }
});

test("relay bounds user-visible metadata strings", async () => {
  const relay = await startRelay();
  try {
    const deviceCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const postDeviceStatus = async (body: unknown) => {
      const response = await fetch(`${relay.baseUrl}/devices`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: deviceCookie },
        body: JSON.stringify(body)
      });
      await response.text();
      return response.status;
    };
    assert.equal(await postJsonStatus(relay.baseUrl, "/teams", { name: "x".repeat(121) }), 400);
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "x".repeat(161)
      }),
      400
    );
    assert.equal(
      await postDeviceStatus({
        userId: "github:maddiedreese",
        deviceId: "x".repeat(161),
        displayName: "Maddie",
        publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
        publicKeyFingerprint: "fingerprint"
      }),
      400
    );
    assert.equal(
      await postDeviceStatus({
        userId: "github:maddiedreese",
        deviceId: "device-ok",
        displayName: "Maddie",
        publicKeyJwk: { kty: "EC", crv: "P-256", x: "x".repeat(5000), y: "y" },
        publicKeyFingerprint: "fingerprint"
      }),
      400
    );
    assert.equal(
      await postDeviceStatus({
        userId: "github:maddiedreese",
        deviceId: "device-private-key",
        displayName: "Maddie",
        publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "private-material" },
        publicKeyFingerprint: "fingerprint"
      }),
      400
    );
    assert.equal(
      await postDeviceStatus({
        userId: "github:maddiedreese",
        deviceId: "device-rsa-key",
        displayName: "Maddie",
        publicKeyJwk: { kty: "RSA", n: "x", e: "AQAB" },
        publicKeyFingerprint: "fingerprint"
      }),
      400
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, {
        host: "x".repeat(121),
        hostUserId: "github:maddiedreese",
        hostStatus: "active"
      }),
      400
    );
  } finally {
    await relay.close();
  }
});

test("relay lets authorized users archive restore and delete rooms", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" });
  const ownerCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
  const memberCookie = await createDebugSession(relay.baseUrl, "github:design", "design");
  try {
    const rejectedResponse = await fetch(`${relay.baseUrl}/rooms/room-desktop/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: memberCookie },
      body: JSON.stringify({ action: "archive", requesterName: "Design", requesterUserId: "github:design" })
    });
    assert.equal(rejectedResponse.status, 403);

    const archiveResponse = await fetch(`${relay.baseUrl}/rooms/room-desktop/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ action: "archive", requesterName: "Maddie", requesterUserId: "github:maddiedreese" })
    });
    assert.equal(archiveResponse.status, 200);
    const archived = (await archiveResponse.json()) as {
      room: { id: string; archivedAt?: string; deletedAt?: string };
    };
    assert.equal(archived.room.id, "room-desktop");
    assert.ok(archived.room.archivedAt);
    assert.equal(archived.room.deletedAt, undefined);

    const workspaceWithArchived = await fetch(`${relay.baseUrl}/teams`, { headers: { cookie: ownerCookie } });
    const archivedWorkspace = (await workspaceWithArchived.json()) as {
      rooms: Array<{ id: string; archivedAt?: string }>;
    };
    assert.ok(archivedWorkspace.rooms.find((room) => room.id === "room-desktop")?.archivedAt);

    const inviteWhileArchived = await fetch(`${relay.baseUrl}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
    });
    assert.equal(inviteWhileArchived.status, 409);

    const restoreResponse = await fetch(`${relay.baseUrl}/rooms/room-desktop/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ action: "restore", requesterName: "Maddie", requesterUserId: "github:maddiedreese" })
    });
    assert.equal(restoreResponse.status, 200);
    const restored = (await restoreResponse.json()) as { room: { id: string; archivedAt?: string } };
    assert.equal(restored.room.archivedAt, undefined);

    const inviteResponse = await fetch(`${relay.baseUrl}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
    });
    assert.equal(inviteResponse.status, 201);
    const { invite } = (await inviteResponse.json()) as { invite: { id: string } };

    const deleteResponse = await fetch(`${relay.baseUrl}/rooms/room-desktop/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ action: "delete", requesterName: "Maddie", requesterUserId: "github:maddiedreese" })
    });
    assert.equal(deleteResponse.status, 200);
    const deleted = (await deleteResponse.json()) as { room: { id: string; deletedAt?: string } };
    assert.ok(deleted.room.deletedAt);

    const rejectedInvite = await fetch(`${relay.baseUrl}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
    });
    assert.equal(rejectedInvite.status, 404);
    assert.equal((await fetch(`${relay.baseUrl}/invites/${invite.id}`)).status, 404);

    const workspaceAfterDelete = await fetch(`${relay.baseUrl}/teams`, { headers: { cookie: ownerCookie } });
    const deletedWorkspace = (await workspaceAfterDelete.json()) as { rooms: Array<{ id: string }> };
    assert.ok(!deletedWorkspace.rooms.some((room) => room.id === "room-desktop"));
  } finally {
    await relay.close();
  }
});

test("host bootstrap requires exact identity, device proof, and pristine host state", async () => {
  const room = hostBootstrapRoom();
  const harness = await startHostRouteHarness(room);
  try {
    const validBody = {
      host: room.host,
      hostUserId: room.hostUserId,
      hostDeviceId: "host-device-1",
      hostStatus: "active"
    };
    const rejectedBodies: Array<[string, unknown, number]> = [
      ["missing body", undefined, 400],
      ["array body", [], 400],
      ["missing host", { ...validBody, host: undefined }, 400],
      ["empty host", { ...validBody, host: "" }, 400],
      ["missing user", { ...validBody, hostUserId: undefined }, 400],
      ["empty user", { ...validBody, hostUserId: "" }, 400],
      ["missing device", { ...validBody, hostDeviceId: undefined }, 409],
      ["empty device", { ...validBody, hostDeviceId: "" }, 400],
      ["invalid status", { ...validBody, hostStatus: "ready" }, 400],
      ["offline status", { ...validBody, hostStatus: "offline" }, 400],
      ["handoff status", { ...validBody, hostStatus: "handoff" }, 400],
      ["extra key", { ...validBody, requesterName: "Maddie" }, 409],
      ["wrong host", { ...validBody, host: "Mallory" }, 409],
      ["wrong requested user", { ...validBody, hostUserId: "github:mallory" }, 409],
      [
        "unexpected key cannot replace device",
        { host: validBody.host, hostUserId: validBody.hostUserId, hostStatus: "active", unexpected: true },
        409
      ]
    ];
    for (const [label, body, status] of rejectedBodies) {
      harness.reset();
      const response = await harness.patch(body);
      assert.equal(response.status, status, label);
    }
    for (const [label, mutate] of [
      ["already active", (value: RoomRecord) => ({ ...value, hostStatus: "active" as const })],
      ["epoch already established", (value: RoomRecord) => ({ ...value, acceptedMlsEpoch: 0 })],
      ["different stored user", (value: RoomRecord) => ({ ...value, hostUserId: "github:mallory" })]
    ] as const) {
      harness.reset(mutate(room));
      const response = await harness.patch(validBody);
      assert.equal(response.status, 409, label);
    }

    harness.reset();
    harness.store.deviceSessions.clear();
    assert.equal((await harness.patch(validBody)).status, 409);
    harness.reset();
    harness.store.deviceSessions.set("device-token", {
      token: "device-token",
      userId: "github:mallory",
      deviceId: "host-device-1",
      expiresAt: Date.now() + 60_000
    });
    assert.equal((await harness.patch(validBody)).status, 409);
    harness.reset();
    harness.store.deviceSessions.set("device-token", {
      token: "device-token",
      userId: room.hostUserId,
      deviceId: "other-device",
      expiresAt: Date.now() + 60_000
    });
    assert.equal((await harness.patch(validBody)).status, 409);
    harness.reset();
    harness.store.deviceSessions.set("device-token", {
      token: "device-token",
      userId: room.hostUserId,
      deviceId: "host-device-1",
      expiresAt: Date.now() - 1
    });
    assert.equal((await harness.patch(validBody)).status, 409);

    harness.reset();
    const response = await harness.patch(validBody);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { room: RoomRecord };
    assert.equal(body.room.activeHostDeviceId, "host-device-1");
    assert.equal(body.room.hostStatus, "active");
    assert.equal(body.room.acceptedMlsEpoch, 0);
    assert.equal(harness.saves(), 1);
    assert.equal(harness.broadcasts(), 1);
    assert.deepEqual(harness.store.getRoom(room.id), body.room);
  } finally {
    await harness.close();
  }
});

test("host bootstrap rejects authorization, access, missing rooms, and unavailable state", async () => {
  const room = hostBootstrapRoom();
  const body = {
    host: room.host,
    hostUserId: room.hostUserId,
    hostDeviceId: "host-device-1",
    hostStatus: "active"
  };
  const harness = await startHostRouteHarness(room);
  try {
    harness.setMutationAllowed(false);
    assert.equal((await harness.patch(body)).status, 401);
    harness.setMutationAllowed(true);
    harness.setCanAccess(false);
    assert.equal((await harness.patch(body)).status, 403);
    harness.setCanAccess(true);
    harness.store.rooms.delete(room.id);
    const missing = await harness.patch(body);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Room not found", code: "room_not_found" });

    for (const unavailable of [
      { ...room, archivedAt: new Date().toISOString() },
      { ...room, deletedAt: new Date().toISOString() }
    ]) {
      harness.reset(unavailable);
      const response = await harness.patch(body);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: "Restore this room before changing host state.",
        code: "conflict"
      });
    }
    for (const unavailableTeam of [{ archivedAt: new Date().toISOString() }, { deletedAt: new Date().toISOString() }]) {
      harness.reset();
      harness.store.setTeam({ ...hostBootstrapTeam(), ...unavailableTeam });
      assert.equal((await harness.patch(body)).status, 409);
    }
  } finally {
    await harness.close();
  }
});

function hostBootstrapTeam(): TeamRecord {
  return { id: "team-host", name: "Host team", members: 1 };
}

function hostBootstrapRoom(): RoomRecord {
  return {
    id: "room-host-bootstrap",
    teamId: "team-host",
    name: "Bootstrap room",
    host: "Maddie",
    hostUserId: "github:maddiedreese",
    hostStatus: "offline",
    approvalPolicy: "ask_every_turn"
  };
}

async function startHostRouteHarness(initialRoom: RoomRecord) {
  const app = express();
  app.use(express.json());
  const store = createRelayStore();
  let saves = 0;
  let broadcasts = 0;
  let mutationAllowed = true;
  let canAccess = true;
  const session = {
    sessionIdHash: "a".repeat(64),
    user: { id: initialRoom.hostUserId, login: "maddie" },
    expiresAt: Date.now() + 60_000
  };
  const reset = (room = initialRoom) => {
    store.rooms.clear();
    store.teams.clear();
    store.deviceSessions.clear();
    store.setTeam(hostBootstrapTeam());
    store.setRoom({ ...room });
    store.deviceSessions.set("device-token", {
      token: "device-token",
      userId: initialRoom.hostUserId,
      deviceId: "host-device-1",
      expiresAt: Date.now() + 60_000
    });
    saves = 0;
    broadcasts = 0;
  };
  reset();
  registerRoomHostRoute({
    app,
    store,
    getAuthSession: () => session,
    allowMutation: (_session, res) => {
      if (mutationAllowed) return true;
      res.status(401).json({ code: "authentication_required" });
      return false;
    },
    canAccessRoom: () => canAccess,
    scheduleStoreSave: () => saves++,
    broadcastRoomUpdated: () => broadcasts++,
    normalizeMetadataText: (value, maxChars) =>
      typeof value === "string" && value.length > 0 && value.length <= maxChars ? value : null,
    maxHostNameChars: 120,
    maxUserIdChars: 160,
    maxDeviceIdChars: 160
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
    setMutationAllowed: (value: boolean) => (mutationAllowed = value),
    setCanAccess: (value: boolean) => (canAccess = value),
    patch: (body: unknown) =>
      fetch(`http://127.0.0.1:${port}/rooms/${initialRoom.id}/host`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-device-session": "device-token" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

test("room lifecycle applies archive, restore, and delete transitions exactly", async () => {
  const room = { ...hostBootstrapRoom(), hostStatus: "active" as const };
  const harness = await startLifecycleRouteHarness(room);
  try {
    const archived = await harness.patch("archive");
    assert.equal(archived.status, 200);
    const archivedRoom = ((await archived.json()) as { room: RoomRecord }).room;
    assert.ok(archivedRoom.archivedAt);
    assert.equal(archivedRoom.deletedAt, undefined);
    assert.equal(harness.saves(), 1);
    assert.equal(harness.broadcasts(), 1);

    harness.reset({ ...room, archivedAt: "2026-01-01T00:00:00.000Z" });
    const rearchived = ((await (await harness.patch("archive")).json()) as { room: RoomRecord }).room;
    assert.equal(rearchived.archivedAt, "2026-01-01T00:00:00.000Z");

    harness.reset({ ...room, archivedAt: "2026-01-01T00:00:00.000Z" });
    const restored = await harness.patch("restore");
    assert.equal(restored.status, 200);
    assert.equal(((await restored.json()) as { room: RoomRecord }).room.archivedAt, undefined);

    harness.reset({ ...room, archivedAt: "2026-01-01T00:00:00.000Z" });
    const deleted = await harness.patch("delete");
    assert.equal(deleted.status, 200);
    const deletedRoom = ((await deleted.json()) as { room: RoomRecord }).room;
    assert.equal(deletedRoom.archivedAt, undefined);
    assert.ok(deletedRoom.deletedAt);
  } finally {
    await harness.close();
  }
});

test("room lifecycle enforces existence, access, roles, and team restore ordering", async () => {
  const room = { ...hostBootstrapRoom(), hostStatus: "active" as const };
  const harness = await startLifecycleRouteHarness(room);
  try {
    harness.setMutationAllowed(false);
    assert.equal((await harness.patch("archive")).status, 401);
    harness.setMutationAllowed(true);

    harness.setCanAccess(false);
    assert.equal((await harness.patch("archive")).status, 403);
    harness.setCanAccess(true);

    harness.reset();
    harness.store.rooms.delete(room.id);
    assert.equal((await harness.patch("archive")).status, 404);
    for (const unavailable of [{ ...room, deletedAt: "2026-01-01T00:00:00.000Z" }, { ...room }]) {
      harness.reset(unavailable);
      if (!unavailable.deletedAt) {
        harness.store.setTeam({ ...hostBootstrapTeam(), deletedAt: "2026-01-01T00:00:00.000Z" });
      }
      assert.equal((await harness.patch("archive")).status, 404);
    }

    harness.reset();
    assert.equal((await harness.patch(undefined)).status, 400);
    assert.equal((await harness.patch("rename")).status, 400);

    harness.reset();
    harness.setRole("member");
    harness.setIsHost(false);
    assert.equal((await harness.patch("archive")).status, 403);
    harness.setIsHost(true);
    assert.equal((await harness.patch("archive")).status, 200);

    harness.reset({ ...room, hostStatus: "offline" });
    harness.setRole("member");
    harness.setIsHost(true);
    assert.equal((await harness.patch("archive")).status, 403);

    for (const role of ["owner", "admin"] as const) {
      harness.reset();
      harness.setRole(role);
      harness.setIsHost(false);
      assert.equal((await harness.patch("archive")).status, 200, role);
    }

    harness.reset({ ...room, archivedAt: "2026-01-01T00:00:00.000Z" });
    harness.store.setTeam({ ...hostBootstrapTeam(), archivedAt: "2026-01-01T00:00:00.000Z" });
    assert.equal((await harness.patch("restore")).status, 409);
    assert.equal((await harness.patch("delete")).status, 200);
  } finally {
    await harness.close();
  }
});

async function startLifecycleRouteHarness(initialRoom: RoomRecord) {
  const app = express();
  app.use(express.json());
  const store = createRelayStore();
  let saves = 0;
  let broadcasts = 0;
  let mutationAllowed = true;
  let canAccess = true;
  let role: "owner" | "admin" | "member" = "owner";
  let isHost = true;
  const session = {
    sessionIdHash: "b".repeat(64),
    user: { id: initialRoom.hostUserId, login: "maddie" },
    expiresAt: Date.now() + 60_000
  };
  const reset = (room = initialRoom) => {
    store.rooms.clear();
    store.teams.clear();
    store.teamMembers.clear();
    store.setTeam(hostBootstrapTeam());
    store.setRoom({ ...room });
    store.setTeamMembers(
      room.teamId,
      new Map([
        [
          session.user.id,
          {
            teamId: room.teamId,
            userId: session.user.id,
            role,
            joinedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      ])
    );
    saves = 0;
    broadcasts = 0;
  };
  reset();
  registerRoomLifecycleRoute({
    app,
    store,
    getAuthSession: () => session,
    allowMutation: (_session, res) => {
      if (mutationAllowed) return true;
      res.status(401).json({ code: "authentication_required" });
      return false;
    },
    canAccessRoom: () => canAccess,
    isTeamMember: () => canAccess,
    requesterFromRequest: () => ({ id: session.user.id, name: "Maddie" }),
    isRoomHost: () => isHost,
    scheduleStoreSave: () => saves++,
    broadcastRoomUpdated: () => broadcasts++
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
    setMutationAllowed: (value: boolean) => (mutationAllowed = value),
    setCanAccess: (value: boolean) => (canAccess = value),
    setRole: (value: typeof role) => {
      role = value;
      reset(store.getRoom(initialRoom.id) ?? initialRoom);
    },
    setIsHost: (value: boolean) => (isHost = value),
    patch: (action: string | undefined) =>
      fetch(`http://127.0.0.1:${port}/rooms/${initialRoom.id}/lifecycle`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        ...(action === undefined ? {} : { body: JSON.stringify({ action }) })
      }),
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
