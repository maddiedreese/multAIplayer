import type { GitHubActionsEventPlaintextPayload, GitWorkflowEventPlaintextPayload } from "@multaiplayer/protocol";
import {
  defaultCodexSandboxLevel,
  maxEmbeddedAttachmentBytesPerMessage,
  maxMessageAttachments
} from "@multaiplayer/protocol";
import type { GitHubActionRun } from "../lib/authClient";
import type { TerminalSnapshot } from "../lib/localBackend";
import type {
  BrowserAccessRequest,
  ChatAttachment,
  ChatMessage,
  CodexRoomEvent,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewRecord,
  PendingCodexApproval,
  QueuedCodexTurn,
  TerminalCommandRequest
} from "../types";
import { formatBytes, formatCodexSandboxLevel, formatHostStatus } from "../lib/appFormatters";
import { formatApprovalAttachments, formatApprovalMessages } from "../lib/codexApprovalSummary";
import { buildLocalPreviewCards, buildPendingAttachmentRows, buildRoomChatMessageRows } from "../lib/chatDisplayRows";
import { detectCodexTurnRiskFlags, messagesSinceLastCodex } from "../lib/codexTurn";
import { inspectorAttentionCounts } from "../lib/inspectorAttention";
import { canUseRoomChat } from "../lib/chatPolicy";
import { canControlRoomTerminal } from "../lib/terminalAccess";
import type { LocalHostUser } from "../lib/roomHost";
import type { RoomRecord } from "@multaiplayer/protocol";

interface UseSelectedRoomRuntimeOptions {
  selectedRoom: RoomRecord;
  selectedRoomId: string;
  markdownSelectionMode: boolean;
  selectedMessageIds: string[];
  localUser: LocalHostUser;
  isSelectedRoomLocked: boolean;
  messages: ChatMessage[];
  replyToMessageId: string | null;
  pendingAttachments: ChatAttachment[];
  pendingAttachmentBytes: number;
  browserRequests: BrowserAccessRequest[];
  roomTerminals: TerminalSnapshot[];
  selectedTerminalId: string | null;
  pendingCodexApprovalsByRoom: Record<string, PendingCodexApproval | null>;
  queuedCodexApprovalsByRoom: Record<string, QueuedCodexTurn[]>;
  approvalVisibleByRoom: Record<string, boolean>;
  hostHandoffsByRoom: Record<string, HostHandoffRecord[]>;
  terminalRequestsByRoom: Record<string, TerminalCommandRequest[]>;
  localPreviewsByRoom: Record<string, LocalPreviewRecord[]>;
  localPreviewBusyByRoom: Record<string, boolean>;
  inviteRequestsByRoom: Record<string, InviteJoinRequest[]>;
  codexEventsByRoom: Record<string, CodexRoomEvent[]>;
  gitWorkflowEventsByRoom: Record<string, GitWorkflowEventPlaintextPayload[]>;
  githubActionsEventsByRoom: Record<string, GitHubActionsEventPlaintextPayload[]>;
  codexThreadIdsByRoom: Record<string, string | null>;
  codexRunningByRoom: Record<string, boolean>;
  hostBusyByRoom: Record<string, boolean>;
  settingsBusyByRoom: Record<string, boolean>;
  keyRotationBusyByRoom: Record<string, boolean>;
}

export function useSelectedRoomRuntime({
  selectedRoom,
  selectedRoomId,
  markdownSelectionMode,
  selectedMessageIds,
  localUser,
  isSelectedRoomLocked,
  messages,
  replyToMessageId,
  pendingAttachments,
  pendingAttachmentBytes,
  browserRequests,
  roomTerminals,
  selectedTerminalId,
  pendingCodexApprovalsByRoom,
  queuedCodexApprovalsByRoom,
  approvalVisibleByRoom,
  hostHandoffsByRoom,
  terminalRequestsByRoom,
  localPreviewsByRoom,
  localPreviewBusyByRoom,
  inviteRequestsByRoom,
  codexEventsByRoom,
  gitWorkflowEventsByRoom,
  githubActionsEventsByRoom,
  codexThreadIdsByRoom,
  codexRunningByRoom,
  hostBusyByRoom,
  settingsBusyByRoom,
  keyRotationBusyByRoom
}: UseSelectedRoomRuntimeOptions) {
  const roomId = selectedRoom.id ?? selectedRoomId;
  const activeCodexApproval = pendingCodexApprovalsByRoom[roomId] ?? null;
  const queuedCodexApprovals = queuedCodexApprovalsByRoom[roomId] ?? [];
  const approvalVisible = approvalVisibleByRoom[roomId] ?? false;
  const selectedTerminal = roomTerminals.find((terminal) => terminal.id === selectedTerminalId) ?? null;
  const selectedTerminalCanRestart = Boolean(selectedTerminal && !selectedTerminal.running);
  const selectedTerminalCanControl = canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked);
  const hostHandoffs = hostHandoffsByRoom[roomId] ?? [];
  const terminalRequests = terminalRequestsByRoom[roomId] ?? [];
  const localPreviews = localPreviewsByRoom[roomId] ?? [];
  const localPreviewBusy = localPreviewBusyByRoom[roomId] ?? false;
  const inspectorAttention = inspectorAttentionCounts({ approvalVisible, terminalRequests, browserRequests });
  const inviteRequests = inviteRequestsByRoom[roomId] ?? [];
  const codexEvents = codexEventsByRoom[roomId] ?? [];
  const gitWorkflowEvents = gitWorkflowEventsByRoom[roomId] ?? [];
  const githubActionsEvents = githubActionsEventsByRoom[roomId] ?? [];
  const selectedCodexThreadId = codexThreadIdsByRoom[roomId] ?? null;
  const codexRunning = codexRunningByRoom[roomId] ?? false;
  const approvalTranscriptMessages = messagesSinceLastCodex(activeCodexApproval?.messages ?? messages) as ChatMessage[];
  const replyTargetMessage = replyToMessageId ? messages.find((message) => message.id === replyToMessageId) ?? null : null;
  const replyTarget = replyTargetMessage
    ? {
        author: replyTargetMessage.deletedAt ? "Original message" : replyTargetMessage.author,
        body: replyTargetMessage.deletedAt
          ? "Original message deleted"
          : replyTargetMessage.body || "Original message unavailable or deleted"
      }
    : null;
  const codexApprovalSummaryDisplay = {
    messages: formatApprovalMessages(approvalTranscriptMessages),
    attachments: formatApprovalAttachments(approvalTranscriptMessages),
    sandbox: formatCodexSandboxLevel(selectedRoom.codexSandboxLevel ?? defaultCodexSandboxLevel),
    highPrivilegeLabels: activeCodexApproval
      ? codexHighPrivilegeLabels(activeCodexApproval.summary, selectedRoom.codexSandboxLevel ?? defaultCodexSandboxLevel)
      : [],
    riskFlags: activeCodexApproval
      ? detectCodexTurnRiskFlags(approvalTranscriptMessages, selectedRoom, browserRequests, null)
      : []
  };
  const currentMessagesSinceLastCodex = messagesSinceLastCodex(messages).length;
  const queuedCodexTurnRows = queuedCodexApprovals.map((turn) => ({
    turnId: turn.turnId,
    requestedBy: turn.requestedBy,
    requestedByUserId: turn.requestedByUserId,
    queuedAt: turn.queuedAt,
    messagesSinceLastCodex: currentMessagesSinceLastCodex,
    canCancel: !isSelectedRoomLocked && (turn.requestedByUserId === localUser.id || selectedRoom.hostUserId === localUser.id)
  }));
  const chatMessageRows = buildRoomChatMessageRows({
    messages,
    markdownSelectionMode,
    selectedMessageIds,
    localUserId: localUser.id,
    codexEvents
  });
  const pendingAttachmentRows = buildPendingAttachmentRows(pendingAttachments);
  const localPreviewCards = buildLocalPreviewCards(localPreviews, localUser.id);
  const pendingAttachmentSummary =
    `${pendingAttachments.length}/${maxMessageAttachments} files · ` +
    `${formatBytes(pendingAttachmentBytes)}/${formatBytes(maxEmbeddedAttachmentBytesPerMessage)}`;
  const hostBusy = hostBusyByRoom[roomId] ?? false;
  const settingsBusy = settingsBusyByRoom[roomId] ?? false;
  const keyRotationBusy = keyRotationBusyByRoom[roomId] ?? false;
  const hostStatusLabel = formatHostStatus(selectedRoom);
  const roomCanUseChat = canUseRoomChat(selectedRoom, isSelectedRoomLocked);

  return {
    activeCodexApproval,
    queuedCodexApprovals,
    approvalVisible,
    selectedTerminal,
    selectedTerminalCanRestart,
    selectedTerminalCanControl,
    hostHandoffs,
    terminalRequests,
    localPreviews,
    localPreviewBusy,
    inspectorAttention,
    inviteRequests,
    codexEvents,
    gitWorkflowEvents,
    githubActionsEvents,
    selectedCodexThreadId,
    codexRunning,
    approvalTranscriptMessages,
    codexApprovalSummaryDisplay,
    queuedCodexTurnRows,
    chatMessageRows,
    replyTarget,
    pendingAttachmentRows,
    localPreviewCards,
    pendingAttachmentSummary,
    hostBusy,
    settingsBusy,
    keyRotationBusy,
    hostStatusLabel,
    roomCanUseChat
  };
}

function codexHighPrivilegeLabels(
  summary: { attachments: unknown[]; workspacePath: string | null; git: unknown | null; browserAccess: unknown[]; terminals: unknown[] },
  sandboxLevel: string
): string[] {
  const labels: string[] = [];
  if (sandboxLevel === "danger_full_access") labels.push("full-access Codex");
  if (summary.terminals.length > 0) labels.push("terminal context");
  if (summary.workspacePath || summary.git) labels.push("workspace/Git context");
  if (summary.browserAccess.length > 0) labels.push("browser context");
  if (summary.attachments.length > 0) labels.push("attachments");
  return labels;
}
