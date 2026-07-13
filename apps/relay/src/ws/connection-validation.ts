import { RelayClientMessage, type MlsRelayMessage } from "@multaiplayer/protocol";
import { isCanonicalPaddedBase64 } from "../opaque.js";
import type { ClientSession, PresenceRecord } from "../state.js";
import type { RelayWebSocketConnectionOptions } from "./connection-types.js";

export function isBoundedSocketIdentity(
  options: RelayWebSocketConnectionOptions,
  userId: string,
  deviceId: string
): boolean {
  const { maxUserIdChars, maxDeviceIdChars } = options.limits;
  return Boolean(
    options.validation.normalizeMetadataText(userId, maxUserIdChars) &&
    options.validation.normalizeMetadataText(deviceId, maxDeviceIdChars)
  );
}

export function isMlsMessageWithinLimits(options: RelayWebSocketConnectionOptions, message: MlsRelayMessage): boolean {
  const { mlsMessageMaxBytes, maxDeviceIdChars, maxEnvelopeIdChars, maxMlsMessageChars, maxUserIdChars } =
    options.limits;
  const normalize = options.validation.normalizeMetadataText;
  if (!normalize(message.id, maxEnvelopeIdChars)) return false;
  if (!normalize(message.senderUserId, maxUserIdChars)) return false;
  if (!normalize(message.senderDeviceId, maxDeviceIdChars)) return false;
  if (!isCanonicalPaddedBase64(message.mlsMessage, maxMlsMessageChars)) return false;
  return Buffer.byteLength(JSON.stringify(message), "utf8") <= mlsMessageMaxBytes;
}

export function isPresenceWithinLimits(options: RelayWebSocketConnectionOptions, presence: PresenceRecord): boolean {
  const { maxDisplayNameChars, maxPublicKeyFingerprintChars, maxRoomProjectPathChars } = options.limits;
  const normalize = options.validation.normalizeMetadataText;
  if (!normalize(presence.displayName, maxDisplayNameChars)) return false;
  if (presence.avatarUrl !== undefined && !normalize(presence.avatarUrl, maxRoomProjectPathChars)) return false;
  if (
    presence.publicKeyFingerprint !== undefined &&
    !normalize(presence.publicKeyFingerprint, maxPublicKeyFingerprintChars)
  ) {
    return false;
  }
  return true;
}

export function isPresenceForJoinedSession(
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

export function parseRelayClientMessage(
  options: RelayWebSocketConnectionOptions,
  raw: { toString(): string }
): { message?: RelayClientMessage; preflightError?: string } {
  const rawMessage: unknown = JSON.parse(raw.toString());
  const preflightError = relayClientMessagePreflightError(options, rawMessage);
  if (preflightError) return { preflightError };
  return { message: RelayClientMessage.parse(rawMessage) };
}

function relayClientMessagePreflightError(options: RelayWebSocketConnectionOptions, message: unknown): string | null {
  const { isRecord, normalizeMetadataText: normalize } = options.validation;
  const {
    mlsMessageMaxBytes,
    maxDeviceIdChars,
    maxDisplayNameChars,
    maxEnvelopeIdChars,
    maxMlsMessageChars,
    maxPublicKeyFingerprintChars,
    maxRoomProjectPathChars,
    maxUserIdChars
  } = options.limits;
  if (!isRecord(message) || typeof message.type !== "string") return null;
  if (message.type === "join" || message.type === "subscribe.team" || message.type === "subscribe.workspace") {
    if (
      typeof message.userId === "string" &&
      typeof message.deviceId === "string" &&
      !isBoundedSocketIdentity(options, message.userId, message.deviceId)
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
      (!normalize(envelope.id, maxEnvelopeIdChars) ||
        !normalize(envelope.senderUserId, maxUserIdChars) ||
        !normalize(envelope.senderDeviceId, maxDeviceIdChars) ||
        !envelope.mlsMessage ||
        envelope.mlsMessage.length > maxMlsMessageChars ||
        Buffer.byteLength(JSON.stringify(envelope), "utf8") > mlsMessageMaxBytes)
    ) {
      return `MLS message exceeds relay limits (${mlsMessageMaxBytes} bytes max).`;
    }
  }
  if (message.type === "presence") {
    if (typeof message.displayName === "string" && !normalize(message.displayName, maxDisplayNameChars)) {
      return presenceLimitError;
    }
    if (
      message.avatarUrl !== undefined &&
      typeof message.avatarUrl === "string" &&
      !normalize(message.avatarUrl, maxRoomProjectPathChars)
    ) {
      return presenceLimitError;
    }
    if (
      message.publicKeyFingerprint !== undefined &&
      typeof message.publicKeyFingerprint === "string" &&
      !normalize(message.publicKeyFingerprint, maxPublicKeyFingerprintChars)
    ) {
      return presenceLimitError;
    }
  }
  return null;
}

export const presenceLimitError =
  "Presence display name, avatar URL, and fingerprint must be bounded strings without control characters.";
