import type { IncomingMessage } from "node:http";
import type { WebSocketServer } from "ws";
import {
  RelayClientMessage,
  type RelayEnvelope,
  type RelayServerMessage
} from "@multaiplayer/protocol";
import type { AuthSession, ClientSession, PresenceRecord, RoomKey } from "../state.js";

type RateLimitResult = { allowed: boolean };

interface RegisterRelayWebSocketConnectionOptions {
  wss: WebSocketServer;
  sessions: Map<ClientSession["socket"], ClientSession>;
  encryptedBacklog: Map<RoomKey, RelayEnvelope[]>;
  roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  encryptedEnvelopeMaxBytes: number;
  maxDisplayNameChars: number;
  maxDeviceIdChars: number;
  maxEnvelopeCiphertextChars: number;
  maxEnvelopeIdChars: number;
  maxEnvelopeNonceChars: number;
  maxPublicKeyFingerprintChars: number;
  maxPublicKeyJwkChars: number;
  maxRoomProjectPathChars: number;
  maxUserIdChars: number;
  getAuthSessionFromRequest: (request: IncomingMessage) => AuthSession | undefined;
  clientIdentityFromIncomingMessage: (request: IncomingMessage) => string;
  consumeRateLimit: (bucket: "websocket", clientId: string) => RateLimitResult;
  send: (socket: ClientSession["socket"], message: RelayServerMessage) => void;
  roomKey: (teamId: string, roomId: string) => RoomKey;
  isKnownRoom: (teamId: string, roomId: string) => boolean;
  canJoinRoom: (session: ClientSession, teamId: string, roomId: string, userId: string, inviteId?: string) => boolean;
  joinRoom: (session: ClientSession, teamId: string, roomId: string, userId: string, deviceId: string) => void;
  canSubscribeTeam: (session: ClientSession, teamId: string, userId: string) => boolean;
  subscribeTeam: (session: ClientSession, teamId: string) => void;
  hasTeam: (teamId: string) => boolean;
  canSubscribeWorkspace: (session: ClientSession, userId: string) => boolean;
  subscribeWorkspace: (session: ClientSession) => void;
  canPublishEnvelope: (session: ClientSession, envelope: RelayEnvelope) => boolean;
  isAllowedEnvelopePayload: (envelope: RelayEnvelope) => boolean;
  publishEnvelope: (envelope: RelayEnvelope) => void;
  publishPresence: (session: ClientSession, teamId: string, roomId: string, presence: PresenceRecord) => void;
  leaveRoom: (session: ClientSession) => void;
  leaveTeams: (session: ClientSession) => void;
  leaveWorkspace: (session: ClientSession) => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  isJsonStringifiableWithin: (value: unknown, maxChars: number) => boolean;
  isRecord: (value: unknown) => value is Record<string, unknown>;
}

export function registerRelayWebSocketConnection({
  wss,
  sessions,
  encryptedBacklog,
  roomPresence,
  encryptedEnvelopeMaxBytes,
  maxDisplayNameChars,
  maxDeviceIdChars,
  maxEnvelopeCiphertextChars,
  maxEnvelopeIdChars,
  maxEnvelopeNonceChars,
  maxPublicKeyFingerprintChars,
  maxPublicKeyJwkChars,
  maxRoomProjectPathChars,
  maxUserIdChars,
  getAuthSessionFromRequest,
  clientIdentityFromIncomingMessage,
  consumeRateLimit,
  send,
  roomKey,
  isKnownRoom,
  canJoinRoom,
  joinRoom,
  canSubscribeTeam,
  subscribeTeam,
  hasTeam,
  canSubscribeWorkspace,
  subscribeWorkspace,
  canPublishEnvelope,
  isAllowedEnvelopePayload,
  publishEnvelope,
  publishPresence,
  leaveRoom,
  leaveTeams,
  leaveWorkspace,
  normalizeMetadataText,
  isJsonStringifiableWithin,
  isRecord
}: RegisterRelayWebSocketConnectionOptions) {
  function isRelayEnvelopeWithinLimits(envelope: RelayEnvelope): boolean {
    if (!normalizeMetadataText(envelope.id, maxEnvelopeIdChars)) return false;
    if (!normalizeMetadataText(envelope.senderUserId, maxUserIdChars)) return false;
    if (!normalizeMetadataText(envelope.senderDeviceId, maxDeviceIdChars)) return false;
    if (!normalizeMetadataText(envelope.payload.nonce, maxEnvelopeNonceChars)) return false;
    if (!envelope.payload.ciphertext || envelope.payload.ciphertext.length > maxEnvelopeCiphertextChars) return false;
    if (envelope.payload.algorithm === "ECDH-P256-HKDF-SHA256-AES-GCM-256") {
      if (!isJsonStringifiableWithin(envelope.payload.ephemeralPublicKeyJwk, maxPublicKeyJwkChars)) return false;
    }
    return Buffer.byteLength(JSON.stringify(envelope), "utf8") <= encryptedEnvelopeMaxBytes;
  }

  function isBoundedSocketIdentity(userId: string, deviceId: string): boolean {
    return Boolean(
      normalizeMetadataText(userId, maxUserIdChars) &&
      normalizeMetadataText(deviceId, maxDeviceIdChars)
    );
  }

  function isPresenceWithinLimits(presence: PresenceRecord): boolean {
    if (!normalizeMetadataText(presence.displayName, maxDisplayNameChars)) return false;
    if (presence.avatarUrl !== undefined && !normalizeMetadataText(presence.avatarUrl, maxRoomProjectPathChars)) return false;
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
    if (message.type === "publish" && isRecord(message.envelope)) {
      const envelope = message.envelope;
      if (
        typeof envelope.id === "string" &&
        typeof envelope.senderUserId === "string" &&
        typeof envelope.senderDeviceId === "string" &&
        isRecord(envelope.payload) &&
        typeof envelope.payload.nonce === "string" &&
        typeof envelope.payload.ciphertext === "string" &&
        (
          !normalizeMetadataText(envelope.id, maxEnvelopeIdChars) ||
          !normalizeMetadataText(envelope.senderUserId, maxUserIdChars) ||
          !normalizeMetadataText(envelope.senderDeviceId, maxDeviceIdChars) ||
          !normalizeMetadataText(envelope.payload.nonce, maxEnvelopeNonceChars) ||
          !envelope.payload.ciphertext ||
          envelope.payload.ciphertext.length > maxEnvelopeCiphertextChars ||
          Buffer.byteLength(JSON.stringify(envelope), "utf8") > encryptedEnvelopeMaxBytes
        )
      ) {
        return `Encrypted room envelope exceeds relay limits (${encryptedEnvelopeMaxBytes} bytes max).`;
      }
    }
    if (message.type === "presence") {
      if (
        typeof message.displayName === "string" &&
        !normalizeMetadataText(message.displayName, maxDisplayNameChars)
      ) {
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
    const session: ClientSession = {
      socket,
      authSession: getAuthSessionFromRequest(request),
      rateClientId: clientIdentityFromIncomingMessage(request),
      subscribedTeamIds: new Set<string>(),
      workspaceSubscribed: false
    };
    sessions.set(socket, session);

    socket.on("message", (raw) => {
      try {
        if (!consumeRateLimit("websocket", session.rateClientId).allowed) {
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
        if (parsed.type === "join") {
          if (!isBoundedSocketIdentity(parsed.userId, parsed.deviceId)) {
            send(socket, { type: "error", message: "WebSocket user and device ids must be bounded strings without control characters." });
            return;
          }
          if (parsed.inviteId && !normalizeMetadataText(parsed.inviteId, maxEnvelopeIdChars)) {
            send(socket, { type: "error", message: "Invite id must be a bounded string without control characters." });
            return;
          }
          if (!isKnownRoom(parsed.teamId, parsed.roomId)) {
            send(socket, { type: "error", message: "Room not found" });
            return;
          }
          if (!canJoinRoom(session, parsed.teamId, parsed.roomId, parsed.userId, parsed.inviteId)) {
            send(socket, { type: "error", message: "Sign in and use a valid invite before joining this room." });
            return;
          }
          joinRoom(session, parsed.teamId, parsed.roomId, parsed.userId, parsed.deviceId);
          send(socket, { type: "joined", teamId: parsed.teamId, roomId: parsed.roomId });
          for (const envelope of encryptedBacklog.get(roomKey(parsed.teamId, parsed.roomId)) ?? []) {
            send(socket, { type: "envelope", envelope });
          }
          for (const presence of roomPresence.get(roomKey(parsed.teamId, parsed.roomId))?.values() ?? []) {
            send(socket, { type: "presence", ...presence, status: "online" });
          }
          return;
        }

        if (parsed.type === "subscribe.team") {
          if (!isBoundedSocketIdentity(parsed.userId, parsed.deviceId)) {
            send(socket, { type: "error", message: "WebSocket user and device ids must be bounded strings without control characters." });
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
            send(socket, { type: "error", message: "WebSocket user and device ids must be bounded strings without control characters." });
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
          if (!canPublishEnvelope(session, parsed.envelope)) {
            send(socket, { type: "error", message: "Join the room before publishing with this user and device." });
            return;
          }
          if (!isAllowedEnvelopePayload(parsed.envelope)) {
            send(socket, { type: "error", message: "Device-sealed envelopes are only supported for room invites." });
            return;
          }
          if (!isRelayEnvelopeWithinLimits(parsed.envelope)) {
            send(socket, { type: "error", message: `Encrypted room envelope exceeds relay limits (${encryptedEnvelopeMaxBytes} bytes max).` });
            return;
          }
          publishEnvelope(parsed.envelope);
          return;
        }

        if (!isPresenceForJoinedSession(session, parsed)) {
          send(socket, { type: "error", message: "Join the room before publishing presence with this user and device." });
          return;
        }
        if (!isPresenceWithinLimits(parsed)) {
          send(socket, { type: "error", message: "Presence display name, avatar URL, and fingerprint must be bounded strings without control characters." });
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
          message: error instanceof Error ? error.message : "Invalid relay message"
        });
      }
    });

    socket.on("close", () => {
      leaveRoom(session);
      leaveTeams(session);
      leaveWorkspace(session);
      sessions.delete(socket);
    });
  });
}
