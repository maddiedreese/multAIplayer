import {
  DevicePublicKeyJwk,
  CodexApprovalPlaintextPayload as CodexApprovalPlaintextPayloadSchema,
  LocalPreviewPlaintextPayload as LocalPreviewPlaintextPayloadSchema,
  RoomKeyRotationPlaintextPayload as RoomKeyRotationPlaintextPayloadSchema,
  type ChatReactionPlaintextPayload,
  type CodexApprovalPlaintextPayload,
  type CodexEventPlaintextPayload,
  type DevicePublicKeyJwk as DevicePublicKeyJwkType,
  type GitHubActionsEventPlaintextPayload,
  type GitWorkflowEventPlaintextPayload,
  type InviteJoinRequestPlaintextPayload,
  type InviteJoinStatusPlaintextPayload,
  type LocalPreviewPlaintextPayload,
  type RequestStatusPlaintextPayload,
  type RoomKeyRotationPlaintextPayload,
  type RoomSettingsPlaintextPayload,
  type TerminalResultPlaintextPayload
} from "@multaiplayer/protocol";
import type { GitHubActionRun } from "./authClient";
import { normalizeChatMessage } from "./chatSanitizer";
import { normalizeCodexThreadId } from "./codexThread";
import type { GitWorkflowResult, TerminalSnapshot } from "./localBackend";
import { terminalsForLocalHistory } from "./terminalState";
import type {
  BrowserAccessRequest,
  ChatMessage,
  ChatReaction,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalRoomHistoryPayload,
  TerminalCommandRequest
} from "../types";

export function pruneLocalRoomHistory(payload: LocalRoomHistoryPayload, retentionDays: number): LocalRoomHistoryPayload {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return {
    version: 3,
    messages: payload.messages.filter((message) => isWithinRetention(message.createdAt ?? message.time, cutoffMs)),
    terminalRequests: payload.terminalRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    browserRequests: payload.browserRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    inviteRequests: payload.inviteRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    codexEvents: payload.codexEvents.filter((event) => isWithinRetention(event.createdAt, cutoffMs)),
    gitWorkflowEvents: payload.gitWorkflowEvents.filter((event) => isWithinRetention(event.createdAt, cutoffMs)),
    githubActionsEvents: payload.githubActionsEvents.filter((event) => isWithinRetention(event.checkedAt, cutoffMs)),
    localPreviews: payload.localPreviews.filter((preview) => isWithinRetention(preview.updatedAt, cutoffMs)),
    terminalSnapshots: terminalsForLocalHistory(
      payload.terminalSnapshots.filter((terminal) => isWithinRetention(terminal.startedAt, cutoffMs))
    ),
    hostHandoffs: payload.hostHandoffs.filter((handoff) => isWithinRetention(handoff.createdAt, cutoffMs)),
    ...(payload.codexThreadId ? { codexThreadId: payload.codexThreadId } : {})
  };
}

export function normalizeLocalRoomHistory(value: ChatMessage[] | LocalRoomHistoryPayload): LocalRoomHistoryPayload {
  if (Array.isArray(value)) {
    return {
      version: 3,
      messages: normalizeChatHistoryMessages(value),
      terminalRequests: [],
      browserRequests: [],
      inviteRequests: [],
      codexEvents: [],
      gitWorkflowEvents: [],
      githubActionsEvents: [],
      localPreviews: [],
      terminalSnapshots: [],
      hostHandoffs: []
    };
  }

  const codexThreadId = normalizeCodexThreadId(value.codexThreadId);
  return {
    version: 3,
    messages: Array.isArray(value.messages) ? normalizeChatHistoryMessages(value.messages) : [],
    terminalRequests: Array.isArray(value.terminalRequests) ? value.terminalRequests.filter(isTerminalCommandRequest) : [],
    browserRequests: Array.isArray(value.browserRequests) ? value.browserRequests.filter(isBrowserAccessRequest) : [],
    inviteRequests: Array.isArray(value.inviteRequests) ? value.inviteRequests.filter(isInviteJoinRequest) : [],
    codexEvents: Array.isArray(value.codexEvents) ? value.codexEvents.filter(isCodexEventPlaintextPayload) : [],
    gitWorkflowEvents: Array.isArray(value.gitWorkflowEvents)
      ? value.gitWorkflowEvents.filter(isGitWorkflowEventPlaintextPayload)
      : [],
    githubActionsEvents: Array.isArray(value.githubActionsEvents)
      ? value.githubActionsEvents.filter(isGitHubActionsEventPlaintextPayload)
      : [],
    localPreviews: Array.isArray(value.localPreviews) ? value.localPreviews.filter(isLocalPreviewPlaintextPayload) : [],
    terminalSnapshots: Array.isArray(value.terminalSnapshots)
      ? terminalsForLocalHistory(value.terminalSnapshots.filter(isTerminalSnapshot))
      : [],
    hostHandoffs: Array.isArray(value.hostHandoffs) ? value.hostHandoffs.filter(isHostHandoffRecord) : [],
    ...(codexThreadId ? { codexThreadId } : {})
  };
}

export function isChatMessage(value: unknown): value is ChatMessage {
  const normalized = normalizeChatMessage(value);
  return Boolean(
    normalized &&
      (normalized.reactions === undefined || (Array.isArray(normalized.reactions) && normalized.reactions.every(isChatReaction)))
  );
}

export function isChatReactionPlaintextPayload(value: unknown): value is ChatReactionPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.messageId === "string" &&
    typeof value.emoji === "string" &&
    (value.action === "add" || value.action === "remove") &&
    typeof value.reactor === "string" &&
    typeof value.reactorUserId === "string" &&
    typeof value.createdAt === "string"
  );
}

export function isCodexApprovalPlaintextPayload(value: unknown): value is CodexApprovalPlaintextPayload {
  return CodexApprovalPlaintextPayloadSchema.safeParse(value).success;
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

export function isRequestStatusPlaintextPayload(value: unknown): value is RequestStatusPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.requestId === "string" &&
    (value.status === "approved" || value.status === "denied") &&
    typeof value.decidedBy === "string" &&
    typeof value.decidedByUserId === "string" &&
    typeof value.decidedAt === "string"
  );
}

export function isInviteJoinRequestPlaintextPayload(value: unknown): value is InviteJoinRequestPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "invite.request" &&
    typeof value.id === "string" &&
    (value.inviteId === undefined || typeof value.inviteId === "string") &&
    typeof value.requester === "string" &&
    typeof value.requesterUserId === "string" &&
    typeof value.requesterDeviceId === "string" &&
    (value.requesterPublicKeyJwk === undefined || DevicePublicKeyJwk.safeParse(value.requesterPublicKeyJwk).success) &&
    (value.requesterPublicKeyFingerprint === undefined || typeof value.requesterPublicKeyFingerprint === "string") &&
    typeof value.requestedAt === "string" &&
    (value.note === undefined || typeof value.note === "string")
  );
}

export function isInviteJoinStatusPlaintextPayload(value: unknown): value is InviteJoinStatusPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "invite.status" &&
    typeof value.requestId === "string" &&
    (value.status === "approved" || value.status === "denied") &&
    typeof value.decidedBy === "string" &&
    typeof value.decidedByUserId === "string" &&
    typeof value.decidedAt === "string" &&
    (value.recipientDeviceId === undefined || typeof value.recipientDeviceId === "string") &&
    (value.recipientPublicKeyFingerprint === undefined || typeof value.recipientPublicKeyFingerprint === "string") &&
    (value.wrappedRoomSecret === undefined || isWrappedRoomSecretPayload(value.wrappedRoomSecret))
  );
}

export function isDeviceSealedPayload(value: unknown): value is {
  algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256";
  ephemeralPublicKeyJwk: DevicePublicKeyJwkType;
  nonce: string;
  ciphertext: string;
} {
  if (!isRecord(value)) return false;
  return (
    value.algorithm === "ECDH-P256-HKDF-SHA256-AES-GCM-256" &&
    DevicePublicKeyJwk.safeParse(value.ephemeralPublicKeyJwk).success &&
    typeof value.nonce === "string" &&
    typeof value.ciphertext === "string"
  );
}

export function isRoomKeyRotationPlaintextPayload(value: unknown): value is RoomKeyRotationPlaintextPayload {
  return RoomKeyRotationPlaintextPayloadSchema.safeParse(value).success;
}

export function isLocalPreviewPlaintextPayload(value: unknown): value is LocalPreviewPlaintextPayload {
  return LocalPreviewPlaintextPayloadSchema.safeParse(value).success;
}

export function isCodexEventPlaintextPayload(value: unknown): value is CodexEventPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "codex.turn" &&
    typeof value.turnId === "string" &&
    (value.status === "started" || value.status === "event" || value.status === "completed" || value.status === "failed") &&
    typeof value.message === "string" &&
    typeof value.model === "string" &&
    (value.threadId === undefined || typeof value.threadId === "string") &&
    (value.eventName === undefined || typeof value.eventName === "string") &&
    typeof value.host === "string" &&
    typeof value.hostUserId === "string" &&
    typeof value.createdAt === "string"
  );
}

export function isTerminalResultPlaintextPayload(value: unknown): value is TerminalResultPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "terminal.result" &&
    typeof value.requestId === "string" &&
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    (typeof value.exitStatus === "number" || value.exitStatus === null) &&
    typeof value.stdout === "string" &&
    typeof value.stderr === "string" &&
    (value.error === undefined || typeof value.error === "string") &&
    typeof value.ranBy === "string" &&
    typeof value.ranByUserId === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.finishedAt === "string"
  );
}

export function isGitWorkflowEventPlaintextPayload(value: unknown): value is GitWorkflowEventPlaintextPayload {
  if (!isRecord(value)) return false;
  const results = value.results;
  const pullRequest = value.pullRequest;
  return (
    value.eventType === "git.workflow" &&
    (value.status === "started" || value.status === "completed" || value.status === "failed" || value.status === "pr_opened") &&
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

export function isGitHubActionsEventPlaintextPayload(value: unknown): value is GitHubActionsEventPlaintextPayload {
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

export function isRoomSettingsPlaintextPayload(value: unknown): value is RoomSettingsPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "room.settings" &&
    typeof value.id === "string" &&
    isRoomSettingsName(value.setting) &&
    typeof value.previousValue === "string" &&
    typeof value.nextValue === "string" &&
    typeof value.changedBy === "string" &&
    typeof value.changedByUserId === "string" &&
    typeof value.changedAt === "string"
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
  return normalizedBody === "relay-backed encrypted hello from the room." ||
    normalizedBody === "ciphertext-only debug check." ||
    normalizedBody === "let's make the first pass feel like a coding room, not a generic chat wrapper." ||
    normalizedBody === "agree. the right rail should show files and diffs while codex is working." ||
    normalizedBody === "@codex can you wire the approval sheet to show chat delta, attachments, browser access, terminals, and workspace?" ||
    normalizedBody === "i can do that. i will use the current chat delta, selected project folder, and the dev-server terminal. i will not use browser access unless approved." ||
    normalizedBody === "next turn should also include copy-as-markdown and the secret warning.";
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
  const status = value.status;
  return isInviteJoinRequestPlaintextPayload(value) && isWorkflowStatus(status);
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
    (value.displayTitle === undefined || typeof value.displayTitle === "string") &&
    (value.runNumber === undefined || typeof value.runNumber === "number") &&
    (value.workflowId === undefined || typeof value.workflowId === "number") &&
    typeof value.status === "string" &&
    (typeof value.conclusion === "string" || value.conclusion === null) &&
    (value.branch === undefined || typeof value.branch === "string") &&
    (value.headSha === undefined || typeof value.headSha === "string") &&
    (value.event === undefined || typeof value.event === "string") &&
    typeof value.url === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRoomSettingsName(value: unknown): value is RoomSettingsPlaintextPayload["setting"] {
  return (
    value === "approvalPolicy" ||
    value === "roomName" ||
    value === "roomMode" ||
    value === "codexModel" ||
    value === "projectPath" ||
    value === "browserAllowedOrigins" ||
    value === "browserProfilePersistent"
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
    Array.isArray(value.attachmentNames) &&
    Array.isArray(value.terminals) &&
    typeof value.createdAt === "string" &&
    (value.status === "available" || value.status === "accepted")
  );
}

function isWorkflowStatus(value: unknown): value is "pending" | "approved" | "denied" {
  return value === "pending" || value === "approved" || value === "denied";
}

function isWrappedRoomSecretPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    value.algorithm === "ECDH-P256-HKDF-SHA256-AES-GCM-256" &&
    DevicePublicKeyJwk.safeParse(value.ephemeralPublicKeyJwk).success &&
    typeof value.nonce === "string" &&
    typeof value.ciphertext === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
