import { z } from "zod";

export const DeviceId = z.string().min(8);
export const TeamId = z.string().min(3);
export const RoomId = z.string().min(3);
export const UserId = z.string().min(1);

export const CiphertextPayload = z.object({
  algorithm: z.literal("AES-GCM-256"),
  nonce: z.string(),
  ciphertext: z.string()
});

export const DeviceSealedPayload = z.object({
  algorithm: z.literal("ECDH-P256-HKDF-SHA256-AES-GCM-256"),
  ephemeralPublicKeyJwk: z.record(z.string(), z.unknown()),
  nonce: z.string(),
  ciphertext: z.string()
});

export const EncryptedPayload = z.union([CiphertextPayload, DeviceSealedPayload]);

export const maxMessageAttachments = 5;
export const maxEmbeddedAttachmentBytes = 80_000;
export const maxEmbeddedAttachmentBytesPerMessage = 200_000;

export const RelayEnvelope = z.object({
  id: z.string(),
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
    "git.event",
    "room.presence",
    "room.invite",
    "room.host"
  ]),
  payload: EncryptedPayload
});

export const ChatPlaintextPayload = z.object({
  id: z.string(),
  author: z.string(),
  role: z.enum(["human", "codex", "system"]),
  body: z.string(),
  time: z.string(),
  createdAt: z.string().datetime().optional(),
	  attachments: z.array(z.object({
	    id: z.string(),
	    name: z.string(),
	    type: z.string(),
	    size: z.number().int().nonnegative(),
	    content: z.string().max(maxEmbeddedAttachmentBytes).optional(),
	    blobId: z.string().optional(),
	    blobBytes: z.number().int().nonnegative().optional(),
	    truncated: z.boolean().optional()
	  })).max(maxMessageAttachments).optional()
	});

export const ChatReactionPlaintextPayload = z.object({
  id: z.string(),
  messageId: z.string(),
  emoji: z.string().min(1).max(16),
  action: z.enum(["add", "remove"]),
  reactor: z.string(),
  reactorUserId: z.string(),
  createdAt: z.string().datetime()
});

export const TerminalRequestPlaintextPayload = z.object({
  id: z.string(),
  requester: z.string(),
  requesterUserId: z.string(),
  command: z.string(),
  cwd: z.string(),
  requestedAt: z.string()
});

export const BrowserRequestPlaintextPayload = z.object({
  id: z.string(),
  requester: z.string(),
  requesterUserId: z.string(),
  url: z.string(),
  reason: z.string(),
  requestedAt: z.string()
});

export const RequestStatusPlaintextPayload = z.object({
  requestId: z.string(),
  status: z.enum(["approved", "denied"]),
  decidedBy: z.string(),
  decidedByUserId: z.string(),
  decidedAt: z.string().datetime()
});

export const InviteJoinRequestPlaintextPayload = z.object({
  eventType: z.literal("invite.request"),
  id: z.string(),
  inviteId: z.string().optional(),
  requester: z.string(),
  requesterUserId: z.string(),
  requesterDeviceId: z.string(),
  requesterPublicKeyJwk: z.record(z.string(), z.unknown()).optional(),
  requesterPublicKeyFingerprint: z.string().optional(),
  requestedAt: z.string().datetime(),
  note: z.string().optional()
});

export const WrappedRoomSecretPayload = z.object({
  version: z.literal(1),
  algorithm: z.literal("ECDH-P256-HKDF-SHA256-AES-GCM-256"),
  ephemeralPublicKeyJwk: z.record(z.string(), z.unknown()),
  nonce: z.string(),
  ciphertext: z.string()
});

export const InviteJoinStatusPlaintextPayload = z.object({
  eventType: z.literal("invite.status"),
  requestId: z.string(),
  status: z.enum(["approved", "denied"]),
  decidedBy: z.string(),
  decidedByUserId: z.string(),
  decidedAt: z.string().datetime(),
  recipientDeviceId: z.string().optional(),
  recipientPublicKeyFingerprint: z.string().optional(),
  wrappedRoomSecret: WrappedRoomSecretPayload.optional()
});

export const CodexEventPlaintextPayload = z.object({
  eventType: z.literal("codex.turn"),
  turnId: z.string(),
  status: z.enum(["started", "event", "completed", "failed"]),
  message: z.string(),
  model: z.string(),
  threadId: z.string().optional(),
  eventName: z.string().optional(),
  host: z.string(),
  hostUserId: z.string(),
  createdAt: z.string().datetime()
});

export const TerminalResultPlaintextPayload = z.object({
  eventType: z.literal("terminal.result"),
  requestId: z.string(),
  command: z.string(),
  cwd: z.string(),
  exitStatus: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  error: z.string().optional(),
  ranBy: z.string(),
  ranByUserId: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime()
});

export const GitWorkflowEventPlaintextPayload = z.object({
  eventType: z.literal("git.workflow"),
  status: z.enum(["started", "completed", "failed", "pr_opened"]),
  branch: z.string(),
  push: z.boolean(),
  message: z.string(),
  runner: z.string(),
  runnerUserId: z.string(),
  createdAt: z.string().datetime(),
  results: z.array(z.object({
    command: z.string(),
    cwd: z.string(),
    status: z.number().int().nullable(),
    stdout: z.string(),
    stderr: z.string()
  })).optional(),
  pullRequest: z.object({
    number: z.number().int(),
    url: z.string()
  }).optional()
});

export const GitHubActionsEventPlaintextPayload = z.object({
  eventType: z.literal("github.actions"),
  owner: z.string(),
  repo: z.string(),
  branch: z.string(),
  summary: z.object({
    label: z.string(),
    detail: z.string(),
    tone: z.enum(["green", "yellow", "red", "dark", "muted"])
  }),
  message: z.string(),
  checkedBy: z.string(),
  checkedByUserId: z.string(),
  checkedAt: z.string().datetime(),
  runs: z.array(z.object({
    id: z.number().int(),
    name: z.string(),
    displayTitle: z.string().optional(),
    runNumber: z.number().int().optional(),
    workflowId: z.number().int().optional(),
    status: z.string(),
    conclusion: z.string().nullable(),
    branch: z.string().optional(),
    headSha: z.string().optional(),
    event: z.string().optional(),
    url: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  }))
});

export const HostHandoffPlaintextPayload = z.object({
  id: z.string(),
  fromHost: z.string(),
  fromUserId: z.string(),
  projectPath: z.string(),
  codexModel: z.string(),
  approvalPolicy: z.string(),
  messagesSinceLastCodex: z.number().int().nonnegative(),
  attachmentNames: z.array(z.string()),
  terminals: z.array(z.string()),
  createdAt: z.string()
});

export const PresenceMessage = z.object({
  type: z.literal("presence"),
  teamId: TeamId,
  roomId: RoomId,
  userId: UserId,
  deviceId: DeviceId,
  displayName: z.string(),
  avatarUrl: z.string().optional(),
  publicKeyFingerprint: z.string().optional()
});

export type ApprovalPolicy =
  | "ask_every_turn"
  | "auto_chat_only"
  | "auto_browser_allowed_sites"
  | "never_host";

export const defaultCodexModel = "gpt-5.4";
export const defaultBrowserAllowedOrigins = ["https://github.com"];

export const codexModelOptions = [
  { id: "gpt-5.4", label: "GPT-5.4", description: "Default high-capability Codex host model" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", description: "Faster Codex turns for lighter room tasks" },
  { id: "gpt-5.4-thinking", label: "GPT-5.4 thinking", description: "Deeper reasoning for larger coding turns" }
] as const;

export const TeamRecord = z.object({
  id: TeamId,
  name: z.string().min(1),
  members: z.number().int().nonnegative()
});

export const DeviceRecord = z.object({
  userId: UserId,
  deviceId: DeviceId,
  displayName: z.string().min(1),
  publicKeyJwk: z.record(z.string(), z.unknown()),
  publicKeyFingerprint: z.string().min(16),
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
  name: z.string().min(1),
  projectPath: z.string(),
  host: z.string(),
  hostUserId: z.string().optional(),
  hostStatus: z.enum(["active", "offline", "handoff"]),
  approvalPolicy: z.enum([
    "ask_every_turn",
    "auto_chat_only",
    "auto_browser_allowed_sites",
    "never_host"
  ]),
  mode: RoomModeSchema,
  codexModel: z.string().min(1),
  browserAllowedOrigins: z.array(z.string().min(1)).max(20),
  unread: z.number().int().nonnegative()
});

export const InviteRecord = z.object({
  id: z.string(),
  teamId: TeamId,
  roomId: RoomId,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional()
});

export const AttachmentBlobRecord = z.object({
  id: z.string(),
  teamId: TeamId,
  roomId: RoomId,
  name: z.string(),
  type: z.string(),
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
    inviteId: z.string().optional()
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
    displayName: z.string(),
    avatarUrl: z.string().optional(),
    publicKeyFingerprint: z.string().optional(),
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
    message: z.string()
  })
]);

export type CiphertextPayload = z.infer<typeof CiphertextPayload>;
export type RelayEnvelope = z.infer<typeof RelayEnvelope>;
export type ChatPlaintextPayload = z.infer<typeof ChatPlaintextPayload>;
export type ChatReactionPlaintextPayload = z.infer<typeof ChatReactionPlaintextPayload>;
export type BrowserRequestPlaintextPayload = z.infer<typeof BrowserRequestPlaintextPayload>;
export type TerminalRequestPlaintextPayload = z.infer<typeof TerminalRequestPlaintextPayload>;
export type RequestStatusPlaintextPayload = z.infer<typeof RequestStatusPlaintextPayload>;
export type InviteJoinRequestPlaintextPayload = z.infer<typeof InviteJoinRequestPlaintextPayload>;
export type InviteJoinStatusPlaintextPayload = z.infer<typeof InviteJoinStatusPlaintextPayload>;
export type WrappedRoomSecretPayload = z.infer<typeof WrappedRoomSecretPayload>;
export type CodexEventPlaintextPayload = z.infer<typeof CodexEventPlaintextPayload>;
export type TerminalResultPlaintextPayload = z.infer<typeof TerminalResultPlaintextPayload>;
export type GitWorkflowEventPlaintextPayload = z.infer<typeof GitWorkflowEventPlaintextPayload>;
export type GitHubActionsEventPlaintextPayload = z.infer<typeof GitHubActionsEventPlaintextPayload>;
export type HostHandoffPlaintextPayload = z.infer<typeof HostHandoffPlaintextPayload>;
export type RelayClientMessage = z.infer<typeof RelayClientMessage>;
export type RelayServerMessage = z.infer<typeof RelayServerMessage>;
export type DeviceSealedPayload = z.infer<typeof DeviceSealedPayload>;
export type EncryptedPayload = z.infer<typeof EncryptedPayload>;
export type TeamRecord = z.infer<typeof TeamRecord>;
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
