import type { GitHubActionsEventPlaintextPayload, GitWorkflowEventPlaintextPayload } from "@multaiplayer/protocol";
import {
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
  TerminalCommandRequest
} from "../types";
import { formatBytes, formatHostStatus } from "../lib/appFormatters";
import { formatApprovalAttachments, formatApprovalMessages } from "../lib/codexApprovalSummary";
import { buildLocalPreviewCards, buildPendingAttachmentRows, buildRoomChatMessageRows } from "../lib/chatDisplayRows";
import { messagesSinceLastCodex } from "../lib/codexTurn";
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
  pendingAttachments: ChatAttachment[];
  pendingAttachmentBytes: number;
  browserRequests: BrowserAccessRequest[];
  roomTerminals: TerminalSnapshot[];
  selectedTerminalId: string | null;
  pendingCodexApprovalsByRoom: Record<string, PendingCodexApproval | null>;
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
  pendingAttachments,
  pendingAttachmentBytes,
  browserRequests,
  roomTerminals,
  selectedTerminalId,
  pendingCodexApprovalsByRoom,
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
  const codexApprovalSummaryDisplay = {
    messages: formatApprovalMessages(approvalTranscriptMessages),
    attachments: formatApprovalAttachments(approvalTranscriptMessages)
  };
  const chatMessageRows = buildRoomChatMessageRows({
    messages,
    markdownSelectionMode,
    selectedMessageIds,
    localUserId: localUser.id
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
    chatMessageRows,
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
