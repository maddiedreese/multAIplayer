import {
  isRecord,
  maxCodexActivitiesPerRoom,
  CodexApprovalPlaintextPayload as CodexApprovalPlaintextPayloadSchema,
  CodexActivityPlaintextPayload as CodexActivityPlaintextPayloadSchema,
  CodexQueuePlaintextPayload as CodexQueuePlaintextPayloadSchema,
  LocalPreviewPlaintextPayload as LocalPreviewPlaintextPayloadSchema,
  WorkspaceFileSaveRequestPlaintextPayload as WorkspaceFileSaveRequestPlaintextPayloadSchema,
  ChatDeletePlaintextPayload as ChatDeletePlaintextPayloadSchema,
  ChatEditPlaintextPayload as ChatEditPlaintextPayloadSchema,
  type ChatDeletePlaintextPayload,
  type ChatEditPlaintextPayload,
  type CodexApprovalPlaintextPayload,
  type CodexActivityPlaintextPayload,
  type CodexEventPlaintextPayload,
  type CodexQueuePlaintextPayload,
  type GitHubActionsEventPlaintextPayload,
  type GitWorkflowEventPlaintextPayload,
  type LocalPreviewPlaintextPayload,
  type WorkspaceFileSaveRequestPlaintextPayload
} from "@multaiplayer/protocol";
import type { GitHubActionRun } from "../identity/authClient";
import { normalizeChatMessage } from "../chat/chatSanitizer";
import { normalizeCodexThreadId } from "../codex/codexThread";
import { normalizeCodexThreadGraph } from "../codex/codexThreadGraph";
import { sanitizeLocalRoomReadState } from "./roomUnread";
import type { GitWorkflowResult, TerminalSnapshot } from "../platform/localBackend";
import { terminalsForLocalHistory } from "../terminal/terminalState";
import type {
  BrowserAccessRequest,
  ChatMessage,
  ChatReaction,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalRoomHistoryPayload,
  QueuedCodexTurn,
  RoomGoal,
  TerminalCommandRequest,
  WorkspaceFileSaveRequest
} from "../../types";

export function pruneLocalRoomHistory(
  payload: LocalRoomHistoryPayload,
  retentionDays: number
): LocalRoomHistoryPayload {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return {
    version: 3,
    messages: payload.messages.filter((message) => isWithinRetention(message.createdAt ?? message.time, cutoffMs)),
    chatEdits: (payload.chatEdits ?? []).filter((edit) => isWithinRetention(edit.editedAt, cutoffMs)),
    chatDeletes: (payload.chatDeletes ?? []).filter((deletion) => isWithinRetention(deletion.deletedAt, cutoffMs)),
    ...(payload.readState ? { readState: payload.readState } : {}),
    terminalRequests: payload.terminalRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    fileSaveRequests: (payload.fileSaveRequests ?? []).filter((request) =>
      isWithinRetention(request.requestedAt, cutoffMs)
    ),
    browserRequests: payload.browserRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    inviteRequests: payload.inviteRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    codexEvents: payload.codexEvents.filter((event) => isWithinRetention(event.createdAt, cutoffMs)),
    codexActivities: (payload.codexActivities ?? [])
      .filter((activity) => isWithinRetention(activity.updatedAt, cutoffMs))
      .slice(-maxCodexActivitiesPerRoom),
    gitWorkflowEvents: payload.gitWorkflowEvents.filter((event) => isWithinRetention(event.createdAt, cutoffMs)),
    githubActionsEvents: payload.githubActionsEvents.filter((event) => isWithinRetention(event.checkedAt, cutoffMs)),
    localPreviews: payload.localPreviews.filter((preview) => isWithinRetention(preview.updatedAt, cutoffMs)),
    terminalSnapshots: terminalsForLocalHistory(
      payload.terminalSnapshots.filter((terminal) => isWithinRetention(terminal.startedAt, cutoffMs))
    ),
    hostHandoffs: payload.hostHandoffs.filter((handoff) => isWithinRetention(handoff.createdAt, cutoffMs)),
    queuedCodexTurns: (payload.queuedCodexTurns ?? []).filter((turn) => isWithinRetention(turn.queuedAt, cutoffMs)),
    ...(payload.roomGoal && isWithinRetention(payload.roomGoal.updatedAt, cutoffMs)
      ? { roomGoal: payload.roomGoal }
      : {}),
    ...(payload.codexThreadGraph?.activeThreadId
      ? { codexThreadGraph: normalizeCodexThreadGraph(payload.codexThreadGraph) }
      : {})
  };
}

export function emptyLocalRoomHistoryPayload(): LocalRoomHistoryPayload {
  return {
    version: 3,
    messages: [],
    chatEdits: [],
    chatDeletes: [],
    terminalRequests: [],
    fileSaveRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    codexActivities: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminalSnapshots: [],
    hostHandoffs: [],
    queuedCodexTurns: []
  };
}

export function normalizeLocalRoomHistory(value: unknown): LocalRoomHistoryPayload {
  if (Array.isArray(value)) {
    return {
      ...emptyLocalRoomHistoryPayload(),
      messages: normalizeChatHistoryMessages(value)
    };
  }

  if (!isRecord(value)) return emptyLocalRoomHistoryPayload();
  if (!isSupportedLocalHistoryVersion(value.version)) {
    return emptyLocalRoomHistoryPayload();
  }

  // One-way v2-alpha migration: old encrypted history may contain the former
  // flat thread-id mirror, but all normalized and newly persisted payloads are
  // graph-only. No runtime state writes the mirror back.
  const codexThreadId = normalizeCodexThreadId(value.codexThreadId);
  const codexThreadGraph = normalizeCodexThreadGraph(value.codexThreadGraph, codexThreadId);
  const readState = sanitizeLocalRoomReadState(value.readState);
  return {
    version: 3,
    messages: normalizeChatHistoryMessages(historyArray(value, "messages")),
    chatEdits: historyArray(value, "chatEdits").filter(isChatEditPlaintextPayload),
    chatDeletes: historyArray(value, "chatDeletes").filter(isChatDeletePlaintextPayload),
    ...(readState ? { readState } : {}),
    terminalRequests: historyArray(value, "terminalRequests").filter(isTerminalCommandRequest),
    fileSaveRequests: historyArray(value, "fileSaveRequests").filter(isWorkspaceFileSaveRequest),
    browserRequests: historyArray(value, "browserRequests").filter(isBrowserAccessRequest),
    inviteRequests: historyArray(value, "inviteRequests").filter(isInviteJoinRequest),
    codexEvents: historyArray(value, "codexEvents").filter(isCodexEventPlaintextPayloadLenient),
    codexActivities: historyArray(value, "codexActivities")
      .filter(isCodexActivityPlaintextPayload)
      .slice(-maxCodexActivitiesPerRoom),
    gitWorkflowEvents: historyArray(value, "gitWorkflowEvents").filter(isGitWorkflowEventPlaintextPayloadLenient),
    githubActionsEvents: historyArray(value, "githubActionsEvents").filter(isGitHubActionsEventPlaintextPayloadLenient),
    localPreviews: historyArray(value, "localPreviews").filter(isLocalPreviewPlaintextPayload),
    terminalSnapshots: terminalsForLocalHistory(historyArray(value, "terminalSnapshots").filter(isTerminalSnapshot)),
    hostHandoffs: historyArray(value, "hostHandoffs").filter(isHostHandoffRecord),
    queuedCodexTurns: historyArray(value, "queuedCodexTurns").filter(isQueuedCodexTurn),
    ...(isRoomGoal(value.roomGoal) ? { roomGoal: value.roomGoal } : {}),
    ...(codexThreadGraph.activeThreadId
      ? {
          codexThreadGraph
        }
      : {})
  };
}

function historyArray(value: Record<string, unknown>, key: string): unknown[] {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : [];
}

function isSupportedLocalHistoryVersion(value: unknown): boolean {
  return value === undefined || value === 1 || value === 2 || value === 3;
}

export function isChatMessage(value: unknown): value is ChatMessage {
  const normalized = normalizeChatMessage(value);
  return Boolean(
    normalized &&
    (normalized.reactions === undefined ||
      (Array.isArray(normalized.reactions) && normalized.reactions.every(isChatReaction)))
  );
}

export function isChatEditPlaintextPayload(value: unknown): value is ChatEditPlaintextPayload {
  return ChatEditPlaintextPayloadSchema.safeParse(value).success;
}

export function isChatDeletePlaintextPayload(value: unknown): value is ChatDeletePlaintextPayload {
  return ChatDeletePlaintextPayloadSchema.safeParse(value).success;
}

export function isCodexApprovalPlaintextPayload(value: unknown): value is CodexApprovalPlaintextPayload {
  return CodexApprovalPlaintextPayloadSchema.safeParse(value).success;
}

export function isCodexQueuePlaintextPayload(value: unknown): value is CodexQueuePlaintextPayload {
  return CodexQueuePlaintextPayloadSchema.safeParse(value).success;
}

export function isAttachmentBlobContent(value: unknown): value is {
  name: string;
  type: string;
  size: number;
  content: string;
  truncated?: boolean;
} {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    typeof value.content === "string" &&
    (value.truncated === undefined || typeof value.truncated === "boolean")
  );
}

export function isBrowserDecisionSystemMessage(message: ChatMessage): boolean {
  if (message.role !== "system" || message.author !== "multAIplayer") return false;
  return /^[^\n]+ (approved|denied) (https?:\/\/|a browser access request)/i.test(message.body.trim());
}

export function isWorkspaceFileSaveRequestPlaintextPayload(
  value: unknown
): value is WorkspaceFileSaveRequestPlaintextPayload {
  return WorkspaceFileSaveRequestPlaintextPayloadSchema.safeParse(value).success;
}

export function isWorkspaceFileSaveRequest(value: unknown): value is WorkspaceFileSaveRequest {
  if (!isRecord(value)) return false;
  const status = value.status;
  return (
    isWorkspaceFileSaveRequestPlaintextPayload(value) &&
    (status === "pending" || status === "approved" || status === "denied")
  );
}

export function isLocalPreviewPlaintextPayload(value: unknown): value is LocalPreviewPlaintextPayload {
  return LocalPreviewPlaintextPayloadSchema.safeParse(value).success;
}

function isCodexEventPlaintextPayloadLenient(value: unknown): value is CodexEventPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "codex.turn" &&
    typeof value.turnId === "string" &&
    (value.status === "started" ||
      value.status === "event" ||
      value.status === "completed" ||
      value.status === "failed") &&
    typeof value.message === "string" &&
    typeof value.model === "string" &&
    (value.threadId === undefined || typeof value.threadId === "string") &&
    (value.eventName === undefined || typeof value.eventName === "string") &&
    (value.consumedMessageIds === undefined || isBoundedStringList(value.consumedMessageIds, 256)) &&
    (value.riskFlags === undefined || isCodexTurnRiskFlags(value.riskFlags)) &&
    typeof value.host === "string" &&
    typeof value.hostUserId === "string" &&
    typeof value.createdAt === "string"
  );
}

export function isCodexActivityPlaintextPayload(value: unknown): value is CodexActivityPlaintextPayload {
  return CodexActivityPlaintextPayloadSchema.safeParse(value).success;
}

function isBoundedStringList(value: unknown, maxItems: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 160)
  );
}

function isCodexTurnRiskFlags(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 24 &&
    value.every(
      (flag) =>
        isRecord(flag) &&
        typeof flag.id === "string" &&
        typeof flag.label === "string" &&
        typeof flag.source === "string" &&
        typeof flag.risk === "string" &&
        flag.severity === "warning"
    )
  );
}

function isGitWorkflowEventPlaintextPayloadLenient(value: unknown): value is GitWorkflowEventPlaintextPayload {
  if (!isRecord(value)) return false;
  const results = value.results;
  const pullRequest = value.pullRequest;
  return (
    value.eventType === "git.workflow" &&
    (value.status === "started" ||
      value.status === "completed" ||
      value.status === "failed" ||
      value.status === "pr_opened") &&
    typeof value.branch === "string" &&
    typeof value.push === "boolean" &&
    typeof value.message === "string" &&
    typeof value.runner === "string" &&
    typeof value.runnerUserId === "string" &&
    typeof value.createdAt === "string" &&
    (results === undefined || (Array.isArray(results) && results.every(isGitWorkflowResult))) &&
    (pullRequest === undefined ||
      (isRecord(pullRequest) && typeof pullRequest.number === "number" && typeof pullRequest.url === "string"))
  );
}

function isGitHubActionsEventPlaintextPayloadLenient(value: unknown): value is GitHubActionsEventPlaintextPayload {
  if (!isRecord(value)) return false;
  const summary = value.summary;
  return (
    value.eventType === "github.actions" &&
    typeof value.owner === "string" &&
    typeof value.repo === "string" &&
    typeof value.branch === "string" &&
    isRecord(summary) &&
    typeof summary.label === "string" &&
    typeof summary.detail === "string" &&
    isStatusTone(summary.tone) &&
    typeof value.message === "string" &&
    typeof value.checkedBy === "string" &&
    typeof value.checkedByUserId === "string" &&
    typeof value.checkedAt === "string" &&
    Array.isArray(value.runs) &&
    value.runs.every(isGitHubActionRun)
  );
}

function isWithinRetention(value: string | undefined, cutoffMs: number): boolean {
  if (!value) return true;
  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) return true;
  return timestampMs >= cutoffMs;
}

function normalizeChatHistoryMessages(value: unknown[]): ChatMessage[] {
  return value
    .map((message) => normalizeChatMessage(message) as ChatMessage | null)
    .filter((message): message is ChatMessage => Boolean(message && !isLegacyDebugChatMessage(message)));
}

export function isLegacyDebugChatMessage(message: ChatMessage): boolean {
  const normalizedBody = message.body.trim().toLowerCase();
  return (
    normalizedBody === "relay-backed encrypted hello from the room." ||
    normalizedBody === "ciphertext-only debug check." ||
    normalizedBody === "let's make the first pass feel like a coding room, not a generic chat wrapper." ||
    normalizedBody === "agree. the right rail should show files and diffs while codex is working." ||
    normalizedBody ===
      "@codex can you wire the approval sheet to show chat delta, attachments, browser access, terminals, and workspace?" ||
    normalizedBody ===
      "i can do that. i will use the current chat delta, selected project folder, and the dev-server terminal. i will not use browser access unless approved." ||
    normalizedBody === "next turn should also include copy-as-markdown and the secret warning."
  );
}

function isChatReaction(value: unknown): value is ChatReaction {
  if (!isRecord(value)) return false;
  return (
    typeof value.emoji === "string" &&
    Array.isArray(value.reactors) &&
    value.reactors.every(
      (reactor) => isRecord(reactor) && typeof reactor.userId === "string" && typeof reactor.name === "string"
    )
  );
}

function isTerminalCommandRequest(value: unknown): value is TerminalCommandRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.requester === "string" &&
    typeof value.requesterUserId === "string" &&
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    typeof value.requestedAt === "string" &&
    isWorkflowStatus(value.status)
  );
}

function isTerminalSnapshot(value: unknown): value is TerminalSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.roomId === "string" &&
    typeof value.name === "string" &&
    typeof value.cwd === "string" &&
    typeof value.command === "string" &&
    typeof value.running === "boolean" &&
    (typeof value.exitStatus === "number" || value.exitStatus === null) &&
    typeof value.startedAt === "string" &&
    Array.isArray(value.lines) &&
    value.lines.every(isTerminalLine)
  );
}

function isTerminalLine(value: unknown): value is { stream: string; text: string } {
  return isRecord(value) && typeof value.stream === "string" && typeof value.text === "string";
}

function isInviteJoinRequest(value: unknown): value is InviteJoinRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.inviteId === "string" &&
    typeof value.requester === "string" &&
    typeof value.requesterUserId === "string" &&
    typeof value.requesterDeviceId === "string" &&
    typeof value.keyPackageId === "string" &&
    typeof value.keyPackageHash === "string" &&
    typeof value.requestedAt === "string" &&
    (value.note === undefined || typeof value.note === "string") &&
    isWorkflowStatus(value.status)
  );
}

function isGitWorkflowResult(value: unknown): value is GitWorkflowResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    (typeof value.status === "number" || value.status === null) &&
    typeof value.stdout === "string" &&
    typeof value.stderr === "string"
  );
}

function isGitHubActionRun(value: unknown): value is GitHubActionRun {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.name === "string" &&
    hasValidOptionalActionIdentity(value) &&
    typeof value.status === "string" &&
    (typeof value.conclusion === "string" || value.conclusion === null) &&
    hasValidOptionalActionSource(value) &&
    typeof value.url === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function hasValidOptionalActionIdentity(value: Record<string, unknown>): boolean {
  return (
    (value.displayTitle === undefined || typeof value.displayTitle === "string") &&
    (value.runNumber === undefined || typeof value.runNumber === "number") &&
    (value.workflowId === undefined || typeof value.workflowId === "number")
  );
}

function hasValidOptionalActionSource(value: Record<string, unknown>): boolean {
  return (
    (value.branch === undefined || typeof value.branch === "string") &&
    (value.headSha === undefined || typeof value.headSha === "string") &&
    (value.event === undefined || typeof value.event === "string")
  );
}

function isStatusTone(value: unknown): value is "green" | "yellow" | "red" | "dark" | "muted" {
  return value === "green" || value === "yellow" || value === "red" || value === "dark" || value === "muted";
}

function isBrowserAccessRequest(value: unknown): value is BrowserAccessRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.requester === "string" &&
    typeof value.requesterUserId === "string" &&
    typeof value.url === "string" &&
    typeof value.reason === "string" &&
    typeof value.requestedAt === "string" &&
    isWorkflowStatus(value.status)
  );
}

function isHostHandoffRecord(value: unknown): value is HostHandoffRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.fromHost === "string" &&
    typeof value.fromUserId === "string" &&
    typeof value.projectPath === "string" &&
    typeof value.codexModel === "string" &&
    typeof value.approvalPolicy === "string" &&
    typeof value.messagesSinceLastCodex === "number" &&
    (value.queuedCodexTurns === undefined ||
      (Array.isArray(value.queuedCodexTurns) && value.queuedCodexTurns.every(isQueuedCodexTurn))) &&
    Array.isArray(value.attachmentNames) &&
    Array.isArray(value.terminals) &&
    typeof value.createdAt === "string" &&
    (value.status === "available" || value.status === "accepted")
  );
}

function isQueuedCodexTurn(value: unknown): value is QueuedCodexTurn {
  if (!isRecord(value)) return false;
  return (
    typeof value.turnId === "string" &&
    typeof value.roomId === "string" &&
    typeof value.requestedBy === "string" &&
    typeof value.requestedByUserId === "string" &&
    typeof value.queuedAt === "string" &&
    (value.triggerMessageId === undefined || typeof value.triggerMessageId === "string")
  );
}

function isRoomGoal(value: unknown): value is RoomGoal {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    value.text.length <= 2000 &&
    isRoomGoalStatus(value.status) &&
    typeof value.startedAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.elapsedMs === "number" &&
    Number.isFinite(value.elapsedMs) &&
    value.elapsedMs >= 0
  );
}

function isRoomGoalStatus(value: unknown): value is RoomGoal["status"] {
  return (
    value === "active" ||
    value === "paused" ||
    value === "blocked" ||
    value === "usageLimited" ||
    value === "budgetLimited" ||
    value === "complete"
  );
}

function isWorkflowStatus(value: unknown): value is "pending" | "approved" | "denied" {
  return value === "pending" || value === "approved" || value === "denied";
}
