import { z } from "zod";
import { EncryptedPayload } from "./crypto-payloads.js";
import {
  DeviceId,
  RoomId,
  TeamId,
  UserId,
  maxDisplayNameChars,
  maxEnvelopeIdChars,
  maxMediumTextChars,
  maxShortTextChars,
  maxUrlChars
} from "./limits-ids.js";
import { RoomRecord, TeamRecord } from "./room-team-records.js";

export const RelayEnvelope = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  teamId: TeamId,
  roomId: RoomId,
  senderDeviceId: DeviceId,
  senderUserId: UserId,
  createdAt: z.string().datetime(),
  kind: z.enum([
    "chat.message",
    "chat.attachment",
    "chat.reaction",
    "chat.edit",
    "chat.delete",
    "codex.invoke",
    "codex.event",
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
  ]),
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
  publicKeyFingerprint: z.string().max(maxShortTextChars).optional()
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
    publicKeyFingerprint: z.string().max(maxShortTextChars).optional(),
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
export type PresenceMessage = z.infer<typeof PresenceMessage>;
export type RelayClientMessage = z.infer<typeof RelayClientMessage>;
export type RelayServerMessage = z.infer<typeof RelayServerMessage>;
