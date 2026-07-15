import type { IncomingMessage } from "node:http";
import type { ClientSession } from "../state.js";
import type { RelayWebSocketConnectionOptions } from "./connection-types.js";

export function socketConnectionQuotaError(
  options: RelayWebSocketConnectionOptions,
  session: ClientSession
): string | null {
  const userConnectionId = session.authSession?.user.id ?? session.rateClientId;
  const deviceConnectionId = session.deviceId ? `${userConnectionId}:${session.deviceId}` : null;
  let userConnections = 0;
  let deviceConnections = 0;

  for (const existing of options.state.sessions.values()) {
    if (existing.socket === session.socket) continue;
    const existingUserConnectionId = existing.authSession?.user.id ?? existing.rateClientId;
    if (existingUserConnectionId !== userConnectionId) continue;
    userConnections += 1;
    if (
      deviceConnectionId &&
      existing.deviceId &&
      `${existingUserConnectionId}:${existing.deviceId}` === deviceConnectionId
    ) {
      deviceConnections += 1;
    }
  }

  const caps = options.rateLimiting.connectionCaps;
  if (userConnections >= caps.perUser) {
    options.metrics.recordQuotaRejection?.("websocket_connections_per_user");
    return `Concurrent WebSocket connection quota exceeded for this user (${caps.perUser} max).`;
  }
  if (deviceConnectionId && deviceConnections >= caps.perDevice) {
    options.metrics.recordQuotaRejection?.("websocket_connections_per_device");
    return `Concurrent WebSocket connection quota exceeded for this device (${caps.perDevice} max).`;
  }
  return null;
}

export function admitRelayWebSocketConnection(
  options: RelayWebSocketConnectionOptions,
  socket: ClientSession["socket"],
  request: IncomingMessage
): ClientSession | null {
  const { send, isReady = () => true } = options.transport;
  options.metrics.recordConnectionAttempt?.();
  if (!isReady()) {
    options.metrics.recordConnectionRejection?.("not_ready");
    send(socket, { type: "error", message: "Relay is shutting down. Reconnect to another relay instance." });
    socket.close(1012, "Relay shutting down");
    return null;
  }

  const rateClientId = options.authentication.clientIdentityFromIncomingMessage(request);
  if (!options.rateLimiting.consume("websocketConnect", rateClientId).allowed) {
    options.metrics.recordRateLimitRejection?.("websocketConnect");
    options.metrics.recordConnectionRejection?.("rate_limit");
    send(socket, {
      type: "error",
      message: "WebSocket connection rate limit exceeded. Slow down before reconnecting."
    });
    socket.close(1008, "WebSocket connection rate limit exceeded");
    return null;
  }
  options.metrics.recordRateLimitAllowed?.("websocketConnect");

  const authSession = options.authentication.getAuthSessionFromRequest(request);
  const session: ClientSession = {
    socket,
    ...(authSession ? { authSession } : {}),
    rateClientId,
    subscribedTeamIds: new Set<string>(),
    workspaceSubscribed: false
  };
  const quotaError = socketConnectionQuotaError(options, session);
  if (quotaError) {
    options.metrics.recordConnectionRejection?.("quota_initial");
    send(socket, { type: "error", message: quotaError });
    socket.close(1008, "WebSocket connection quota exceeded");
    return null;
  }
  options.state.sessions.set(socket, session);
  options.metrics.recordConnectionAccepted?.();
  return session;
}
