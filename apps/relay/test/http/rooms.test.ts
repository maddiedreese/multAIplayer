import { test } from "node:test";
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
        approvalPolicy: "ask_every_turn",
        browserAllowedOrigins: ["https://github.com", "https://example.com"],
        browserProfilePersistent: false
      })
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      room: {
        approvalPolicy: string;
        browserAllowedOrigins: string[];
        browserProfilePersistent: boolean;
      };
    };
    assert.equal(body.room.approvalPolicy, "ask_every_turn");
    assert.equal("projectPath" in body.room, false);
    assert.equal("codexModel" in body.room, false);
    assert.deepEqual(body.room.browserAllowedOrigins, ["https://github.com", "https://example.com"]);
    assert.equal(body.room.browserProfilePersistent, false);

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
        name: "Bad browser room",
        browserAllowedOrigins: ["ftp://example.com"]
      }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Bad browser persistence room",
        browserProfilePersistent: "sometimes"
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
        requesterUserId: "github:peer",
        browserProfilePersistent: true
      }),
      403
    );
    const rawReasoningResponse = await fetch(`${relay.baseUrl}/rooms/room-desktop/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        browserProfilePersistent: true
      })
    });
    assert.equal(rawReasoningResponse.status, 200);
    const rawReasoningBody = (await rawReasoningResponse.json()) as {
      room: { browserProfilePersistent?: boolean };
    };
    assert.equal(rawReasoningBody.room.browserProfilePersistent, true);
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
