import { z } from "zod";
import { PublicKeyFingerprint } from "./identity.js";
import { codexReasoningEffortIds } from "./defaults-options.js";
import {
  DeviceId,
  RoomId,
  TeamId,
  UserId,
  maxAttachmentBlobIdChars,
  maxAttachmentBlobNameChars,
  maxAttachmentBlobTypeChars,
  maxCodexModelChars,
  maxDisplayNameChars,
  maxEnvelopeIdChars,
  maxRoomNameChars,
  maxRoomProjectPathChars,
  maxTeamNameChars,
  maxUrlChars
} from "./limits-ids.js";

export const TeamRole = z.enum(["owner", "admin", "member"]);

export const TeamRecord = z.object({
  id: TeamId,
  name: z.string().min(1).max(maxTeamNameChars),
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
  signaturePublicKey: z.string().min(1).max(4096),
  signatureKeyFingerprint: PublicKeyFingerprint,
  hpkePublicKey: z.string().min(1).max(4096),
  hpkeKeyFingerprint: PublicKeyFingerprint,
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
  acceptedMlsEpoch: z.number().int().nonnegative().optional(),
  name: z.string().min(1).max(maxRoomNameChars),
  projectPath: z.string().min(1).max(maxRoomProjectPathChars),
  host: z.string().min(1).max(maxDisplayNameChars),
  hostUserId: UserId.optional(),
  activeHostDeviceId: DeviceId.optional(),
  hostStatus: z.enum(["active", "offline", "handoff"]),
  approvalPolicy: z.enum(["ask_every_turn", "auto_chat_only", "auto_browser_allowed_sites", "never_host"]),
  approvalDelegationPolicy: z.enum(["host_only", "members_can_request", "members_can_approve", "trusted_members_only"]),
  trustedApproverUserIds: z.array(UserId).max(50),
  mode: RoomModeSchema,
  codexModel: z.string().min(1).max(maxCodexModelChars),
  codexModelPolicy: z.enum(["auto", "pinned"]).optional(),
  codexReasoningEffort: z.enum(codexReasoningEffortIds).optional(),
  codexReasoningEffortPolicy: z.enum(["auto", "pinned"]).optional(),
  codexSpeed: z.enum(["standard", "fast"]).optional(),
  codexServiceTierPolicy: z.enum(["auto", "pinned"]).optional(),
  codexSandboxLevel: z
    .enum(["read_only", "workspace_write", "workspace_write_network", "danger_full_access"])
    .optional(),
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
  approvedUserId: UserId.optional(),
  approvedDeviceId: DeviceId.optional(),
  keyPackageHash: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional()
});

export const InviteJoinRequestRecord = z.object({
  requestId: z.string().min(1).max(maxEnvelopeIdChars),
  inviteId: z.string().min(1).max(maxEnvelopeIdChars),
  requesterUserId: UserId,
  requesterDeviceId: DeviceId,
  keyPackageId: z.string().min(1).max(maxEnvelopeIdChars),
  keyPackageHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  sealedRequest: z.string().min(1),
  createdAt: z.string().datetime()
});

export const InviteResponseRecord = z
  .object({
    requestId: z.string().min(1).max(maxEnvelopeIdChars),
    inviteId: z.string().min(1).max(maxEnvelopeIdChars),
    requesterUserId: UserId,
    requesterDeviceId: DeviceId,
    keyPackageHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    status: z.enum(["approved", "denied"]),
    responseBinding: z
      .object({
        version: z.literal(3),
        phase: z.literal("response"),
        inviteId: z.string().min(1).max(maxEnvelopeIdChars),
        teamId: TeamId,
        roomId: RoomId,
        keyEpoch: z.number().int().nonnegative(),
        keyPackageHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        requestId: z.string().min(1).max(maxEnvelopeIdChars),
        requestNonce: z.string().min(1).max(maxEnvelopeIdChars),
        requesterUserId: UserId,
        requesterDeviceId: DeviceId,
        hostUserId: UserId,
        hostDeviceId: DeviceId,
        expiresAt: z.string().datetime(),
        status: z.enum(["approved", "denied"]),
        decidedAt: z.string().datetime()
      })
      .strict(),
    responseMac: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    welcome: z.string().min(1).optional(),
    createdAt: z.string().datetime()
  })
  .superRefine((value, ctx) => {
    if ((value.status === "approved") !== Boolean(value.welcome)) {
      ctx.addIssue({ code: "custom", message: "Approved responses require Welcome; denied responses forbid it." });
    }
  });

export const AttachmentBlobRecord = z.object({
  id: z.string().min(1).max(maxAttachmentBlobIdChars),
  teamId: TeamId,
  roomId: RoomId,
  name: z.string().min(1).max(maxAttachmentBlobNameChars),
  type: z.string().min(1).max(maxAttachmentBlobTypeChars),
  size: z.number().int().nonnegative(),
  uploadedByUserId: UserId.optional(),
  epoch: z.number().int().nonnegative(),
  sealedBlob: z.string().min(1),
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
export type InviteJoinRequestRecord = z.infer<typeof InviteJoinRequestRecord>;
export type InviteResponseRecord = z.infer<typeof InviteResponseRecord>;
export type AttachmentBlobRecord = z.infer<typeof AttachmentBlobRecord>;
