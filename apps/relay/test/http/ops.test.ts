import { test } from "node:test";
import {
  WebSocket,
  assert,
  onceOpen,
  readFile,
  startRelay,
  waitForClose,
  waitForJoined,
  waitForNotReady,
  type StoredRelayStateFixture
} from "../support/relay.js";

test("relay exposes content-free operational metrics", async () => {
  const relay = await startRelay();
  try {
    const response = await fetch(`${relay.baseUrl}/metrics`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      activeSockets?: unknown;
      liveAttachmentBlobCount?: unknown;
      liveAttachmentBlobBytes?: unknown;
      envelopesPublishedTotal?: unknown;
      attachmentBlobUploadsTotal?: unknown;
      attachmentBlobUploadBytesTotal?: unknown;
      attachmentBlobUploadRejectionsByReason?: unknown;
      quotaRejectionsTotal?: unknown;
      quotaRejectionsByType?: unknown;
      rateLimitRejectionsTotal?: unknown;
      rateLimitRejectionsByBucket?: unknown;
      webSocketConnectionAttemptsTotal?: unknown;
      webSocketConnectionsAcceptedTotal?: unknown;
      webSocketConnectionRejectionsByReason?: unknown;
      startedAt?: unknown;
      uptimeSeconds?: unknown;
    };

    assert.equal(body.activeSockets, 0);
    assert.equal(body.liveAttachmentBlobCount, 0);
    assert.equal(body.liveAttachmentBlobBytes, 0);
    assert.equal(body.envelopesPublishedTotal, 0);
    assert.equal(body.attachmentBlobUploadsTotal, 0);
    assert.equal(body.attachmentBlobUploadBytesTotal, 0);
    assert.deepEqual(body.attachmentBlobUploadRejectionsByReason, {});
    assert.equal(body.quotaRejectionsTotal, 0);
    assert.deepEqual(body.quotaRejectionsByType, {});
    assert.equal(body.rateLimitRejectionsTotal, 0);
    assert.deepEqual(body.rateLimitRejectionsByBucket, {});
    assert.equal(body.webSocketConnectionAttemptsTotal, 0);
    assert.equal(body.webSocketConnectionsAcceptedTotal, 0);
    assert.deepEqual(body.webSocketConnectionRejectionsByReason, {});
    assert.equal(typeof body.startedAt, "string");
    assert.equal(typeof body.uptimeSeconds, "number");
  } finally {
    await relay.close();
  }
});

test("relay drains readiness, sockets, and pending store writes on graceful shutdown", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS: "500",
    MULTAIPLAYER_RELAY_SHUTDOWN_GRACE_MS: "2000"
  });
  const socket = new WebSocket(relay.wsUrl);
  try {
    await onceOpen(socket);
    socket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );
    await waitForJoined(socket);

    const createResponse = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Shutdown flush team" })
    });
    assert.equal(createResponse.status, 201);

    const closePromise = waitForClose(socket);
    const shutdownPromise = relay.beginShutdown();
    const readyBody = await waitForNotReady(relay.baseUrl);
    assert.equal(readyBody.code, "relay_shutting_down");

    const rejectedResponse = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Rejected during shutdown" })
    });
    assert.equal(rejectedResponse.status, 503);
    assert.deepEqual(await rejectedResponse.json(), {
      error: "Relay is shutting down.",
      code: "relay_shutting_down"
    });

    const lateSocket = new WebSocket(relay.wsUrl);
    try {
      const lateClosePromise = waitForClose(lateSocket);
      await onceOpen(lateSocket).catch(() => undefined);
      const lateClose = await lateClosePromise;
      assert.equal(lateClose.code, 1012);
      assert.equal(lateClose.reason, "Relay shutting down");
    } finally {
      lateSocket.close();
    }

    const close = await closePromise;
    assert.equal(close.code, 1012);
    assert.equal(close.reason, "Relay shutting down");
    await shutdownPromise;

    const stored = JSON.parse(await readFile(relay.dataPath, "utf8")) as StoredRelayStateFixture;
    assert.ok(
      Array.isArray(stored.teams) &&
        stored.teams.some(
          (team) => typeof team === "object" && team !== null && "name" in team && team.name === "Shutdown flush team"
        )
    );
  } finally {
    socket.close();
    await relay.close();
  }
});

test("relay disables debug endpoints in every environment unless explicitly enabled", async () => {
  const productionRelay = await startRelay({ NODE_ENV: "production" });
  try {
    const disabled = await fetch(`${productionRelay.baseUrl}/debug/rooms`);
    assert.equal(disabled.status, 404);
  } finally {
    await productionRelay.close();
  }

  const developmentRelay = await startRelay({ MULTAIPLAYER_RELAY_DEBUG: "false" });
  try {
    const disabled = await fetch(`${developmentRelay.baseUrl}/debug/rooms`);
    assert.equal(disabled.status, 404);
  } finally {
    await developmentRelay.close();
  }

  const debugRelay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_DEBUG: "true"
  });
  try {
    const enabled = await fetch(`${debugRelay.baseUrl}/debug/rooms`);
    assert.equal(enabled.status, 200);
  } finally {
    await debugRelay.close();
  }
});

test("relay does not seed demo workspace in production by default when auth is explicitly disabled", async () => {
  const relay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "false"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { teams: unknown[]; rooms: unknown[] };
    assert.deepEqual(body.teams, []);
    assert.deepEqual(body.rooms, []);
  } finally {
    await relay.close();
  }
});

test("relay can explicitly seed demo workspace in production", async () => {
  const relay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_SEED_DEMO: "true",
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "false"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      teams: Array<{ id: string }>;
      rooms: Array<{ id: string }>;
    };
    assert.ok(body.teams.some((team) => team.id === "team-core"));
    assert.ok(body.rooms.some((room) => room.id === "room-desktop"));
  } finally {
    await relay.close();
  }
});
