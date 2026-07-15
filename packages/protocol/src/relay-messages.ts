import { z } from "zod";
import { PublicKeyFingerprint } from "./identity.js";
import {
  DeviceId,
  RoomId,
  TeamId,
  UserId,
  maxDisplayNameChars,
  maxEnvelopeIdChars,
  maxMediumTextChars,
  maxUrlChars
} from "./limits-ids.js";
import { RoomRecord, TeamRecord } from "./room-team-records.js";

/** Protocol v2 pins MLS_128_DHKEMP256_AES128GCM_SHA256_P256. */
export const pinnedMlsCiphersuite = 0x0002 as const;

export const MlsMessageType = z.enum(["application", "commit"]);
const CanonicalPaddedBase64 = z
  .string()
  .min(4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const HostTransferAuthorization = z
  .object({
    version: z.literal(2),
    transferId: z.string().min(1).max(maxEnvelopeIdChars),
    roomId: RoomId,
    commitMessageId: z.string().regex(/^[0-9a-f]{64}$/),
    parentEpoch: z.number().int().nonnegative(),
    outgoingHostUserId: UserId,
    outgoingHostDeviceId: DeviceId,
    nextHostUserId: UserId,
    nextHostDeviceId: DeviceId,
    nextHostLeaf: z.number().int().nonnegative(),
    signatureDer: CanonicalPaddedBase64,
    publicKeySpkiDer: CanonicalPaddedBase64
  })
  .strict();

/**
 * Relay-visible routing metadata. `mlsMessage` is an opaque, base64-encoded
 * RFC 9420 MLSMessage. The relay never parses authenticated data or plaintext.
 */
export const MlsRelayMessage = z
  .object({
    id: z.string().min(1).max(maxEnvelopeIdChars),
    teamId: TeamId,
    roomId: RoomId,
    senderDeviceId: DeviceId,
    senderUserId: UserId,
    createdAt: z.string().datetime(),
    messageType: MlsMessageType,
    epochHint: z.number().int().nonnegative(),
    mlsMessage: CanonicalPaddedBase64,
    commitEffect: z.literal("host_handoff").optional(),
    nextHostUserId: UserId.optional(),
    nextHostDeviceId: DeviceId.optional(),
    hostTransferAuthorization: HostTransferAuthorization.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const handoff = value.commitEffect === "host_handoff";
    if (
      handoff !== Boolean(value.nextHostUserId && value.nextHostDeviceId && value.hostTransferAuthorization) ||
      (handoff && value.messageType !== "commit")
    ) {
      ctx.addIssue({ code: "custom", message: "Host handoff metadata requires a Commit and both next-host ids." });
    }
  });

export const KeyPackageUpload = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  keyPackage: z.string().min(1),
  keyPackageHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  ciphersuite: z.literal(pinnedMlsCiphersuite)
});

export const KeyPackageRecord = KeyPackageUpload.extend({
  userId: UserId,
  deviceId: DeviceId,
  credentialIdentity: z.string().min(1),
  createdAt: z.string().datetime()
});

export const PresenceMessage = z.object({
  type: z.literal("presence"),
  teamId: TeamId,
  roomId: RoomId,
  userId: UserId,
  deviceId: DeviceId,
  displayName: z.string().min(1).max(maxDisplayNameChars),
  avatarUrl: z.string().max(maxUrlChars).optional(),
  publicKeyFingerprint: PublicKeyFingerprint.optional()
});

export const RelayClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    teamId: TeamId,
    roomId: RoomId,
    userId: UserId,
    deviceId: DeviceId,
    inviteId: z.string().min(1).max(maxEnvelopeIdChars).optional(),
    deviceSessionToken: z.string().min(32).max(256).optional()
  }),
  z.object({ type: z.literal("subscribe.team"), teamId: TeamId, userId: UserId, deviceId: DeviceId }),
  z.object({ type: z.literal("subscribe.workspace"), userId: UserId, deviceId: DeviceId }),
  z.object({ type: z.literal("publish"), message: MlsRelayMessage }),
  PresenceMessage
]);

export const RelayErrorCode = z.enum([
  "invalid_message",
  "message_too_large",
  "not_joined",
  "not_active_host",
  "stale_epoch",
  "application_epoch_expired",
  "key_package_invalid",
  "key_package_unavailable"
]);

export const RelayServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("joined"), teamId: TeamId, roomId: RoomId }),
  z.object({ type: z.literal("team.subscribed"), teamId: TeamId }),
  z.object({ type: z.literal("workspace.subscribed") }),
  z.object({
    type: z.literal("invite.requested"),
    inviteId: z.string().min(1).max(maxEnvelopeIdChars),
    requestId: z.string().min(1).max(maxEnvelopeIdChars)
  }),
  z.object({ type: z.literal("published"), messageId: z.string().min(1).max(maxEnvelopeIdChars) }),
  z.object({ type: z.literal("mls.message"), message: MlsRelayMessage }),
  z.object({
    type: z.literal("presence"),
    teamId: TeamId,
    roomId: RoomId,
    userId: UserId,
    deviceId: DeviceId,
    displayName: z.string().min(1).max(maxDisplayNameChars),
    avatarUrl: z.string().max(maxUrlChars).optional(),
    publicKeyFingerprint: PublicKeyFingerprint.optional(),
    status: z.enum(["online", "offline"])
  }),
  z.object({ type: z.literal("room.updated"), room: RoomRecord }),
  z.object({ type: z.literal("team.updated"), team: TeamRecord }),
  z.object({
    type: z.literal("error"),
    message: z.string().max(maxMediumTextChars),
    code: RelayErrorCode.optional(),
    messageId: z.string().min(1).max(maxEnvelopeIdChars).optional()
  })
]);

export type MlsRelayMessage = z.infer<typeof MlsRelayMessage>;
export type KeyPackageUpload = z.infer<typeof KeyPackageUpload>;
export type KeyPackageRecord = z.infer<typeof KeyPackageRecord>;
export type PresenceMessage = z.infer<typeof PresenceMessage>;
export type RelayClientMessage = z.infer<typeof RelayClientMessage>;
export type RelayServerMessage = z.infer<typeof RelayServerMessage>;
