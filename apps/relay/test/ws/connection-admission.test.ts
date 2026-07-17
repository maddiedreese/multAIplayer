import assert from "node:assert/strict";
import test from "node:test";
import { admitRelayWebSocketConnection, socketConnectionQuotaError } from "../../src/ws/connection-admission.js";
import type { RelayWebSocketConnectionOptions } from "../../src/ws/connection-types.js";

function fixture(overrides: { ready?: boolean; allowed?: boolean; perUser?: number; perDevice?: number } = {}) {
  const sent: unknown[] = [];
  const closed: Array<[number, string]> = [];
  const sessions = new Map();
  const metrics: string[] = [];
  const socket = { close: (code: number, reason: string) => closed.push([code, reason]) };
  const options = {
    transport: {
      send: (_socket: unknown, message: unknown) => sent.push(message),
      isReady: () => overrides.ready ?? true
    },
    state: { sessions },
    authentication: {
      clientIdentityFromIncomingMessage: () => "ip:test",
      getAuthSessionFromRequest: () => undefined
    },
    rateLimiting: {
      consume: () => ({ allowed: overrides.allowed ?? true }),
      connectionCaps: { perUser: overrides.perUser ?? 2, perDevice: overrides.perDevice ?? 1 }
    },
    metrics: {
      recordConnectionAttempt: () => metrics.push("attempt"),
      recordConnectionAccepted: () => metrics.push("accepted"),
      recordConnectionRejection: (reason: string) => metrics.push(`rejected:${reason}`),
      recordRateLimitRejection: (bucket: string) => metrics.push(`limited:${bucket}`),
      recordRateLimitAllowed: (bucket: string) => metrics.push(`allowed:${bucket}`),
      recordQuotaRejection: (type: string) => metrics.push(`quota:${type}`)
    }
  } as unknown as RelayWebSocketConnectionOptions;
  return { options, socket, sent, closed, sessions, metrics };
}

test("WebSocket admission fails closed for shutdown and rate limits", () => {
  const shuttingDown = fixture({ ready: false });
  assert.equal(admitRelayWebSocketConnection(shuttingDown.options, shuttingDown.socket as never, {} as never), null);
  assert.deepEqual(shuttingDown.closed, [[1012, "Relay shutting down"]]);
  assert.deepEqual(shuttingDown.metrics, ["attempt", "rejected:not_ready"]);

  const limited = fixture({ allowed: false });
  assert.equal(admitRelayWebSocketConnection(limited.options, limited.socket as never, {} as never), null);
  assert.deepEqual(limited.closed, [[1008, "WebSocket connection rate limit exceeded"]]);
  assert.deepEqual(limited.metrics, ["attempt", "limited:websocketConnect", "rejected:rate_limit"]);
});

test("WebSocket admission records accepted sessions and enforces user/device quotas", () => {
  const accepted = fixture();
  const session = admitRelayWebSocketConnection(accepted.options, accepted.socket as never, {} as never);
  assert.ok(session);
  assert.equal(accepted.sessions.get(accepted.socket), session);
  assert.deepEqual(accepted.metrics, ["attempt", "allowed:websocketConnect", "accepted"]);

  const quota = fixture({ perUser: 1, perDevice: 1 });
  quota.sessions.set({ existing: true }, { socket: {}, rateClientId: "ip:test", subscribedTeamIds: new Set() });
  const candidate = {
    socket: quota.socket,
    rateClientId: "ip:test",
    subscribedTeamIds: new Set<string>(),
    workspaceSubscribed: false
  } as never;
  assert.match(socketConnectionQuotaError(quota.options, candidate) ?? "", /user \(1 max\)/);
  assert.deepEqual(quota.metrics, ["quota:websocket_connections_per_user"]);

  const deviceQuota = fixture({ perUser: 2, perDevice: 1 });
  deviceQuota.sessions.set(
    { existing: true },
    { socket: {}, rateClientId: "ip:test", deviceId: "device-1", subscribedTeamIds: new Set() }
  );
  const deviceCandidate = {
    socket: deviceQuota.socket,
    rateClientId: "ip:test",
    deviceId: "device-1",
    subscribedTeamIds: new Set<string>(),
    workspaceSubscribed: false
  } as never;
  assert.match(socketConnectionQuotaError(deviceQuota.options, deviceCandidate) ?? "", /device \(1 max\)/);
  assert.deepEqual(deviceQuota.metrics, ["quota:websocket_connections_per_device"]);
});

test("WebSocket admission consumes the bounded trusted-network bucket and strict session bucket", () => {
  const candidate = fixture();
  const consumed: string[] = [];
  candidate.options.authentication.clientRateLimitIdentitiesFromIncomingMessage = () => [
    "trusted-network:127.0.0.1",
    "session:trusted-digest"
  ];
  candidate.options.rateLimiting.consume = (_bucket, clientId) => {
    consumed.push(clientId);
    return { allowed: true };
  };
  assert.ok(admitRelayWebSocketConnection(candidate.options, candidate.socket as never, {} as never));
  assert.deepEqual(consumed, ["trusted-network:127.0.0.1", "session:trusted-digest"]);
  assert.deepEqual(candidate.sessions.get(candidate.socket)?.rateClientIds, [
    "trusted-network:127.0.0.1",
    "session:trusted-digest"
  ]);
});
