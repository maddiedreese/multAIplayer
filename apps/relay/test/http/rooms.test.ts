import { test } from "node:test";
import {
  assert,
  codexReasoningEffortIds,
  createDebugSession,
  maxRoomProjectPathChars,
  patchHostStatus,
  patchRoomSettings,
  postJsonStatus,
  startRelay,
  type DailyCreationQuotaErrorBody
} from "../support/relay.js";

test("relay accepts room defaults when creating a room", async () => {
  const relay = await startRelay();
  try {
    const response = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        name: "Approval room",
        projectPath: "/tmp/multaiplayer",
        approvalPolicy: "ask_every_turn",
        codexModel: "gpt-5.4-thinking",
        codexReasoningEffort: "none",
        browserAllowedOrigins: ["https://github.com", "https://example.com"],
        browserProfilePersistent: false
      })
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      room: {
        approvalPolicy: string;
        codexModel: string;
        codexReasoningEffort: string;
        browserAllowedOrigins: string[];
        browserProfilePersistent: boolean;
      };
    };
    assert.equal(body.room.approvalPolicy, "ask_every_turn");
    assert.equal(body.room.codexModel, "gpt-5.4-thinking");
    assert.equal(body.room.codexReasoningEffort, "none");
    assert.deepEqual(body.room.browserAllowedOrigins, ["https://github.com", "https://example.com"]);
    assert.equal(body.room.browserProfilePersistent, false);

    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Bad policy room",
        projectPath: "/tmp/multaiplayer",
        approvalPolicy: "surprise"
      }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Bad browser room",
        projectPath: "/tmp/multaiplayer",
        browserAllowedOrigins: ["ftp://example.com"]
      }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Bad browser persistence room",
        projectPath: "/tmp/multaiplayer",
        browserProfilePersistent: "sometimes"
      }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Bad model room",
        projectPath: "/tmp/multaiplayer",
        codexModel: "not a model id"
      }),
      400
    );
  } finally {
    await relay.close();
  }
});

test("relay reasoning-effort errors list every current protocol option", async () => {
  const relay = await startRelay();
  const expectedError = `codexReasoningEffort must be one of ${codexReasoningEffortIds.join(", ")}`;
  try {
    const createResponse = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        name: "Invalid effort room",
        projectPath: "/tmp/multaiplayer",
        codexReasoningEffort: "ultra"
      })
    });
    assert.equal(createResponse.status, 400);
    assert.deepEqual(await createResponse.json(), { error: expectedError });

    const updateResponse = await fetch(`${relay.baseUrl}/rooms/room-desktop/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        codexReasoningEffort: "ultra"
      })
    });
    assert.equal(updateResponse.status, 400);
    assert.deepEqual(await updateResponse.json(), { error: expectedError });
  } finally {
    await relay.close();
  }
});

test("relay enforces authenticated user daily team and room creation quotas", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_DAILY_TEAM_CREATION_CAP: "1",
    MULTAIPLAYER_RELAY_DAILY_ROOM_CREATION_CAP: "1"
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
        name: "Quota room one",
        projectPath: "/tmp/multaiplayer"
      })
    });
    assert.equal(firstRoom.status, 201);

    const limitedRoom = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maddieCookie },
      body: JSON.stringify({
        teamId: "team-core",
        name: "Quota room two",
        projectPath: "/tmp/multaiplayer"
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

    const metrics = await fetch(`${relay.baseUrl}/metrics`);
    assert.equal(metrics.status, 200);
    const metricsBody = (await metrics.json()) as {
      quotaRejectionsTotal?: unknown;
      quotaRejectionsByType?: Record<string, unknown>;
    };
    assert.equal(metricsBody.quotaRejectionsTotal, 2);
    assert.equal(metricsBody.quotaRejectionsByType?.daily_user_team_creations, 1);
    assert.equal(metricsBody.quotaRejectionsByType?.daily_user_room_creations, 1);
  } finally {
    await relay.close();
  }
});

test("relay enforces authenticated total room ceiling", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER: "2"
  });
  try {
    const maddieCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const limited = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maddieCookie },
      body: JSON.stringify({
        teamId: "team-core",
        name: "Too many rooms",
        projectPath: "/tmp/multaiplayer"
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

    const metrics = await fetch(`${relay.baseUrl}/metrics`);
    assert.equal(metrics.status, 200);
    const metricsBody = (await metrics.json()) as {
      quotaRejectionsTotal?: unknown;
      quotaRejectionsByType?: Record<string, unknown>;
    };
    assert.equal(metricsBody.quotaRejectionsTotal, 1);
    assert.equal(metricsBody.quotaRejectionsByType?.total_user_rooms, 1);
  } finally {
    await relay.close();
  }
});

test("relay lets only the active host change room settings", async () => {
  const relay = await startRelay();
  try {
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Peer",
        requesterUserId: "github:peer",
        codexModel: "gpt-5.4-thinking"
      }),
      403
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        codexModel: "gpt-5.4-thinking"
      }),
      200
    );
  } finally {
    await relay.close();
  }
});

test("relay bounds room project paths and Codex model metadata", async () => {
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
        projectPath: `/${"a".repeat(maxRoomProjectPathChars + 1)}`
      }),
      400
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        codexModel: "bad model with spaces"
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
      200
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
        name: "x".repeat(161),
        projectPath: "/tmp/multaiplayer"
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
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
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

    const restoreResponse = await fetch(`${relay.baseUrl}/rooms/room-desktop/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ action: "restore", requesterName: "Maddie", requesterUserId: "github:maddiedreese" })
    });
    assert.equal(restoreResponse.status, 200);
    const restored = (await restoreResponse.json()) as { room: { id: string; archivedAt?: string } };
    assert.equal(restored.room.archivedAt, undefined);

    const deleteResponse = await fetch(`${relay.baseUrl}/rooms/room-desktop/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ action: "delete", requesterName: "Maddie", requesterUserId: "github:maddiedreese" })
    });
    assert.equal(deleteResponse.status, 200);
    const deleted = (await deleteResponse.json()) as { room: { id: string; deletedAt?: string } };
    assert.ok(deleted.room.deletedAt);

    const workspaceAfterDelete = await fetch(`${relay.baseUrl}/teams`, { headers: { cookie: ownerCookie } });
    const deletedWorkspace = (await workspaceAfterDelete.json()) as { rooms: Array<{ id: string }> };
    assert.ok(!deletedWorkspace.rooms.some((room) => room.id === "room-desktop"));
  } finally {
    await relay.close();
  }
});
