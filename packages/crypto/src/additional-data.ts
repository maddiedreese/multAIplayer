import { RoomEnvelopeMetadata, type RoomEnvelopeMetadata as RoomEnvelopeMetadataType } from "@multaiplayer/protocol";
import { canonicalAuthenticatedRecord } from "./canonical.js";
import type { AttachmentCryptoContext, DeviceCryptoContext, LocalCryptoContext } from "./types.js";

const encoder = new TextEncoder();

// mutation-policy:start attachment-aad
export function attachmentAdditionalData(context: AttachmentCryptoContext): Uint8Array {
  if (
    !context.teamId ||
    !context.roomId ||
    !context.name ||
    !context.type ||
    !Number.isSafeInteger(context.size) ||
    context.size < 0
  ) {
    throw new Error("Invalid attachment crypto context");
  }
  return canonicalAuthenticatedRecord("multaiplayer:attachment:v2", 1, {
    teamId: context.teamId,
    roomId: context.roomId,
    name: context.name,
    type: context.type,
    size: context.size
  });
}

export function legacyAttachmentAdditionalData(context: AttachmentCryptoContext): Uint8Array {
  return encoder.encode(JSON.stringify({ domain: "multaiplayer:attachment:v2", ...context }));
}
// mutation-policy:end attachment-aad

// mutation-policy:start device-context-aad
export function wrapAdditionalData(context: DeviceCryptoContext): Uint8Array {
  return cryptoContextAdditionalData("multaiplayer:room-secret-wrap:v2", context);
}

export function deviceSealAdditionalData(context: DeviceCryptoContext): Uint8Array {
  return cryptoContextAdditionalData("multaiplayer:device-sealed-json:v2", context);
}

export function cryptoContextAdditionalData(domain: string, context: DeviceCryptoContext): Uint8Array {
  validateDeviceCryptoContext(context);
  return canonicalAuthenticatedRecord(domain, 1, {
    purpose: context.purpose,
    teamId: context.teamId,
    roomId: context.roomId,
    senderUserId: context.senderUserId,
    senderDeviceId: context.senderDeviceId,
    recipientDeviceId: context.recipientDeviceId,
    operationId: context.operationId ?? null,
    requestId: context.requestId ?? null,
    requestNonce: context.requestNonce ?? null,
    keyEpoch: context.keyEpoch ?? null,
    previousEpoch: context.previousEpoch ?? null,
    newEpoch: context.newEpoch ?? null
  });
}

export function validateDeviceCryptoContext(context: DeviceCryptoContext): void {
  if (!context.teamId) throw new Error("Device crypto context teamId must be non-empty");
  if (!context.roomId) throw new Error("Device crypto context roomId must be non-empty");
  if (!context.senderUserId) throw new Error("Device crypto context senderUserId must be non-empty");
  if (!context.senderDeviceId) throw new Error("Device crypto context senderDeviceId must be non-empty");
  if (!context.recipientDeviceId) throw new Error("Device crypto context recipientDeviceId must be non-empty");
  if (!(["invite-request", "invite-response", "room-key-rotation"] as const).includes(context.purpose)) {
    throw new Error("Unsupported device crypto context purpose");
  }
  for (const [name, epoch] of [
    ["keyEpoch", context.keyEpoch],
    ["previousEpoch", context.previousEpoch],
    ["newEpoch", context.newEpoch]
  ] as const) {
    if (epoch != null && (!Number.isSafeInteger(epoch) || epoch < 1)) {
      throw new Error(`Device crypto context ${name} must be a positive safe integer`);
    }
  }
}

export function legacyCryptoContextAdditionalData(domain: string, context: DeviceCryptoContext): Uint8Array {
  validateDeviceCryptoContext(context);
  return encoder.encode(
    JSON.stringify({
      domain,
      purpose: context.purpose,
      teamId: context.teamId,
      roomId: context.roomId,
      senderUserId: context.senderUserId,
      senderDeviceId: context.senderDeviceId,
      recipientDeviceId: context.recipientDeviceId,
      operationId: context.operationId ?? null,
      requestId: context.requestId ?? null,
      requestNonce: context.requestNonce ?? null,
      keyEpoch: context.keyEpoch ?? null,
      previousEpoch: context.previousEpoch ?? null,
      newEpoch: context.newEpoch ?? null
    })
  );
}
// mutation-policy:end device-context-aad

// mutation-policy:start authenticated-wrap-authorization
export function authenticatedWrapAdditionalData(context: DeviceCryptoContext): Uint8Array {
  if (context.purpose === "invite-response") {
    if (!context.requestId) throw new Error("Invite response wrap requires a requestId");
    if (!context.requestNonce) throw new Error("Invite response wrap requires a requestNonce");
    if (context.keyEpoch == null) throw new Error("Invite response wrap requires a keyEpoch");
  } else if (context.purpose === "room-key-rotation") {
    if (!context.operationId) throw new Error("Rotation wrap requires an operationId");
    if (context.previousEpoch == null) throw new Error("Rotation wrap requires a previousEpoch");
    if (context.newEpoch !== context.previousEpoch + 1)
      throw new Error("Rotation wrap requires newEpoch to immediately follow previousEpoch");
    if (context.keyEpoch !== context.previousEpoch)
      throw new Error("Rotation wrap requires keyEpoch to equal previousEpoch");
  } else {
    throw new Error("Authenticated room-secret wraps require an invite response or room-key rotation context");
  }
  return cryptoContextAdditionalData("multaiplayer:authenticated-room-secret-wrap:v2", context);
}
// mutation-policy:end authenticated-wrap-authorization
// mutation-policy:start room-envelope-aad
export function roomEnvelopeAdditionalData(metadata: RoomEnvelopeMetadataType): Uint8Array {
  const value = RoomEnvelopeMetadata.parse(metadata);
  return canonicalAuthenticatedRecord("multaiplayer:room-envelope:v2", 1, value);
}

export function legacyRoomEnvelopeAdditionalData(metadata: RoomEnvelopeMetadataType): Uint8Array {
  const value = RoomEnvelopeMetadata.parse(metadata);
  return encoder.encode(JSON.stringify({ domain: "multaiplayer:room-envelope:v2", ...value }));
}
// mutation-policy:end room-envelope-aad

// mutation-policy:start local-aad
export function localAdditionalData(context: LocalCryptoContext): Uint8Array {
  if (context.purpose !== "room-history" && context.purpose !== "room-secret-backup")
    throw new Error("Unsupported local crypto context purpose");
  if (!context.roomId) throw new Error("Local crypto context roomId must be non-empty");
  if (!context.savedAt) throw new Error("Local crypto context savedAt must be non-empty");
  if (!Number.isSafeInteger(context.keyEpoch) || context.keyEpoch < 1)
    throw new Error("Local crypto context keyEpoch must be a positive safe integer");
  return canonicalAuthenticatedRecord("multaiplayer:local-json:v2", 1, {
    purpose: context.purpose,
    roomId: context.roomId,
    keyEpoch: context.keyEpoch,
    savedAt: context.savedAt
  });
}

export function legacyLocalAdditionalData(context: LocalCryptoContext): Uint8Array {
  return encoder.encode(JSON.stringify({ domain: "multaiplayer:local-json:v2", ...context }));
}
// mutation-policy:end local-aad
