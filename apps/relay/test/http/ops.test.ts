import { test } from "node:test";
import {
  WebSocket,
  assert,
  createDebugSession,
  emptyWorkspaceFixture,
  onceOpen,
  readFile,
  startRelay,
  waitForClose,
  waitForJoined,
  waitForNotReady,
  type StoredRelayStateFixture
} from "../support/relay.js";

test("relay exposes content-free operational metrics", async () => {
  const metricsToken = "test-metrics-token-that-is-at-least-32-characters";
  const relay = await startRelay({ MULTAIPLAYER_RELAY_METRICS_TOKEN: metricsToken });
  try {
    const unauthorized = await fetch(`${relay.baseUrl}/metrics`);
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate") ?? "", /^Bearer /);

    const response = await fetch(`${relay.baseUrl}/metrics`, {
      headers: { authorization: `Bearer ${metricsToken}` }
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/plain/);
    const body = await response.text();
    assert.match(body, /# TYPE multaiplayer_relay_active_sockets gauge/);
    assert.match(body, /multaiplayer_relay_active_sockets 0/);
    assert.match(body, /multaiplayer_relay_live_attachment_blobs 0/);
    assert.match(body, /multaiplayer_relay_envelopes_published_total 0/);
    assert.match(body, /multaiplayer_relay_websocket_connection_attempts_total 0/);
    assert.match(body, /multaiplayer_relay_start_time_seconds \d+/);
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

test("relay error responses always include a typed code", async () => {
  const relay = await startRelay();
  try {
    const response = await fetch(`${relay.baseUrl}/teams/missing/members`);
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error?: unknown; code?: unknown };
    assert.equal(typeof body.error, "string");
    assert.equal(body.code, "team_not_found");
  } finally {
    await relay.close();
  }
});

test("relay disables debug endpoints in every environment unless explicitly enabled", async () => {
  const productionRelay = await startRelay({ NODE_ENV: "production" });
  try {
    const disabled = await fetch(`${productionRelay.baseUrl}/debug/rooms`);
    assert.equal(disabled.status, 404);
    const expireDisabled = await fetch(`${productionRelay.baseUrl}/debug/invites/anything/expire`, {
      method: "POST"
    });
    assert.equal(expireDisabled.status, 404);
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
    const cookie = await createDebugSession(debugRelay.baseUrl, "github:maddiedreese", "maddiedreese");
    const created = await fetch(`${debugRelay.baseUrl}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
    });
    assert.equal(created.status, 201);
    const { invite } = (await created.json()) as { invite: { id: string } };
    const expired = await fetch(`${debugRelay.baseUrl}/debug/invites/${invite.id}/expire`, { method: "POST" });
    assert.equal(expired.status, 204);
    const rejected = await fetch(`${debugRelay.baseUrl}/invites/${invite.id}`);
    assert.equal(rejected.status, 410);
    assert.equal(((await rejected.json()) as { code?: string }).code, "invite_expired");
  } finally {
    await debugRelay.close();
  }
});

test("relay starts with an empty workspace when auth is explicitly disabled", async () => {
  const relay = await startRelay(
    {
      NODE_ENV: "production",
      MULTAIPLAYER_RELAY_REQUIRE_AUTH: "false"
    },
    emptyWorkspaceFixture()
  );
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
