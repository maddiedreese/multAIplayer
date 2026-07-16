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

interface UseSelectedRoomRuntimeOptions {
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
  pendingCodexApprovalsByRoom: Record<string, PendingCodexApproval | null>;
  queuedCodexApprovalsByRoom: Record<string, QueuedCodexTurn[]>;
  approvalVisibleByRoom: Record<string, boolean>;
  hostHandoffsByRoom: Record<string, HostHandoffRecord[]>;
  terminalRequestsByRoom: Record<string, TerminalCommandRequest[]>;
  localPreviewsByRoom: Record<string, LocalPreviewRecord[]>;
  localPreviewBusyByRoom: Record<string, boolean>;
  inviteRequestsByRoom: Record<string, InviteJoinRequest[]>;
  codexEventsByRoom: Record<string, CodexRoomEvent[]>;
  codexActivitiesByRoom: Record<string, CodexActivity[]>;
  gitWorkflowEventsByRoom: Record<string, GitWorkflowEventPlaintextPayload[]>;
  githubActionsEventsByRoom: Record<string, GitHubActionsEventPlaintextPayload[]>;
  codexThreadIdsByRoom: Record<string, string | null>;
  codexThreadGraphsByRoom: Record<string, CodexThreadGraph>;
  codexRunningByRoom: Record<string, boolean>;
  hostBusyByRoom: Record<string, boolean>;
  settingsBusyByRoom: Record<string, boolean>;
  membershipCommitBusyByRoom: Record<string, boolean>;
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
  pendingCodexApprovalsByRoom,
  queuedCodexApprovalsByRoom,
  approvalVisibleByRoom,
  hostHandoffsByRoom,
  terminalRequestsByRoom,
  localPreviewsByRoom,
  localPreviewBusyByRoom,
  inviteRequestsByRoom,
  codexEventsByRoom,
  codexActivitiesByRoom,
  gitWorkflowEventsByRoom,
  githubActionsEventsByRoom,
  codexThreadIdsByRoom,
  codexThreadGraphsByRoom,
  codexRunningByRoom,
  hostBusyByRoom,
  settingsBusyByRoom,
  membershipCommitBusyByRoom
}: UseSelectedRoomRuntimeOptions) {
  const roomId = selectedRoom?.id ?? null;
  const runtime = selectRoomRuntimeCollections(
    {
      pendingCodexApprovalsByRoom,
      queuedCodexApprovalsByRoom,
      approvalVisibleByRoom,
      hostHandoffsByRoom,
      terminalRequestsByRoom,
      localPreviewsByRoom,
      localPreviewBusyByRoom,
      inviteRequestsByRoom,
      codexEventsByRoom,
      codexActivitiesByRoom,
      gitWorkflowEventsByRoom,
      githubActionsEventsByRoom,
      codexThreadIdsByRoom,
      codexThreadGraphsByRoom,
      codexRunningByRoom,
      hostBusyByRoom,
      settingsBusyByRoom,
      membershipCommitBusyByRoom
    },
    roomId
  );
  const {
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
  } = runtime;
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

function selectRoomRuntimeCollections(
  sources: Pick<
    UseSelectedRoomRuntimeOptions,
    | "pendingCodexApprovalsByRoom"
    | "queuedCodexApprovalsByRoom"
    | "approvalVisibleByRoom"
    | "hostHandoffsByRoom"
    | "terminalRequestsByRoom"
    | "localPreviewsByRoom"
    | "localPreviewBusyByRoom"
    | "inviteRequestsByRoom"
    | "codexEventsByRoom"
    | "codexActivitiesByRoom"
    | "gitWorkflowEventsByRoom"
    | "githubActionsEventsByRoom"
    | "codexThreadIdsByRoom"
    | "codexThreadGraphsByRoom"
    | "codexRunningByRoom"
    | "hostBusyByRoom"
    | "settingsBusyByRoom"
    | "membershipCommitBusyByRoom"
  >,
  roomId: string | null
) {
  if (!roomId) {
    return {
      activeCodexApproval: null,
      queuedCodexApprovals: [],
      approvalVisible: false,
      hostHandoffs: [],
      terminalRequests: [],
      localPreviews: [],
      localPreviewBusy: false,
      inviteRequests: [],
      codexEvents: [],
      codexActivities: [],
      gitWorkflowEvents: [],
      githubActionsEvents: [],
      selectedCodexThreadId: null,
      codexThreadGraph: { activeThreadId: null, nodesById: {} },
      codexRunning: false,
      hostBusy: false,
      settingsBusy: false,
      membershipCommitBusy: false
    };
  }
  return {
    activeCodexApproval: sources.pendingCodexApprovalsByRoom[roomId] ?? null,
    queuedCodexApprovals: sources.queuedCodexApprovalsByRoom[roomId] ?? [],
    approvalVisible: sources.approvalVisibleByRoom[roomId] ?? false,
    hostHandoffs: sources.hostHandoffsByRoom[roomId] ?? [],
    terminalRequests: sources.terminalRequestsByRoom[roomId] ?? [],
    localPreviews: sources.localPreviewsByRoom[roomId] ?? [],
    localPreviewBusy: sources.localPreviewBusyByRoom[roomId] ?? false,
    inviteRequests: sources.inviteRequestsByRoom[roomId] ?? [],
    codexEvents: sources.codexEventsByRoom[roomId] ?? [],
    codexActivities: sources.codexActivitiesByRoom[roomId] ?? [],
    gitWorkflowEvents: sources.gitWorkflowEventsByRoom[roomId] ?? [],
    githubActionsEvents: sources.githubActionsEventsByRoom[roomId] ?? [],
    selectedCodexThreadId: sources.codexThreadIdsByRoom[roomId] ?? null,
    codexThreadGraph: sources.codexThreadGraphsByRoom[roomId] ?? { activeThreadId: null, nodesById: {} },
    codexRunning: sources.codexRunningByRoom[roomId] ?? false,
    hostBusy: sources.hostBusyByRoom[roomId] ?? false,
    settingsBusy: sources.settingsBusyByRoom[roomId] ?? false,
    membershipCommitBusy: sources.membershipCommitBusyByRoom[roomId] ?? false
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
