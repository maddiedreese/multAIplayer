import { isRecord } from "@multaiplayer/protocol";
import type { createRelayAuthSessionManager } from "./auth/session.js";
import { isLiveAccountSession } from "./auth/account-mutation-transaction.js";
import type { loadRelayConfig } from "./config.js";
import { hasDeviceSession } from "./http/device-auth.js";
import type { createRelayRequestGuards } from "./http/middleware.js";
import { isJsonStringifiableWithin, normalizeMetadataText, type RelayLimits } from "./limits.js";
import type { createRelayMetrics } from "./observability.js";
import { canPublishMlsMessage, roomKey } from "./relay-domain.js";
import type { RelayStore } from "./state.js";
import { registerRelayWebSocketConnection } from "./ws/connection.js";
import type { createRelayFanout } from "./ws/fanout.js";
import type { createRelayRoomSocketManager } from "./ws/rooms.js";

interface RegisterRelayWebSocketAdapterOptions {
  config: ReturnType<typeof loadRelayConfig>;
  store: RelayStore;
  limits: RelayLimits;
  auth: ReturnType<typeof createRelayAuthSessionManager>;
  guards: ReturnType<typeof createRelayRequestGuards>;
  metrics: ReturnType<typeof createRelayMetrics>;
  fanout: ReturnType<typeof createRelayFanout>;
  roomManager: ReturnType<typeof createRelayRoomSocketManager>;
  wss: Parameters<typeof registerRelayWebSocketConnection>[0]["transport"]["wss"];
  isReady: () => boolean;
}

export function registerRelayWebSocketAdapter(options: RegisterRelayWebSocketAdapterOptions) {
  const { config, store, roomManager, fanout } = options;
  registerRelayWebSocketConnection({
    transport: { wss: options.wss, send: fanout.send, isReady: options.isReady },
    state: { store, sessions: store.sessions, roomPresence: store.roomPresence },
    limits: options.limits,
    authentication: {
      getAuthSessionFromRequest: options.auth.getAuthSessionFromRequest,
      isLiveClientSession: (session) =>
        !config.mutationsRequireAuth ||
        Boolean(session.authSession && isLiveAccountSession(store, session.authSession)),
      clientIdentityFromIncomingMessage: options.guards.clientIdentityFromIncomingMessage,
      clientRateLimitIdentitiesFromIncomingMessage: options.guards.clientRateLimitIdentitiesFromIncomingMessage
    },
    rateLimiting: {
      consume: options.guards.consumeRateLimit,
      connectionCaps: config.websocketConnectionCaps
    },
    metrics: {
      recordQuotaRejection: options.metrics.recordQuotaRejection,
      recordCapacityRejection: options.metrics.recordCapacityRejection,
      recordRateLimitRejection: options.metrics.recordRateLimitRejection,
      recordRateLimitAllowed: options.metrics.recordRateLimitAllowed,
      recordConnectionAttempt: options.metrics.recordWebSocketConnectionAttempt,
      recordConnectionAccepted: options.metrics.recordWebSocketConnectionAccepted,
      recordConnectionRejection: options.metrics.recordWebSocketConnectionRejection
    },
    rooms: {
      roomKey,
      isKnownRoom: roomManager.isKnownRoom,
      canAuthenticateJoinIdentity: roomManager.canAuthenticateJoinIdentity,
      canJoinRoom: roomManager.canJoinRoom,
      hasDeviceSession: (token, userId, deviceId) =>
        !config.mutationsRequireAuth ||
        (config.debugEndpointsEnabled && token === "debug-device-session-token-000000") ||
        hasDeviceSession(store, token, userId, deviceId),
      joinRoom: roomManager.joinRoom,
      canSubscribeTeam: roomManager.canSubscribeTeam,
      subscribeTeam: roomManager.subscribeTeam,
      hasTeam: (teamId) => store.hasTeam(teamId),
      canSubscribeWorkspace: roomManager.canSubscribeWorkspace,
      subscribeWorkspace: roomManager.subscribeWorkspace,
      canPublishMlsMessage,
      canAccessRoom: options.roomManager.canAccessRoom,
      publishMlsMessage: (message, remainsAuthorized) => fanout.publishMlsMessage(message, remainsAuthorized),
      publishPresence: fanout.publishPresence,
      leaveRoom: roomManager.leaveRoom,
      leaveTeams: roomManager.leaveTeams,
      leaveWorkspace: roomManager.leaveWorkspace
    },
    validation: { normalizeMetadataText, isJsonStringifiableWithin, isRecord }
  });
}
