import { z } from "zod";
import { EncryptedPayload, PublicKeyFingerprint } from "./crypto-payloads.js";
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

export const RelayEnvelopeKind = z.enum([
  "chat.message",
  "chat.attachment",
  "chat.reaction",
  "chat.edit",
  "chat.delete",
  "codex.invoke",
  "codex.event",
  "codex.activity",
  "codex.approval",
  "codex.queue",
  "browser.request",
  "browser.event",
  "workspace.request",
  "workspace.event",
  "terminal.request",
  "terminal.event",
  "preview.event",
  "git.event",
  "room.presence",
  "room.invite",
  "room.host",
  "room.settings",
  "room.key"
]);

/** Metadata authenticated as AES-GCM additional data for every room payload. */
export const RoomEnvelopeMetadata = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  teamId: TeamId,
  roomId: RoomId,
  senderDeviceId: DeviceId,
  senderUserId: UserId,
  createdAt: z.string().datetime(),
  kind: RelayEnvelopeKind,
  keyEpoch: z.number().int().positive()
});

export const RelayEnvelope = RoomEnvelopeMetadata.extend({
  payload: EncryptedPayload
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
    inviteId: z.string().min(1).max(maxEnvelopeIdChars).optional()
  }),
  z.object({
    type: z.literal("subscribe.team"),
    teamId: TeamId,
    userId: UserId,
    deviceId: DeviceId
  }),
  z.object({
    type: z.literal("subscribe.workspace"),
    userId: UserId,
    deviceId: DeviceId
  }),
  z.object({
    type: z.literal("publish"),
    envelope: RelayEnvelope
  }),
  PresenceMessage
]);

export const RelayServerMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("joined"),
    teamId: TeamId,
    roomId: RoomId
  }),
  z.object({
    type: z.literal("team.subscribed"),
    teamId: TeamId
  }),
  z.object({
    type: z.literal("workspace.subscribed")
  }),
  z.object({
    type: z.literal("published"),
    envelopeId: z.string().min(1).max(maxEnvelopeIdChars)
  }),
  z.object({
    type: z.literal("envelope"),
    envelope: RelayEnvelope
  }),
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
  z.object({
    type: z.literal("room.updated"),
    room: RoomRecord
  }),
  z.object({
    type: z.literal("team.updated"),
    team: TeamRecord
  }),
  z.object({
    type: z.literal("error"),
    message: z.string().max(maxMediumTextChars)
  })
]);

export type RelayEnvelope = z.infer<typeof RelayEnvelope>;
export type RelayEnvelopeKind = z.infer<typeof RelayEnvelopeKind>;
export type RoomEnvelopeMetadata = z.infer<typeof RoomEnvelopeMetadata>;
export type PresenceMessage = z.infer<typeof PresenceMessage>;
export type RelayClientMessage = z.infer<typeof RelayClientMessage>;
export type RelayServerMessage = z.infer<typeof RelayServerMessage>;
