import {
  isRecord,
  maxCodexActivitiesPerRoom,
  CodexActivityPlaintextPayload as CodexActivityPlaintextPayloadSchema,
  CodexEventPlaintextPayload as CodexEventPlaintextPayloadSchema,
  GitWorkflowEventPlaintextPayload as GitWorkflowEventPlaintextPayloadSchema,
  GitHubActionsEventPlaintextPayload as GitHubActionsEventPlaintextPayloadSchema,
  LocalPreviewPlaintextPayload as LocalPreviewPlaintextPayloadSchema,
  WorkspaceFileSaveRequestPlaintextPayload as WorkspaceFileSaveRequestPlaintextPayloadSchema,
  ChatDeletePlaintextPayload as ChatDeletePlaintextPayloadSchema,
  ChatEditPlaintextPayload as ChatEditPlaintextPayloadSchema,
  type ChatDeletePlaintextPayload,
  type ChatEditPlaintextPayload,
  type CodexActivityPlaintextPayload,
  type CodexEventPlaintextPayload,
  type GitHubActionsEventPlaintextPayload,
  type GitWorkflowEventPlaintextPayload,
  type LocalPreviewPlaintextPayload,
  type WorkspaceFileSaveRequestPlaintextPayload
} from "@multaiplayer/protocol";
import type { GitHubActionRun } from "../identity/authClient";
import { normalizeChatMessage } from "../chat/chatSanitizer";
import { normalizeCodexThreadGraph } from "../codex/codexThreadGraph";
import { maxCodexThreadGraphNodes } from "../codex/codexThreadGraph";
import { isCurrentLocalRoomReadState, sanitizeLocalRoomReadState } from "./roomUnread";
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
import { maxLocalHistoryItemsPerContainer, pruneLocalRoomHistory } from "./localHistoryRetention";

export { maxLocalHistoryItemsPerContainer, pruneLocalRoomHistory } from "./localHistoryRetention";

export function normalizeLocalRoomHistory(value: unknown): LocalRoomHistoryPayload {
  if (!isRecord(value)) throw new InvalidLocalRoomHistoryError("Encrypted local history is not an object.");
  if (value.version !== 3) throw new UnsupportedLocalRoomHistoryVersionError();
  assertCurrentLocalHistoryShape(value);

  return normalizeHistoryContainers(value);
}

/** Sanitizes the deliberately user-editable archive format without treating it as live persisted state. */
export function normalizeReadOnlyRoomArchiveHistory(value: unknown): LocalRoomHistoryPayload {
  if (!isRecord(value)) throw new InvalidLocalRoomHistoryError("Room archive history is not an object.");
  return normalizeHistoryContainers(value);
}

function normalizeHistoryContainers(value: Record<string, unknown>): LocalRoomHistoryPayload {
  const codexThreadGraph = normalizeCodexThreadGraph(value.codexThreadGraph);
  const readState = sanitizeLocalRoomReadState(value.readState);
  return {
    version: 3,
    messages: normalizeChatHistoryMessages(historyArray(value, "messages")),
    chatEdits: historyArray(value, "chatEdits").filter(isChatEditPlaintextPayload),
    chatDeletes: historyArray(value, "chatDeletes").filter(isChatDeletePlaintextPayload),
    readState: readState ?? { unread: 0 },
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

export class UnsupportedLocalRoomHistoryVersionError extends Error {
  constructor() {
    super("Encrypted local history uses an unsupported schema version.");
    this.name = "UnsupportedLocalRoomHistoryVersionError";
  }
}

export class InvalidLocalRoomHistoryError extends Error {
  constructor(message = "Encrypted local history does not match the current schema.") {
    super(message);
    this.name = "InvalidLocalRoomHistoryError";
  }
}

export function normalizeRetainedLocalRoomHistory(value: unknown, retentionDays: number): LocalRoomHistoryPayload {
  return pruneLocalRoomHistory(normalizeLocalRoomHistory(value), retentionDays);
}

function historyArray(value: Record<string, unknown>, key: string): unknown[] {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate.slice(-maxLocalHistoryItemsPerContainer) : [];
}

function assertCurrentLocalHistoryShape(value: Record<string, unknown>): void {
  const requiredArrays: Array<[string, (item: unknown) => boolean]> = [
    ["messages", isChatMessage],
    ["chatEdits", isChatEditPlaintextPayload],
    ["chatDeletes", isChatDeletePlaintextPayload],
    ["terminalRequests", isTerminalCommandRequest],
    ["fileSaveRequests", isWorkspaceFileSaveRequest],
    ["browserRequests", isBrowserAccessRequest],
    ["inviteRequests", isInviteJoinRequest],
    ["codexEvents", (item) => CodexEventPlaintextPayloadSchema.safeParse(item).success],
    ["codexActivities", isCodexActivityPlaintextPayload],
    ["gitWorkflowEvents", (item) => GitWorkflowEventPlaintextPayloadSchema.safeParse(item).success],
    ["githubActionsEvents", (item) => GitHubActionsEventPlaintextPayloadSchema.safeParse(item).success],
    ["localPreviews", isLocalPreviewPlaintextPayload],
    ["terminalSnapshots", isTerminalSnapshot],
    ["hostHandoffs", isHostHandoffRecord],
    ["queuedCodexTurns", isQueuedCodexTurn]
  ];
  for (const [key, validate] of requiredArrays) assertHistoryArray(value, key, validate, true);
  if (value.roomGoal !== undefined && !isRoomGoal(value.roomGoal)) throw new InvalidLocalRoomHistoryError();
  if (!isCurrentLocalRoomReadState(value.readState)) {
    throw new InvalidLocalRoomHistoryError();
  }
  if (value.codexThreadGraph !== undefined && !isCurrentCodexThreadGraph(value.codexThreadGraph)) {
    throw new InvalidLocalRoomHistoryError();
  }
}

function assertHistoryArray(
  value: Record<string, unknown>,
  key: string,
  validate: (item: unknown) => boolean,
  required: boolean
): void {
  const items = value[key];
  if (items === undefined && !required) return;
  if (!Array.isArray(items) || items.length > maxLocalHistoryItemsPerContainer || !items.every(validate)) {
    throw new InvalidLocalRoomHistoryError();
  }
}

function isCurrentCodexThreadGraph(value: unknown): boolean {
  if (!isRecord(value) || Array.isArray(value) || !isRecord(value.nodesById) || Array.isArray(value.nodesById)) {
    return false;
  }
  if (value.activeThreadId !== null && typeof value.activeThreadId !== "string") return false;
  const entries = Object.entries(value.nodesById);
  if (entries.length > maxCodexThreadGraphNodes) return false;
  if (value.activeThreadId !== null && !Object.hasOwn(value.nodesById, value.activeThreadId)) return false;
  return entries.every(([key, node]) => {
    if (!isRecord(node) || Array.isArray(node) || node.id !== key) return false;
    return (
      typeof node.id === "string" &&
      (node.sessionId === undefined || typeof node.sessionId === "string") &&
      (node.parentThreadId === undefined || typeof node.parentThreadId === "string") &&
      typeof node.title === "string" &&
      ["notLoaded", "idle", "systemError", "active", "unknown"].includes(String(node.status)) &&
      Number.isSafeInteger(node.createdAt) &&
      Number(node.createdAt) >= 0 &&
      Number.isSafeInteger(node.updatedAt) &&
      Number(node.updatedAt) >= 0
    );
  });
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

function normalizeChatHistoryMessages(value: unknown[]): ChatMessage[] {
  return value
    .map((message) => normalizeChatMessage(message) as ChatMessage | null)
    .filter((message): message is ChatMessage => Boolean(message));
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
