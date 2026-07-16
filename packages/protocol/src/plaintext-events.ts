import { z } from "zod";
import { codexReasoningEffortIds } from "./defaults-options.js";
import {
  DeviceId,
  UserId,
  maxCodexModelChars,
  maxCodexQueueSize,
  maxCodexThreadIdChars,
  maxDisplayNameChars,
  maxEnvelopeIdChars,
  maxGitHubActionRuns,
  maxGitWorkflowResults,
  maxLongTextChars,
  maxMediumTextChars,
  maxProjectPathChars,
  maxShortTextChars,
  maxTerminalSnapshots,
  maxUrlChars,
  maxUserIdChars
} from "./limits-ids.js";

export const maxMessageAttachments = 5;
export const maxEmbeddedAttachmentBytes = 80_000;
export const maxEmbeddedAttachmentBytesPerMessage = 200_000;

export const ChatPlaintextPayload = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  author: z.string().min(1).max(maxDisplayNameChars),
  authorUserId: z.string().min(1).max(maxUserIdChars),
  role: z.enum(["human", "codex", "system"]),
  body: z.string().max(maxLongTextChars),
  time: z.string().min(1).max(maxShortTextChars),
  createdAt: z.string().datetime().optional(),
  replyTo: z.string().min(1).max(maxEnvelopeIdChars).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string().min(1).max(maxEnvelopeIdChars),
        name: z.string().min(1).max(maxShortTextChars),
        type: z.string().min(1).max(maxShortTextChars),
        size: z.number().int().nonnegative(),
        content: z.string().max(maxEmbeddedAttachmentBytes).optional(),
        blobId: z.string().min(1).max(maxEnvelopeIdChars).optional(),
        blobBytes: z.number().int().nonnegative().optional(),
        truncated: z.boolean().optional()
      })
    )
    .max(maxMessageAttachments)
    .optional()
});

export const ChatEditPlaintextPayload = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  messageId: z.string().min(1).max(maxEnvelopeIdChars),
  body: z.string().min(1).max(maxLongTextChars),
  editedBy: z.string().min(1).max(maxDisplayNameChars),
  editedByUserId: z.string().min(1).max(maxUserIdChars),
  editedAt: z.string().datetime()
});

export const ChatDeletePlaintextPayload = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  messageId: z.string().min(1).max(maxEnvelopeIdChars),
  deletedBy: z.string().min(1).max(maxDisplayNameChars),
  deletedByUserId: z.string().min(1).max(maxUserIdChars),
  deletedAt: z.string().datetime()
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

export const WorkspaceFileSaveRequestPlaintextPayload = z.object({
  eventType: z.literal("workspace.file.save"),
  id: z.string().min(1).max(maxEnvelopeIdChars),
  requester: z.string().min(1).max(maxDisplayNameChars),
  requesterUserId: z.string().min(1).max(maxUserIdChars),
  path: z.string().min(1).max(maxProjectPathChars),
  previousContent: z.string().max(maxLongTextChars),
  nextContent: z.string().max(maxLongTextChars),
  requestedAt: z.string().datetime()
});

export const RequestStatusPlaintextPayload = z.object({
  requestId: z.string().min(1).max(maxEnvelopeIdChars),
  status: z.enum(["approved", "denied"]),
  decidedBy: z.string().min(1).max(maxDisplayNameChars),
  decidedByUserId: z.string().min(1).max(maxUserIdChars),
  decidedAt: z.string().datetime()
});

export const CodexTurnRiskFlagPayload = z.object({
  id: z.string().min(1).max(maxEnvelopeIdChars),
  label: z.string().min(1).max(maxMediumTextChars),
  source: z.string().min(1).max(maxShortTextChars),
  risk: z.string().min(1).max(maxShortTextChars),
  severity: z.literal("warning")
});

export const CodexEventPlaintextPayload = z.object({
  eventType: z.literal("codex.turn"),
  turnId: z.string().min(1).max(maxEnvelopeIdChars),
  status: z.enum(["started", "event", "completed", "failed"]),
  message: z.string().max(maxLongTextChars),
  model: z.string().min(1).max(maxCodexModelChars),
  threadId: z.string().min(1).max(maxCodexThreadIdChars).optional(),
  eventName: z.string().min(1).max(maxShortTextChars).optional(),
  consumedMessageIds: z.array(z.string().min(1).max(maxEnvelopeIdChars)).max(256).optional(),
  riskFlags: z.array(CodexTurnRiskFlagPayload).max(24).optional(),
  host: z.string().min(1).max(maxDisplayNameChars),
  hostUserId: z.string().min(1).max(maxUserIdChars),
  createdAt: z.string().datetime()
});

export const maxCodexActivitiesPerRoom = 160;

const CodexActivityDetail = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reasoning"),
    summaries: z.array(z.string().min(1).max(maxMediumTextChars)).max(12),
    rawContent: z.array(z.string().min(1).max(maxMediumTextChars)).max(12).optional()
  }),
  z.object({
    type: z.literal("command"),
    command: z.string().min(1).max(maxLongTextChars),
    output: z.string().max(maxLongTextChars).optional(),
    exitCode: z.number().int().optional(),
    durationMs: z.number().int().nonnegative().optional()
  }),
  z.object({
    type: z.literal("file_change"),
    changes: z
      .array(
        z.object({
          path: z.string().min(1).max(maxProjectPathChars),
          action: z.enum(["add", "delete", "update"]),
          diff: z.string().max(maxLongTextChars).optional()
        })
      )
      .max(64)
  }),
  z.object({
    type: z.literal("tool"),
    name: z.string().min(1).max(maxShortTextChars),
    server: z.string().min(1).max(maxShortTextChars).optional(),
    arguments: z.string().max(maxLongTextChars).optional(),
    result: z.string().max(maxLongTextChars).optional(),
    error: z.string().max(maxMediumTextChars).optional(),
    durationMs: z.number().int().nonnegative().optional()
  }),
  z.object({
    type: z.literal("web_search"),
    action: z.enum(["search", "open_page", "find_in_page", "other"]).optional(),
    query: z.string().max(maxMediumTextChars).optional(),
    url: z.string().max(maxUrlChars).optional(),
    pattern: z.string().max(maxMediumTextChars).optional()
  }),
  z.object({
    type: z.literal("image_generation"),
    prompt: z.string().max(maxLongTextChars).optional()
  }),
  z.object({
    type: z.literal("agent"),
    prompt: z.string().max(maxLongTextChars).optional(),
    model: z.string().max(maxCodexModelChars).optional(),
    reasoningEffort: z.enum(codexReasoningEffortIds).optional(),
    states: z
      .array(
        z.object({
          threadId: z.string().min(1).max(maxCodexThreadIdChars),
          status: z.string().min(1).max(maxShortTextChars),
          message: z.string().max(maxMediumTextChars).optional()
        })
      )
      .max(16)
      .optional()
  })
]);

export const CodexActivityPlaintextPayload = z.object({
  eventType: z.literal("codex.activity"),
  activityId: z.string().min(1).max(maxEnvelopeIdChars),
  turnId: z.string().min(1).max(maxEnvelopeIdChars),
  itemId: z.string().min(1).max(maxEnvelopeIdChars),
  threadId: z.string().min(1).max(maxCodexThreadIdChars).optional(),
  kind: z.enum([
    "command",
    "file_change",
    "tool",
    "web_search",
    "image_generation",
    "agent",
    "review",
    "hook",
    "reasoning",
    "other"
  ]),
  status: z.enum(["started", "running", "completed", "failed", "declined"]),
  title: z.string().min(1).max(maxShortTextChars),
  details: CodexActivityDetail.optional(),
  agent: z
    .object({
      action: z.enum(["spawn", "send", "resume", "wait", "close"]),
      senderId: z.string().min(1).max(maxCodexThreadIdChars),
      receiverIds: z.array(z.string().min(1).max(maxCodexThreadIdChars)).max(16)
    })
    .optional(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  host: z.string().min(1).max(maxDisplayNameChars),
  hostUserId: z.string().min(1).max(maxUserIdChars)
});

export const CodexQueuePlaintextPayload = z
  .object({
    eventType: z.literal("codex.queue"),
    queueEventId: z.string().min(1).max(maxEnvelopeIdChars),
    turnId: z.string().min(1).max(maxEnvelopeIdChars),
    action: z.enum(["queued", "cancelled", "coalesced", "promoted", "dropped"]),
    requestedBy: z.string().min(1).max(maxDisplayNameChars),
    requestedByUserId: z.string().min(1).max(maxUserIdChars),
    triggerMessageId: z.string().min(1).max(maxEnvelopeIdChars).optional(),
    reason: z.string().max(maxMediumTextChars).optional(),
    queuePosition: z.number().int().min(1).max(maxCodexQueueSize).optional(),
    queueSize: z.number().int().nonnegative().max(maxCodexQueueSize),
    createdAt: z.string().datetime()
  })
  .refine(
    (payload) => {
      if (payload.action === "queued" || payload.action === "promoted") {
        return typeof payload.queuePosition === "number";
      }
      return true;
    },
    {
      message: "Queued and promoted Codex queue events must include a queue position",
      path: ["queuePosition"]
    }
  );

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
  results: z
    .array(
      z.object({
        command: z.string().min(1).max(maxMediumTextChars),
        cwd: z.string().min(1).max(maxProjectPathChars),
        status: z.number().int().nullable(),
        stdout: z.string().max(maxLongTextChars),
        stderr: z.string().max(maxLongTextChars)
      })
    )
    .max(maxGitWorkflowResults)
    .optional(),
  pullRequest: z
    .object({
      number: z.number().int(),
      url: z.string().min(1).max(maxUrlChars)
    })
    .optional()
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
  runs: z
    .array(
      z.object({
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
      })
    )
    .max(maxGitHubActionRuns)
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
  codexModelPolicy: z.enum(["auto", "pinned"]).optional(),
  codexReasoningEffort: z.enum(codexReasoningEffortIds).optional(),
  codexReasoningEffortPolicy: z.enum(["auto", "pinned"]).optional(),
  codexRawReasoningEnabled: z.boolean().optional(),
  codexSpeed: z.enum(["standard", "fast"]).optional(),
  codexServiceTierPolicy: z.enum(["auto", "pinned"]).optional(),
  codexSandboxLevel: z
    .enum(["read_only", "workspace_write", "workspace_write_network", "danger_full_access"])
    .optional(),
  approvalPolicy: z.string().min(1).max(maxShortTextChars),
  messagesSinceLastCodex: z.number().int().nonnegative(),
  queuedCodexTurns: z
    .array(
      z.object({
        turnId: z.string().min(1).max(maxEnvelopeIdChars),
        requestedBy: z.string().min(1).max(maxDisplayNameChars),
        requestedByUserId: z.string().min(1).max(maxUserIdChars),
        queuedAt: z.string().datetime(),
        triggerMessageId: z.string().min(1).max(maxEnvelopeIdChars).optional()
      })
    )
    .max(5)
    .optional(),
  attachmentNames: z.array(z.string().min(1).max(maxShortTextChars)).max(maxMessageAttachments),
  terminals: z.array(z.string().min(1).max(maxShortTextChars)).max(maxTerminalSnapshots),
  continuationSummary: z.string().max(maxMediumTextChars).optional(),
  createdAt: z.string().datetime(),
  status: z.enum(["available", "requested", "accepted"]).optional(),
  candidateUserId: UserId.optional(),
  candidateDeviceId: DeviceId.optional(),
  candidateLeaf: z.number().int().nonnegative().optional(),
  acceptedBy: z.string().min(1).max(maxDisplayNameChars).optional(),
  acceptedByUserId: z.string().min(1).max(maxUserIdChars).optional(),
  acceptedAt: z.string().datetime().optional()
});

export const HostHandoffRequestPlaintextPayload = z.object({
  phase: z.literal("candidate_request"),
  offerId: z.string().min(1).max(maxEnvelopeIdChars),
  candidateUserId: UserId,
  candidateDeviceId: DeviceId,
  candidateLeaf: z.number().int().nonnegative()
});

export const HostHandoffAcceptedPlaintextPayload = z.object({
  phase: z.literal("accepted"),
  offerId: z.string().min(1).max(maxEnvelopeIdChars),
  hostUserId: UserId,
  hostDeviceId: DeviceId,
  hostLeaf: z.number().int().nonnegative(),
  committedEpoch: z.number().int().nonnegative()
});

export const RoomSettingsPlaintextPayload = z.object({
  eventType: z.literal("room.settings"),
  id: z.string().min(1).max(maxEnvelopeIdChars),
  setting: z.enum([
    "roomName",
    "approvalPolicy",
    "roomMode",
    "codexModel",
    "codexReasoningEffort",
    "codexRawReasoningEnabled",
    "codexSpeed",
    "codexSandboxLevel",
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

/** Complete host-authorized room configuration, transported only inside an MLS PrivateMessage. */
export const RoomConfigPlaintextPayload = z.object({
  eventType: z.literal("room.config"),
  configRevision: z.number().int().positive(),
  emittingEpoch: z.number().int().nonnegative(),
  projectPath: z.string().min(1).max(maxProjectPathChars),
  codexModel: z.string().min(1).max(maxCodexModelChars),
  codexModelPolicy: z.enum(["auto", "pinned"]),
  codexReasoningEffort: z.enum(codexReasoningEffortIds),
  codexReasoningEffortPolicy: z.enum(["auto", "pinned"]),
  codexRawReasoningEnabled: z.boolean(),
  codexSpeed: z.enum(["standard", "fast"]),
  codexServiceTierPolicy: z.enum(["auto", "pinned"]),
  codexSandboxLevel: z.enum(["read_only", "workspace_write", "workspace_write_network", "danger_full_access"])
});

export type ChatPlaintextPayload = z.infer<typeof ChatPlaintextPayload>;
export type ChatEditPlaintextPayload = z.infer<typeof ChatEditPlaintextPayload>;
export type ChatDeletePlaintextPayload = z.infer<typeof ChatDeletePlaintextPayload>;
export type ChatReactionPlaintextPayload = z.infer<typeof ChatReactionPlaintextPayload>;
export type LocalPreviewPlaintextPayload = z.infer<typeof LocalPreviewPlaintextPayload>;
export type TerminalRequestPlaintextPayload = z.infer<typeof TerminalRequestPlaintextPayload>;
export type BrowserRequestPlaintextPayload = z.infer<typeof BrowserRequestPlaintextPayload>;
export type WorkspaceFileSaveRequestPlaintextPayload = z.infer<typeof WorkspaceFileSaveRequestPlaintextPayload>;
export type RequestStatusPlaintextPayload = z.infer<typeof RequestStatusPlaintextPayload>;
export type CodexTurnRiskFlagPayload = z.infer<typeof CodexTurnRiskFlagPayload>;
export type CodexEventPlaintextPayload = z.infer<typeof CodexEventPlaintextPayload>;
export type CodexActivityPlaintextPayload = z.infer<typeof CodexActivityPlaintextPayload>;
export type CodexQueuePlaintextPayload = z.infer<typeof CodexQueuePlaintextPayload>;
export type TerminalResultPlaintextPayload = z.infer<typeof TerminalResultPlaintextPayload>;
export type GitWorkflowEventPlaintextPayload = z.infer<typeof GitWorkflowEventPlaintextPayload>;
export type GitHubActionsEventPlaintextPayload = z.infer<typeof GitHubActionsEventPlaintextPayload>;
export type HostHandoffPlaintextPayload = z.infer<typeof HostHandoffPlaintextPayload>;
export type HostHandoffRequestPlaintextPayload = z.infer<typeof HostHandoffRequestPlaintextPayload>;
export type HostHandoffAcceptedPlaintextPayload = z.infer<typeof HostHandoffAcceptedPlaintextPayload>;
export type RoomSettingsPlaintextPayload = z.infer<typeof RoomSettingsPlaintextPayload>;
export type RoomConfigPlaintextPayload = z.infer<typeof RoomConfigPlaintextPayload>;
