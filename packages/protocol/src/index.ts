import { z } from "zod";

export const maxRelayIdChars = 160;
export const relayIdPattern = /^[A-Za-z0-9_-]+$/;
export const TeamId = z.string().min(3).max(maxRelayIdChars).regex(relayIdPattern);
export const RoomId = z.string().min(3).max(maxRelayIdChars).regex(relayIdPattern);
export const maxEnvelopeIdChars = 160;
export const maxDeviceIdChars = 160;
export const maxUserIdChars = 160;
export const maxDisplayNameChars = 120;
export const maxShortTextChars = 512;
export const maxMediumTextChars = 4_096;
export const maxLongTextChars = 120_000;
export const maxCiphertextNonceChars = 4_096;
export const maxCiphertextPayloadChars = 70_000_000;
export const maxProjectPathChars = 2_048;
export const maxUrlChars = 2_048;
export const maxCodexModelChars = 80;
export const maxCodexThreadIdChars = 512;
export const maxTerminalSnapshots = 20;
export const maxGitWorkflowResults = 20;
export const maxGitHubActionRuns = 20;
export const maxWrappedCiphertextChars = 4_096;
export const maxRoomSecretRawKeyChars = 128;
export const publicKeyCoordinatePattern = /^[A-Za-z0-9_-]+$/;
export const DeviceId = z.string().min(8).max(maxDeviceIdChars);
export const UserId = z.string().min(1).max(maxUserIdChars);

export const DevicePublicKeyJwk = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string().min(1).max(128).regex(publicKeyCoordinatePattern),
  y: z.string().min(1).max(128).regex(publicKeyCoordinatePattern)
}).passthrough().refine((jwk) => !("d" in jwk), {
  message: "Device public key JWK must not include private key material"
});

export const CiphertextPayload = z.object({
  algorithm: z.literal("AES-GCM-256"),
  nonce: z.string().min(1).max(maxCiphertextNonceChars),
  ciphertext: z.string().min(1).max(maxCiphertextPayloadChars)
});

export const DeviceSealedPayload = z.object({
  algorithm: z.literal("ECDH-P256-HKDF-SHA256-AES-GCM-256"),
  ephemeralPublicKeyJwk: DevicePublicKeyJwk,
  nonce: z.string().min(1).max(maxCiphertextNonceChars),
  ciphertext: z.string().min(1).max(maxWrappedCiphertextChars)
});

export const EncryptedPayload = z.union([CiphertextPayload, DeviceSealedPayload]);

export const maxMessageAttachments = 5;
export const maxEmbeddedAttachmentBytes = 80_000;
export const maxEmbeddedAttachmentBytesPerMessage = 200_000;

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
    "codex.invoke",
    "codex.event",
    "codex.approval",
    "browser.request",
    "browser.event",
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

export const ChatPlaintextPayload = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  author: z.string().min(1).max(maxDisplayNameChars),
  role: z.enum(["human", "codex", "system"]),
  body: z.string().max(maxLongTextChars),
  time: z.string().min(1).max(maxShortTextChars),
  createdAt: z.string().datetime().optional(),
  attachments: z.array(z.object({
    id: z.string().min(1).max(maxEnvelopeIdChars),
    name: z.string().min(1).max(maxShortTextChars),
    type: z.string().min(1).max(maxShortTextChars),
    size: z.number().int().nonnegative(),
    content: z.string().max(maxEmbeddedAttachmentBytes).optional(),
    blobId: z.string().min(1).max(maxEnvelopeIdChars).optional(),
    blobBytes: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional()
  })).max(maxMessageAttachments).optional()
});

export const ChatReactionPlaintextPayload = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  messageId: z.string().min(1).max(maxEnvelopeIdChars),
  emoji: z.string().min(1).max(16),
  action: z.enum(["add", "remove"]),
  reactor: z.string().min(1).max(maxDisplayNameChars),
  reactorUserId: z.string().min(1).max(maxUserIdChars),
  createdAt: z.string().datetime()
});

export const LocalPreviewPlaintextPayload = z.object({
  eventType: z.literal("local.preview"),
  id: z.string().min(1).max(maxEnvelopeIdChars),
  sharedBy: z.string().min(1).max(maxDisplayNameChars),
  sharedByUserId: z.string().min(1).max(maxUserIdChars),
  sourceUrl: z.string().min(1).max(maxUrlChars),
  publicUrl: z.string().min(1).max(maxUrlChars).optional(),
  status: z.enum(["starting", "live", "stopped", "error"]),
  message: z.string().max(maxMediumTextChars).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const TerminalRequestPlaintextPayload = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  requester: z.string().min(1).max(maxDisplayNameChars),
  requesterUserId: z.string().min(1).max(maxUserIdChars),
  command: z.string().min(1).max(maxMediumTextChars),
  cwd: z.string().min(1).max(maxProjectPathChars),
  requestedAt: z.string().datetime()
});

export const BrowserRequestPlaintextPayload = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  requester: z.string().min(1).max(maxDisplayNameChars),
  requesterUserId: z.string().min(1).max(maxUserIdChars),
  url: z.string().min(1).max(maxUrlChars),
  reason: z.string().max(maxMediumTextChars),
  requestedAt: z.string().datetime()
});

export const RequestStatusPlaintextPayload = z.object({
  requestId: z.string().min(1).max(maxEnvelopeIdChars),
  status: z.enum(["approved", "denied"]),
  decidedBy: z.string().min(1).max(maxDisplayNameChars),
  decidedByUserId: z.string().min(1).max(maxUserIdChars),
  decidedAt: z.string().datetime()
});

export const InviteJoinRequestPlaintextPayload = z.object({
  eventType: z.literal("invite.request"),
  id: z.string().min(1).max(maxEnvelopeIdChars),
  inviteId: z.string().min(1).max(maxEnvelopeIdChars).optional(),
  requester: z.string().min(1).max(maxDisplayNameChars),
  requesterUserId: z.string().min(1).max(maxUserIdChars),
  requesterDeviceId: DeviceId,
  requesterPublicKeyJwk: DevicePublicKeyJwk.optional(),
  requesterPublicKeyFingerprint: z.string().min(16).max(maxShortTextChars).optional(),
  requestedAt: z.string().datetime(),
  note: z.string().max(maxMediumTextChars).optional()
});

export const WrappedRoomSecretPayload = z.object({
  version: z.literal(1),
  algorithm: z.literal("ECDH-P256-HKDF-SHA256-AES-GCM-256"),
  ephemeralPublicKeyJwk: DevicePublicKeyJwk,
  nonce: z.string().min(1).max(maxCiphertextNonceChars),
  ciphertext: z.string().min(1).max(maxWrappedCiphertextChars)
});

export const InviteJoinStatusPlaintextPayload = z.object({
  eventType: z.literal("invite.status"),
  requestId: z.string().min(1).max(maxEnvelopeIdChars),
  status: z.enum(["approved", "denied"]),
  decidedBy: z.string().min(1).max(maxDisplayNameChars),
  decidedByUserId: z.string().min(1).max(maxUserIdChars),
  decidedAt: z.string().datetime(),
  recipientDeviceId: DeviceId.optional(),
  recipientPublicKeyFingerprint: z.string().min(16).max(maxShortTextChars).optional(),
  wrappedRoomSecret: WrappedRoomSecretPayload.optional()
});

export const RoomSecretPayload = z.object({
  algorithm: z.literal("AES-GCM-256"),
  rawKey: z.string().min(1).max(maxRoomSecretRawKeyChars)
});

export const RoomKeyRotationPlaintextPayload = z.object({
  eventType: z.literal("room.key.rotated"),
  id: z.string().min(1).max(maxEnvelopeIdChars),
  rotatedBy: z.string().min(1).max(maxDisplayNameChars),
  rotatedByUserId: z.string().min(1).max(maxUserIdChars),
  rotatedAt: z.string().datetime(),
  newSecret: RoomSecretPayload,
  note: z.string().max(maxMediumTextChars).optional()
});

export const CodexEventPlaintextPayload = z.object({
  eventType: z.literal("codex.turn"),
  turnId: z.string().min(1).max(maxEnvelopeIdChars),
  status: z.enum(["started", "event", "completed", "failed"]),
  message: z.string().max(maxLongTextChars),
  model: z.string().min(1).max(maxCodexModelChars),
  threadId: z.string().min(1).max(maxCodexThreadIdChars).optional(),
  eventName: z.string().min(1).max(maxShortTextChars).optional(),
  host: z.string().min(1).max(maxDisplayNameChars),
  hostUserId: z.string().min(1).max(maxUserIdChars),
  createdAt: z.string().datetime()
});

export const CodexApprovalPlaintextPayload = z.object({
  eventType: z.literal("codex.approval"),
  approvalId: z.string().min(1).max(maxEnvelopeIdChars),
  roomId: RoomId,
  approver: z.string().min(1).max(maxDisplayNameChars),
  approverUserId: z.string().min(1).max(maxUserIdChars),
  approvedAt: z.string().datetime(),
  delegationPolicy: z.enum([
    "members_can_approve",
    "trusted_members_only"
  ]),
  message: z.string().max(maxMediumTextChars).optional()
});

export const TerminalResultPlaintextPayload = z.object({
  eventType: z.literal("terminal.result"),
  requestId: z.string().min(1).max(maxEnvelopeIdChars),
  command: z.string().min(1).max(maxMediumTextChars),
  cwd: z.string().min(1).max(maxProjectPathChars),
  exitStatus: z.number().int().nullable(),
  stdout: z.string().max(maxLongTextChars),
  stderr: z.string().max(maxLongTextChars),
  error: z.string().max(maxMediumTextChars).optional(),
  ranBy: z.string().min(1).max(maxDisplayNameChars),
  ranByUserId: z.string().min(1).max(maxUserIdChars),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime()
});

export const GitWorkflowEventPlaintextPayload = z.object({
  eventType: z.literal("git.workflow"),
  status: z.enum(["started", "completed", "failed", "pr_opened"]),
  branch: z.string().min(1).max(maxShortTextChars),
  push: z.boolean(),
  message: z.string().max(maxMediumTextChars),
  runner: z.string().min(1).max(maxDisplayNameChars),
  runnerUserId: z.string().min(1).max(maxUserIdChars),
  createdAt: z.string().datetime(),
  results: z.array(z.object({
    command: z.string().min(1).max(maxMediumTextChars),
    cwd: z.string().min(1).max(maxProjectPathChars),
    status: z.number().int().nullable(),
    stdout: z.string().max(maxLongTextChars),
    stderr: z.string().max(maxLongTextChars)
  })).max(maxGitWorkflowResults).optional(),
  pullRequest: z.object({
    number: z.number().int(),
    url: z.string().min(1).max(maxUrlChars)
  }).optional()
});

export const GitHubActionsEventPlaintextPayload = z.object({
  eventType: z.literal("github.actions"),
  owner: z.string().min(1).max(maxShortTextChars),
  repo: z.string().min(1).max(maxShortTextChars),
  branch: z.string().min(1).max(maxShortTextChars),
  summary: z.object({
    label: z.string().max(maxShortTextChars),
    detail: z.string().max(maxMediumTextChars),
    tone: z.enum(["green", "yellow", "red", "dark", "muted"])
  }),
  message: z.string().max(maxMediumTextChars),
  checkedBy: z.string().min(1).max(maxDisplayNameChars),
  checkedByUserId: z.string().min(1).max(maxUserIdChars),
  checkedAt: z.string().datetime(),
  runs: z.array(z.object({
    id: z.number().int(),
    name: z.string().max(maxShortTextChars),
    displayTitle: z.string().max(maxShortTextChars).optional(),
    runNumber: z.number().int().optional(),
    workflowId: z.number().int().optional(),
    status: z.string().max(maxShortTextChars),
    conclusion: z.string().max(maxShortTextChars).nullable(),
    branch: z.string().max(maxShortTextChars).optional(),
    headSha: z.string().max(maxShortTextChars).optional(),
    event: z.string().max(maxShortTextChars).optional(),
    url: z.string().min(1).max(maxUrlChars),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })).max(maxGitHubActionRuns)
});

export const HostHandoffPlaintextPayload = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  fromHost: z.string().min(1).max(maxDisplayNameChars),
  fromUserId: z.string().min(1).max(maxUserIdChars),
  reason: z.enum(["manual", "usage_limit"]).optional(),
  projectPath: z.string().min(1).max(maxProjectPathChars),
  gitRemoteUrl: z.string().min(1).max(maxUrlChars).optional(),
  gitRepoOwner: z.string().min(1).max(maxShortTextChars).optional(),
  gitRepoName: z.string().min(1).max(maxShortTextChars).optional(),
  gitBranch: z.string().min(1).max(maxShortTextChars).optional(),
  gitDirtyFiles: z.array(z.string().min(1).max(maxShortTextChars)).max(50).optional(),
  gitPatch: z.string().max(maxLongTextChars).optional(),
  gitPatchTruncated: z.boolean().optional(),
  codexModel: z.string().min(1).max(maxCodexModelChars),
  approvalPolicy: z.string().min(1).max(maxShortTextChars),
  messagesSinceLastCodex: z.number().int().nonnegative(),
  attachmentNames: z.array(z.string().min(1).max(maxShortTextChars)).max(maxMessageAttachments),
  terminals: z.array(z.string().min(1).max(maxShortTextChars)).max(maxTerminalSnapshots),
  continuationSummary: z.string().max(maxMediumTextChars).optional(),
  createdAt: z.string().datetime(),
  status: z.enum(["available", "accepted"]).optional(),
  acceptedBy: z.string().min(1).max(maxDisplayNameChars).optional(),
  acceptedByUserId: z.string().min(1).max(maxUserIdChars).optional(),
  acceptedAt: z.string().datetime().optional()
});

export const RoomSettingsPlaintextPayload = z.object({
  eventType: z.literal("room.settings"),
  id: z.string().min(1).max(maxEnvelopeIdChars),
  setting: z.enum([
    "roomName",
    "approvalPolicy",
    "approvalDelegationPolicy",
    "trustedApprovers",
    "roomMode",
    "codexModel",
    "codexReasoningEffort",
    "codexSpeed",
    "projectPath",
    "browserAllowedOrigins",
    "browserProfilePersistent"
  ]),
  previousValue: z.string().max(maxMediumTextChars),
  nextValue: z.string().max(maxMediumTextChars),
  changedBy: z.string().min(1).max(maxDisplayNameChars),
  changedByUserId: z.string().min(1).max(maxUserIdChars),
  changedAt: z.string().datetime()
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

export type ApprovalPolicy =
  | "ask_every_turn"
  | "auto_chat_only"
  | "auto_browser_allowed_sites"
  | "never_host";

export type ApprovalDelegationPolicy =
  | "host_only"
  | "members_can_request"
  | "members_can_approve"
  | "trusted_members_only";

export const defaultApprovalDelegationPolicy: ApprovalDelegationPolicy = "host_only";
export const defaultCodexModel = "gpt-5.5";
export const defaultCodexReasoningEffort = "medium";
export const defaultCodexSpeed = "standard";
export const defaultBrowserAllowedOrigins = ["https://github.com"];
export const defaultBrowserProfilePersistent = true;

export const codexModelOptions = [
  { id: "gpt-5.5", label: "GPT-5.5", description: "Frontier model for complex coding, research, and real-world work." },
  { id: "gpt-5.4", label: "GPT-5.4", description: "High-capability Codex host model" },
  { id: "gpt-5.4-mini", label: "GPT-5.4-Mini", description: "Faster Codex turns for lighter room tasks" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark", description: "Older Codex model for compatibility testing" }
] as const;

export const codexReasoningEffortOptions = [
  { id: "low", label: "Low", description: "Fast responses with lighter reasoning" },
  { id: "medium", label: "Medium", description: "Balances speed and reasoning depth for everyday tasks" },
  { id: "high", label: "High", description: "Greater reasoning depth for complex problems" },
  { id: "xhigh", label: "Extra high", description: "Extra high reasoning depth for complex problems" }
] as const;

export const codexSpeedOptions = [
  { id: "standard", label: "Standard", serviceTier: "default", description: "Default Codex speed and usage behavior" },
  { id: "fast", label: "Fast", serviceTier: "priority", description: "Priority tier for faster Codex turns when available" }
] as const;

export type CodexReasoningEffort = typeof codexReasoningEffortOptions[number]["id"];
export type CodexSpeed = typeof codexSpeedOptions[number]["id"];

export const TeamRole = z.enum(["owner", "admin", "member"]);

export const TeamRecord = z.object({
  id: TeamId,
  name: z.string().min(1).max(maxDisplayNameChars),
  members: z.number().int().nonnegative(),
  role: TeamRole.optional()
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
  codexReasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  codexSpeed: z.enum(["standard", "fast"]).optional(),
  browserAllowedOrigins: z.array(z.string().min(1).max(maxUrlChars)).max(20),
  browserProfilePersistent: z.boolean(),
  unread: z.number().int().nonnegative()
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
  payload: CiphertextPayload,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional()
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

export type CiphertextPayload = z.infer<typeof CiphertextPayload>;
export type RelayEnvelope = z.infer<typeof RelayEnvelope>;
export type ChatPlaintextPayload = z.infer<typeof ChatPlaintextPayload>;
export type ChatReactionPlaintextPayload = z.infer<typeof ChatReactionPlaintextPayload>;
export type LocalPreviewPlaintextPayload = z.infer<typeof LocalPreviewPlaintextPayload>;
export type BrowserRequestPlaintextPayload = z.infer<typeof BrowserRequestPlaintextPayload>;
export type TerminalRequestPlaintextPayload = z.infer<typeof TerminalRequestPlaintextPayload>;
export type RequestStatusPlaintextPayload = z.infer<typeof RequestStatusPlaintextPayload>;
export type InviteJoinRequestPlaintextPayload = z.infer<typeof InviteJoinRequestPlaintextPayload>;
export type InviteJoinStatusPlaintextPayload = z.infer<typeof InviteJoinStatusPlaintextPayload>;
export type WrappedRoomSecretPayload = z.infer<typeof WrappedRoomSecretPayload>;
export type RoomKeyRotationPlaintextPayload = z.infer<typeof RoomKeyRotationPlaintextPayload>;
export type CodexEventPlaintextPayload = z.infer<typeof CodexEventPlaintextPayload>;
export type CodexApprovalPlaintextPayload = z.infer<typeof CodexApprovalPlaintextPayload>;
export type TerminalResultPlaintextPayload = z.infer<typeof TerminalResultPlaintextPayload>;
export type GitWorkflowEventPlaintextPayload = z.infer<typeof GitWorkflowEventPlaintextPayload>;
export type GitHubActionsEventPlaintextPayload = z.infer<typeof GitHubActionsEventPlaintextPayload>;
export type HostHandoffPlaintextPayload = z.infer<typeof HostHandoffPlaintextPayload>;
export type RoomSettingsPlaintextPayload = z.infer<typeof RoomSettingsPlaintextPayload>;
export type RelayClientMessage = z.infer<typeof RelayClientMessage>;
export type RelayServerMessage = z.infer<typeof RelayServerMessage>;
export type DeviceSealedPayload = z.infer<typeof DeviceSealedPayload>;
export type EncryptedPayload = z.infer<typeof EncryptedPayload>;
export type DevicePublicKeyJwk = z.infer<typeof DevicePublicKeyJwk>;
export type TeamRole = z.infer<typeof TeamRole>;
export type TeamRecord = z.infer<typeof TeamRecord>;
export type TeamMemberRecord = z.infer<typeof TeamMemberRecord>;
export type DeviceRecord = z.infer<typeof DeviceRecord>;
export type RoomRecord = z.infer<typeof RoomRecord>;
export type InviteRecord = z.infer<typeof InviteRecord>;
export type AttachmentBlobRecord = z.infer<typeof AttachmentBlobRecord>;

export interface CodexTurnSummary {
  messagesSinceLastCodex: number;
  attachments: Array<{
    id: string;
    name: string;
    type: string;
    size: number;
    storage: "inline" | "encrypted_blob";
    contentIncluded: boolean;
  }>;
  workspacePath: string | null;
  git: {
    branch: string;
    files: Array<{ path: string; status: string; added: number; removed: number }>;
    totalFiles: number;
    truncated: boolean;
  } | null;
  browserAccess: string[];
  terminals: string[];
}

export interface RoomMode {
  chat: boolean;
  code: boolean;
  workspace: boolean;
  browser: boolean;
}

export const defaultRoomMode: RoomMode = {
  chat: true,
  code: true,
  workspace: true,
  browser: false
};
