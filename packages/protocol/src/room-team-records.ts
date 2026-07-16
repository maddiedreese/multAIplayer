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
  maxTeamNameChars
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

export const RoomRecord = z
  .object({
    id: RoomId,
    teamId: TeamId,
    acceptedMlsEpoch: z.number().int().nonnegative().optional(),
    name: z.string().min(1).max(maxRoomNameChars),
    host: z.string().min(1).max(maxDisplayNameChars),
    hostUserId: UserId.optional(),
    activeHostDeviceId: DeviceId.optional(),
    hostStatus: z.enum(["active", "offline"]),
    approvalPolicy: z.enum(["ask_every_turn", "never_host"]),
    archivedAt: z.string().datetime().optional(),
    deletedAt: z.string().datetime().optional()
  })
  .refine((room) => room.hostStatus !== "active" || Boolean(room.hostUserId), {
    message: "An active room requires a stable host user id",
    path: ["hostUserId"]
  });

/** Member-only room configuration. This shape must never be accepted or persisted by the relay. */
export const RoomConfig = z.object({
  projectPath: z.string().min(1).max(maxRoomProjectPathChars),
  codexModel: z.string().min(1).max(maxCodexModelChars),
  codexModelPolicy: z.enum(["auto", "pinned"]),
  codexReasoningEffort: z.enum(codexReasoningEffortIds),
  codexReasoningEffortPolicy: z.enum(["auto", "pinned"]),
  codexRawReasoningEnabled: z.boolean(),
  codexSpeed: z.enum(["standard", "fast"]),
  codexServiceTierPolicy: z.enum(["auto", "pinned"]),
  codexSandboxLevel: z.enum(["read_only", "workspace_write", "workspace_write_network", "danger_full_access"]),
  configRevision: z.number().int().nonnegative(),
  configEpoch: z.number().int().nonnegative(),
  configPending: z.boolean()
});

/** Desktop projection of public relay metadata plus local read state and authenticated MLS configuration. */
export const ClientRoomRecord = RoomRecord.safeExtend({
  ...RoomConfig.shape,
  unread: z.number().int().nonnegative()
});

export const InviteRecord = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  teamId: TeamId,
  roomId: RoomId,
  creatorUserId: UserId.optional(),
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
export type RoomRecord = z.infer<typeof RoomRecord>;
export type RoomConfig = z.infer<typeof RoomConfig>;
export type ClientRoomRecord = z.infer<typeof ClientRoomRecord>;
export type InviteRecord = z.infer<typeof InviteRecord>;
export type InviteJoinRequestRecord = z.infer<typeof InviteJoinRequestRecord>;
export type InviteResponseRecord = z.infer<typeof InviteResponseRecord>;
export type AttachmentBlobRecord = z.infer<typeof AttachmentBlobRecord>;
