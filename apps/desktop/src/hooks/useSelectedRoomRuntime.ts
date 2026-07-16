import type { GitHubActionsEventPlaintextPayload, GitWorkflowEventPlaintextPayload } from "@multaiplayer/protocol";
import {
  defaultCodexSandboxLevel,
  maxEmbeddedAttachmentBytesPerMessage,
  maxMessageAttachments
} from "@multaiplayer/protocol";
import type { TerminalSnapshot } from "../lib/platform/localBackend";
import type {
  BrowserAccessRequest,
  ChatAttachment,
  ChatMessage,
  CodexRoomEvent,
  CodexActivity,
  CodexThreadGraph,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewRecord,
  PendingCodexApproval,
  QueuedCodexTurn,
  TerminalCommandRequest
} from "../types";
import { formatBytes, formatCodexSandboxLevel, formatHostStatus } from "../lib/formatting/appFormatters";
import { formatApprovalAttachments, formatApprovalMessages } from "../presentation/codex/codexApprovalSummary";
import { detectCodexTurnRiskFlags, messagesSinceLastCodex } from "../lib/codex/codexTurn";
import { inspectorAttentionCounts } from "../presentation/inspector/inspectorAttention";
import { canUseRoomChat } from "../lib/chat/chatPolicy";
import { canControlRoomTerminal } from "../lib/terminal/terminalAccess";
import type { LocalHostUser } from "../lib/access/roomHost";
import type { ClientRoomRecord } from "@multaiplayer/protocol";

export interface SelectedRoomRuntimeValues {
  activeCodexApproval: PendingCodexApproval | null;
  queuedCodexApprovals: QueuedCodexTurn[];
  approvalVisible: boolean;
  hostHandoffs: HostHandoffRecord[];
  terminalRequests: TerminalCommandRequest[];
  localPreviews: LocalPreviewRecord[];
  localPreviewBusy: boolean;
  inviteRequests: InviteJoinRequest[];
  codexEvents: CodexRoomEvent[];
  codexActivities: CodexActivity[];
  gitWorkflowEvents: GitWorkflowEventPlaintextPayload[];
  githubActionsEvents: GitHubActionsEventPlaintextPayload[];
  selectedCodexThreadId: string | null;
  codexThreadGraph: CodexThreadGraph;
  codexRunning: boolean;
  hostBusy: boolean;
  settingsBusy: boolean;
  membershipCommitBusy: boolean;
}

interface UseSelectedRoomRuntimeOptions extends SelectedRoomRuntimeValues {
  selectedRoom: ClientRoomRecord | null;
  localUser: LocalHostUser;
  isSelectedRoomLocked: boolean;
  messages: ChatMessage[];
  replyToMessageId: string | null;
  pendingAttachments: ChatAttachment[];
  pendingAttachmentBytes: number;
  browserRequests: BrowserAccessRequest[];
  roomTerminals: TerminalSnapshot[];
  selectedTerminalId: string | null;
}

export function useSelectedRoomRuntime({
  selectedRoom,
  localUser,
  isSelectedRoomLocked,
  messages,
  replyToMessageId,
  pendingAttachments,
  pendingAttachmentBytes,
  browserRequests,
  roomTerminals,
  selectedTerminalId,
  activeCodexApproval,
  queuedCodexApprovals,
  approvalVisible,
  hostHandoffs,
  terminalRequests,
  localPreviews,
  localPreviewBusy,
  inviteRequests,
  codexEvents,
  codexActivities,
  gitWorkflowEvents,
  githubActionsEvents,
  selectedCodexThreadId,
  codexThreadGraph,
  codexRunning,
  hostBusy,
  settingsBusy,
  membershipCommitBusy
}: UseSelectedRoomRuntimeOptions) {
  const selectedTerminal = roomTerminals.find((terminal) => terminal.id === selectedTerminalId) ?? null;
  const selectedTerminalCanRestart = Boolean(selectedTerminal && !selectedTerminal.running);
  const selectedTerminalCanControl = selectedRoom
    ? canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked)
    : false;
  const inspectorAttention = inspectorAttentionCounts({ approvalVisible, terminalRequests, browserRequests });
  const approvalTranscriptMessages = messagesSinceLastCodex(activeCodexApproval?.messages ?? messages) as ChatMessage[];
  const replyTarget = selectReplyTarget(messages, replyToMessageId);
  const codexApprovalSummaryDisplay = {
    messages: formatApprovalMessages(approvalTranscriptMessages),
    attachments: formatApprovalAttachments(approvalTranscriptMessages),
    sandbox: formatCodexSandboxLevel(selectedRoom?.codexSandboxLevel ?? defaultCodexSandboxLevel),
    highPrivilegeLabels: activeCodexApproval
      ? codexHighPrivilegeLabels(
          activeCodexApproval.summary,
          selectedRoom?.codexSandboxLevel ?? defaultCodexSandboxLevel
        )
      : [],
    riskFlags: activeCodexApproval ? detectCodexTurnRiskFlags(approvalTranscriptMessages, null) : []
  };
  const currentMessagesSinceLastCodex = messagesSinceLastCodex(messages).length;
  const queuedCodexTurnRows = queuedCodexApprovals.map((turn) => ({
    turnId: turn.turnId,
    requestedBy: turn.requestedBy,
    requestedByUserId: turn.requestedByUserId,
    queuedAt: turn.queuedAt,
    messagesSinceLastCodex: currentMessagesSinceLastCodex,
    canCancel:
      !isSelectedRoomLocked && (turn.requestedByUserId === localUser.id || selectedRoom?.hostUserId === localUser.id)
  }));
  const pendingAttachmentSummary =
    `${pendingAttachments.length}/${maxMessageAttachments} files · ` +
    `${formatBytes(pendingAttachmentBytes)}/${formatBytes(maxEmbeddedAttachmentBytesPerMessage)}`;
  const hostStatusLabel = selectedRoom ? formatHostStatus(selectedRoom) : "No room selected";
  const roomCanUseChat = selectedRoom ? canUseRoomChat(selectedRoom, isSelectedRoomLocked) : false;

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
    codexActivities,
    gitWorkflowEvents,
    githubActionsEvents,
    selectedCodexThreadId,
    codexThreadGraph,
    codexRunning,
    approvalTranscriptMessages,
    codexApprovalSummaryDisplay,
    queuedCodexTurnRows,
    replyTarget,
    pendingAttachmentSummary,
    hostBusy,
    settingsBusy,
    membershipCommitBusy,
    hostStatusLabel,
    roomCanUseChat
  };
}

function selectReplyTarget(messages: ChatMessage[], replyToMessageId: string | null) {
  if (!replyToMessageId) return null;
  const message = messages.find((candidate) => candidate.id === replyToMessageId);
  if (!message) return null;
  return {
    author: message.deletedAt ? "Original message" : message.author,
    body: message.deletedAt ? "Original message deleted" : message.body || "Original message unavailable or deleted"
  };
}

function codexHighPrivilegeLabels(
  summary: {
    attachments: unknown[];
    workspacePath: string | null;
    git: unknown | null;
    browserAccess: unknown[];
    terminals: unknown[];
  },
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
