import { z } from "zod";
import { CiphertextPayload, DevicePublicKeyJwk } from "./crypto-payloads.js";
import {
  DeviceId,
  RoomId,
  TeamId,
  UserId,
  maxCodexModelChars,
  maxDisplayNameChars,
  maxEnvelopeIdChars,
  maxProjectPathChars,
  maxShortTextChars,
  maxUrlChars
} from "./limits-ids.js";

export const TeamRole = z.enum(["owner", "admin", "member"]);

export const TeamRecord = z.object({
  id: TeamId,
  name: z.string().min(1).max(maxDisplayNameChars),
  members: z.number().int().nonnegative(),
  role: TeamRole.optional(),
  archivedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().optional()
});

export const TeamMemberRecord = z.object({
  teamId: TeamId,
  userId: UserId,
  role: TeamRole,
  joinedAt: z.string().datetime()
});

export const DeviceRecord = z.object({
  userId: UserId,
  deviceId: DeviceId,
  displayName: z.string().min(1).max(maxDisplayNameChars),
  publicKeyJwk: DevicePublicKeyJwk,
  publicKeyFingerprint: z.string().min(16).max(maxShortTextChars),
  registeredAt: z.string().datetime(),
  lastSeenAt: z.string().datetime()
});

export const RoomModeSchema = z.object({
  chat: z.boolean(),
  code: z.boolean(),
  workspace: z.boolean(),
  browser: z.boolean()
});

export const RoomRecord = z.object({
  id: RoomId,
  teamId: TeamId,
  name: z.string().min(1).max(maxDisplayNameChars),
  projectPath: z.string().min(1).max(maxProjectPathChars),
  host: z.string().min(1).max(maxDisplayNameChars),
  hostUserId: UserId.optional(),
  hostStatus: z.enum(["active", "offline", "handoff"]),
  approvalPolicy: z.enum([
    "ask_every_turn",
    "auto_chat_only",
    "auto_browser_allowed_sites",
    "never_host"
  ]),
  approvalDelegationPolicy: z.enum([
    "host_only",
    "members_can_request",
    "members_can_approve",
    "trusted_members_only"
  ]),
  trustedApproverUserIds: z.array(UserId).max(50),
  mode: RoomModeSchema,
  codexModel: z.string().min(1).max(maxCodexModelChars),
  codexReasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  codexSpeed: z.enum(["standard", "fast"]).optional(),
  codexSandboxLevel: z.enum(["read_only", "workspace_write", "workspace_write_network", "danger_full_access"]).optional(),
  browserAllowedOrigins: z.array(z.string().min(1).max(maxUrlChars)).max(20),
  browserProfilePersistent: z.boolean(),
  unread: z.number().int().nonnegative(),
  archivedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().optional()
});

export const InviteRecord = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  teamId: TeamId,
  roomId: RoomId,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional()
});

export const AttachmentBlobRecord = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  teamId: TeamId,
  roomId: RoomId,
  name: z.string().min(1).max(maxShortTextChars),
  type: z.string().min(1).max(maxShortTextChars),
  size: z.number().int().nonnegative(),
  uploadedByUserId: UserId.optional(),
  payload: CiphertextPayload,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional()
});

export type TeamRole = z.infer<typeof TeamRole>;
export type TeamRecord = z.infer<typeof TeamRecord>;
export type TeamMemberRecord = z.infer<typeof TeamMemberRecord>;
export type DeviceRecord = z.infer<typeof DeviceRecord>;
export type RoomModeSchema = z.infer<typeof RoomModeSchema>;
export type RoomRecord = z.infer<typeof RoomRecord>;
export type InviteRecord = z.infer<typeof InviteRecord>;
export type AttachmentBlobRecord = z.infer<typeof AttachmentBlobRecord>;
