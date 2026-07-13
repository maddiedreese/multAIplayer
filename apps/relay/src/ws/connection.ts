import type { IncomingMessage } from "node:http";
import type { WebSocketServer } from "ws";
import { RelayClientMessage, type MlsRelayMessage, type RelayServerMessage } from "@multaiplayer/protocol";
import { RelayPublishError } from "./fanout.js";
import type { AuthSession, ClientSession, PresenceRecord, RelayStore, RoomKey } from "../state.js";
import type { RelayLimits } from "../limits.js";
import { isCanonicalPaddedBase64 } from "../opaque.js";

type RateLimitResult = { allowed: boolean };
type WebSocketRateLimitBucket = "websocket" | "websocketConnect";

interface RegisterRelayWebSocketConnectionOptions {
  transport: {
    wss: WebSocketServer;
    send: (socket: ClientSession["socket"], message: RelayServerMessage) => void;
    isReady?: () => boolean;
  };
  state: {
    store: Pick<RelayStore, "getMlsBacklog">;
    sessions: Map<ClientSession["socket"], ClientSession>;
    roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  };
  limits: RelayLimits;
  authentication: {
    getAuthSessionFromRequest: (request: IncomingMessage) => AuthSession | undefined;
    clientIdentityFromIncomingMessage: (request: IncomingMessage) => string;
  };
  rateLimiting: {
    consume: (bucket: WebSocketRateLimitBucket, clientId: string) => RateLimitResult;
    connectionCaps: {
      perUser: number;
      perDevice: number;
    };
  };
  metrics: {
    recordQuotaRejection?: (type: string) => void;
    recordRateLimitRejection?: (bucket: string) => void;
    recordConnectionAttempt?: () => void;
    recordConnectionAccepted?: () => void;
    recordConnectionRejection?: (reason: string) => void;
  };
  rooms: {
    roomKey: (teamId: string, roomId: string) => RoomKey;
    isKnownRoom: (teamId: string, roomId: string) => boolean;
    canJoinRoom: (
      session: ClientSession,
      teamId: string,
      roomId: string,
      userId: string,
      deviceId: string,
      inviteId?: string
    ) => boolean;
    hasDeviceSession: (token: string, userId: string, deviceId: string) => boolean;
    joinRoom: (session: ClientSession, teamId: string, roomId: string, userId: string, deviceId: string) => void;
    canSubscribeTeam: (session: ClientSession, teamId: string, userId: string) => boolean;
    subscribeTeam: (session: ClientSession, teamId: string) => void;
    hasTeam: (teamId: string) => boolean;
    canSubscribeWorkspace: (session: ClientSession, userId: string) => boolean;
    subscribeWorkspace: (session: ClientSession) => void;
    canPublishMlsMessage: (session: ClientSession, message: MlsRelayMessage) => boolean;
    publishMlsMessage: (message: MlsRelayMessage) => Promise<void>;
    publishPresence: (session: ClientSession, teamId: string, roomId: string, presence: PresenceRecord) => void;
    leaveRoom: (session: ClientSession) => void;
    leaveTeams: (session: ClientSession) => void;
    leaveWorkspace: (session: ClientSession) => void;
  };
  validation: {
    normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
    isJsonStringifiableWithin: (value: unknown, maxChars: number) => boolean;
    isRecord: (value: unknown) => value is Record<string, unknown>;
  };
}

export function registerRelayWebSocketConnection(options: RegisterRelayWebSocketConnectionOptions) {
  const { wss, send, isReady = () => true } = options.transport;
  const { store, sessions, roomPresence } = options.state;
  const {
    mlsMessageMaxBytes,
    maxDisplayNameChars,
    maxDeviceIdChars,
    maxMlsMessageChars,
    maxEnvelopeIdChars,
    maxPublicKeyFingerprintChars,
    maxRoomProjectPathChars,
    maxUserIdChars
  } = options.limits;
  const { getAuthSessionFromRequest, clientIdentityFromIncomingMessage } = options.authentication;
  const { consume: consumeRateLimit, connectionCaps: websocketConnectionCaps } = options.rateLimiting;
  const {
    recordQuotaRejection,
    recordRateLimitRejection,
    recordConnectionAttempt,
    recordConnectionAccepted,
    recordConnectionRejection
  } = options.metrics;
  const {
    roomKey,
    isKnownRoom,
    canJoinRoom,
    hasDeviceSession,
    joinRoom,
    canSubscribeTeam,
    subscribeTeam,
    hasTeam,
    canSubscribeWorkspace,
    subscribeWorkspace,
    canPublishMlsMessage,
    publishMlsMessage,
    publishPresence,
    leaveRoom,
    leaveTeams,
    leaveWorkspace
  } = options.rooms;
  const { normalizeMetadataText, isRecord } = options.validation;
  function socketConnectionQuotaError(session: ClientSession): string | null {
    const userConnectionId = session.authSession?.user.id ?? session.rateClientId;
    const deviceConnectionId = session.deviceId ? `${userConnectionId}:${session.deviceId}` : null;
    let userConnections = 0;
    let deviceConnections = 0;

    for (const existing of sessions.values()) {
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

    if (userConnections >= websocketConnectionCaps.perUser) {
      recordQuotaRejection?.("websocket_connections_per_user");
      return `Concurrent WebSocket connection quota exceeded for this user (${websocketConnectionCaps.perUser} max).`;
    }
    if (deviceConnectionId && deviceConnections >= websocketConnectionCaps.perDevice) {
      recordQuotaRejection?.("websocket_connections_per_device");
      return `Concurrent WebSocket connection quota exceeded for this device (${websocketConnectionCaps.perDevice} max).`;
    }
    return null;
  }

  function isMlsMessageWithinLimits(message: MlsRelayMessage): boolean {
    if (!normalizeMetadataText(message.id, maxEnvelopeIdChars)) return false;
    if (!normalizeMetadataText(message.senderUserId, maxUserIdChars)) return false;
    if (!normalizeMetadataText(message.senderDeviceId, maxDeviceIdChars)) return false;
    if (!isCanonicalPaddedBase64(message.mlsMessage, maxMlsMessageChars)) return false;
    return Buffer.byteLength(JSON.stringify(message), "utf8") <= mlsMessageMaxBytes;
  }

  function isBoundedSocketIdentity(userId: string, deviceId: string): boolean {
    return Boolean(normalizeMetadataText(userId, maxUserIdChars) && normalizeMetadataText(deviceId, maxDeviceIdChars));
  }

  function isPresenceWithinLimits(presence: PresenceRecord): boolean {
    if (!normalizeMetadataText(presence.displayName, maxDisplayNameChars)) return false;
    if (presence.avatarUrl !== undefined && !normalizeMetadataText(presence.avatarUrl, maxRoomProjectPathChars))
      return false;
    if (
      presence.publicKeyFingerprint !== undefined &&
      !normalizeMetadataText(presence.publicKeyFingerprint, maxPublicKeyFingerprintChars)
    ) {
      return false;
    }
    return true;
  }

  function isPresenceForJoinedSession(
    session: ClientSession,
    presence: Pick<PresenceRecord, "teamId" | "roomId" | "userId" | "deviceId">
  ): boolean {
    return (
      session.teamId === presence.teamId &&
      session.roomId === presence.roomId &&
      session.userId === presence.userId &&
      session.deviceId === presence.deviceId
    );
  }

  function relayClientMessagePreflightError(message: unknown): string | null {
    if (!isRecord(message) || typeof message.type !== "string") return null;
    if (message.type === "join" || message.type === "subscribe.team" || message.type === "subscribe.workspace") {
      if (
        typeof message.userId === "string" &&
        typeof message.deviceId === "string" &&
        !isBoundedSocketIdentity(message.userId, message.deviceId)
      ) {
        return "WebSocket user and device ids must be bounded strings without control characters.";
      }
      return null;
    }
    if (message.type === "publish" && isRecord(message.message)) {
      const envelope = message.message;
      if (
        typeof envelope.id === "string" &&
        typeof envelope.senderUserId === "string" &&
        typeof envelope.senderDeviceId === "string" &&
        typeof envelope.mlsMessage === "string" &&
        (!normalizeMetadataText(envelope.id, maxEnvelopeIdChars) ||
          !normalizeMetadataText(envelope.senderUserId, maxUserIdChars) ||
          !normalizeMetadataText(envelope.senderDeviceId, maxDeviceIdChars) ||
          !envelope.mlsMessage ||
          envelope.mlsMessage.length > maxMlsMessageChars ||
          Buffer.byteLength(JSON.stringify(envelope), "utf8") > mlsMessageMaxBytes)
      ) {
        return `MLS message exceeds relay limits (${mlsMessageMaxBytes} bytes max).`;
      }
    }
    if (message.type === "presence") {
      if (typeof message.displayName === "string" && !normalizeMetadataText(message.displayName, maxDisplayNameChars)) {
        return "Presence display name, avatar URL, and fingerprint must be bounded strings without control characters.";
      }
      if (
        message.avatarUrl !== undefined &&
        typeof message.avatarUrl === "string" &&
        !normalizeMetadataText(message.avatarUrl, maxRoomProjectPathChars)
      ) {
        return "Presence display name, avatar URL, and fingerprint must be bounded strings without control characters.";
      }
      if (
        message.publicKeyFingerprint !== undefined &&
        typeof message.publicKeyFingerprint === "string" &&
        !normalizeMetadataText(message.publicKeyFingerprint, maxPublicKeyFingerprintChars)
      ) {
        return "Presence display name, avatar URL, and fingerprint must be bounded strings without control characters.";
      }
    }
    return null;
  }

  wss.on("connection", (socket, request) => {
    recordConnectionAttempt?.();
    if (!isReady()) {
      recordConnectionRejection?.("not_ready");
      send(socket, { type: "error", message: "Relay is shutting down. Reconnect to another relay instance." });
      socket.close(1012, "Relay shutting down");
      return;
    }
    const rateClientId = clientIdentityFromIncomingMessage(request);
    if (!consumeRateLimit("websocketConnect", rateClientId).allowed) {
      recordRateLimitRejection?.("websocketConnect");
      recordConnectionRejection?.("rate_limit");
      send(socket, {
        type: "error",
        message: "WebSocket connection rate limit exceeded. Slow down before reconnecting."
      });
      socket.close(1008, "WebSocket connection rate limit exceeded");
      return;
    }
    const session: ClientSession = {
      socket,
      authSession: getAuthSessionFromRequest(request),
      rateClientId,
      subscribedTeamIds: new Set<string>(),
      workspaceSubscribed: false
    };
    const initialQuotaError = socketConnectionQuotaError(session);
    if (initialQuotaError) {
      recordConnectionRejection?.("quota_initial");
      send(socket, { type: "error", message: initialQuotaError });
      socket.close(1008, "WebSocket connection quota exceeded");
      return;
    }
    sessions.set(socket, session);
    recordConnectionAccepted?.();

    let messageChain = Promise.resolve();
    socket.on("message", (raw) => {
      messageChain = messageChain.then(async () => {
        let publishMessageId: string | undefined;
        try {
          if (!consumeRateLimit("websocket", session.rateClientId).allowed) {
            recordRateLimitRejection?.("websocket");
            send(socket, { type: "error", message: "Rate limit exceeded. Slow down before sending more room events." });
            return;
          }
          const rawMessage = JSON.parse(raw.toString());
          const preflightError = relayClientMessagePreflightError(rawMessage);
          if (preflightError) {
            send(socket, { type: "error", message: preflightError });
            return;
          }
          const parsed = RelayClientMessage.parse(rawMessage);
          publishMessageId = parsed.type === "publish" ? parsed.message.id : undefined;
          if (parsed.type === "join") {
            if (!isBoundedSocketIdentity(parsed.userId, parsed.deviceId)) {
              send(socket, {
                type: "error",
                message: "WebSocket user and device ids must be bounded strings without control characters."
              });
              return;
            }
            if (parsed.inviteId && !normalizeMetadataText(parsed.inviteId, maxEnvelopeIdChars)) {
              send(socket, {
                type: "error",
                message: "Invite id must be a bounded string without control characters."
              });
              return;
            }
            if (!isKnownRoom(parsed.teamId, parsed.roomId)) {
              send(socket, { type: "error", message: "Room not found" });
              return;
            }
            if (!canJoinRoom(session, parsed.teamId, parsed.roomId, parsed.userId, parsed.deviceId, parsed.inviteId)) {
              send(socket, { type: "error", message: "Sign in and use a valid invite before joining this room." });
              return;
            }
            if (!hasDeviceSession(parsed.deviceSessionToken ?? "", parsed.userId, parsed.deviceId)) {
              send(socket, {
                type: "error",
                message: "A device-authenticated session is required.",
                code: "not_joined"
              });
              return;
            }
            session.userId = parsed.userId;
            session.deviceId = parsed.deviceId;
            session.deviceSessionToken = parsed.deviceSessionToken ?? "development-auth-disabled";
            const quotaError = socketConnectionQuotaError(session);
            if (quotaError) {
              recordConnectionRejection?.("quota_after_join");
              send(socket, { type: "error", message: quotaError });
              socket.close(1008, "WebSocket connection quota exceeded");
              return;
            }
            joinRoom(session, parsed.teamId, parsed.roomId, parsed.userId, parsed.deviceId);
            send(socket, { type: "joined", teamId: parsed.teamId, roomId: parsed.roomId });
            for (const message of store.getMlsBacklog(roomKey(parsed.teamId, parsed.roomId)) ?? []) {
              send(socket, { type: "mls.message", message });
            }
            for (const presence of roomPresence.get(roomKey(parsed.teamId, parsed.roomId))?.values() ?? []) {
              send(socket, { type: "presence", ...presence, status: "online" });
            }
            return;
          }

          if (parsed.type === "subscribe.team") {
            if (!isBoundedSocketIdentity(parsed.userId, parsed.deviceId)) {
              send(socket, {
                type: "error",
                message: "WebSocket user and device ids must be bounded strings without control characters."
              });
              return;
            }
            if (!hasTeam(parsed.teamId)) {
              send(socket, { type: "error", message: "Team not found" });
              return;
            }
            if (!canSubscribeTeam(session, parsed.teamId, parsed.userId)) {
              send(socket, { type: "error", message: "Join this team before subscribing to it." });
              return;
            }
            subscribeTeam(session, parsed.teamId);
            send(socket, { type: "team.subscribed", teamId: parsed.teamId });
            return;
          }

          if (parsed.type === "subscribe.workspace") {
            if (!isBoundedSocketIdentity(parsed.userId, parsed.deviceId)) {
              send(socket, {
                type: "error",
                message: "WebSocket user and device ids must be bounded strings without control characters."
              });
              return;
            }
            if (!canSubscribeWorkspace(session, parsed.userId)) {
              send(socket, { type: "error", message: "Sign in before subscribing to the workspace." });
              return;
            }
            subscribeWorkspace(session);
            send(socket, { type: "workspace.subscribed" });
            return;
          }

          if (parsed.type === "publish") {
            if (
              !session.userId ||
              !session.deviceId ||
              !session.deviceSessionToken ||
              !hasDeviceSession(session.deviceSessionToken, session.userId, session.deviceId)
            ) {
              send(socket, {
                type: "error",
                message: "Device session expired.",
                code: "not_joined",
                messageId: publishMessageId
              });
              return;
            }
            if (!canPublishMlsMessage(session, parsed.message)) {
              send(socket, {
                type: "error",
                message: "Join the room before publishing with this user and device.",
                messageId: publishMessageId
              });
              return;
            }
            if (!isMlsMessageWithinLimits(parsed.message)) {
              send(socket, {
                type: "error",
                message: `MLS message exceeds relay limits (${mlsMessageMaxBytes} bytes max).`,
                code: "message_too_large",
                messageId: publishMessageId
              });
              return;
            }
            await publishMlsMessage(parsed.message);
            send(socket, { type: "published", messageId: parsed.message.id });
            return;
          }

          if (!isPresenceForJoinedSession(session, parsed)) {
            send(socket, {
              type: "error",
              message: "Join the room before publishing presence with this user and device."
            });
            return;
          }
          if (!isPresenceWithinLimits(parsed)) {
            send(socket, {
              type: "error",
              message:
                "Presence display name, avatar URL, and fingerprint must be bounded strings without control characters."
            });
            return;
          }
          publishPresence(session, parsed.teamId, parsed.roomId, {
            teamId: parsed.teamId,
            roomId: parsed.roomId,
            userId: parsed.userId,
            deviceId: parsed.deviceId,
            displayName: parsed.displayName,
            avatarUrl: parsed.avatarUrl,
            publicKeyFingerprint: parsed.publicKeyFingerprint
          });
        } catch (error) {
          send(socket, {
            type: "error",
            message: error instanceof Error ? error.message : "Invalid relay message",
            code: error instanceof RelayPublishError ? error.code : undefined,
            messageId: publishMessageId
          });
        }
      });
    });

    socket.on("close", () => {
      leaveRoom(session);
      leaveTeams(session);
      leaveWorkspace(session);
      sessions.delete(socket);
    });
  });
}
