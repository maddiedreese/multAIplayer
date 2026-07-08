import type { MutableRefObject } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { buildCodexApprovalSnapshot } from "../lib/codexTurn";
import { shouldAutoApproveChatOnlyTurn } from "../lib/codexApproval";
import { canUseRoomChat, roomChatGateMessage } from "../lib/chatPolicy";
import { messageInvokesCodex } from "../lib/codexInvoke";
import { roomLockMessage } from "../lib/appRuntime";
import {
  formatMessageTime,
  validatePendingAttachments
} from "../lib/appFormatters";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import {
  createRoomGoal,
  editRoomGoal,
  parseRoomGoalCommand,
  pauseRoomGoal,
  resumeRoomGoal,
  updateRoomGoalElapsed
} from "../lib/roomGoals";
import type {
  BrowserAccessRequest,
  ChatAttachment,
  ChatMessage,
  PendingCodexApproval,
  QueuedCodexTurn,
  RoomGoal
} from "../types";
import type {
  GitStatusSummary,
  TerminalSnapshot
} from "../lib/localBackend";

interface LocalUser {
  id: string;
  name: string;
}

interface UseCodexInvokeActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  isActiveHost: boolean;
  codexRunning: boolean;
  canReadLocalWorkspace: boolean;
  hostGateMessage: string;
  localUser: LocalUser;
  draft: string;
  replyToMessageId: string | null;
  roomGoal: RoomGoal | null;
  pendingAttachments: ChatAttachment[];
  messages: ChatMessage[];
  roomTerminals: TerminalSnapshot[];
  browserRequests: BrowserAccessRequest[];
  gitStatus: GitStatusSummary | null;
  activeCodexApproval: PendingCodexApproval | null;
  queuedCodexApprovals: QueuedCodexTurn[];
  publishChatMessage: (message: ChatMessage, room?: RoomRecord) => Promise<void>;
  handleCodexBrowserOpenCommand: (message: ChatMessage, room: RoomRecord) => boolean;
  approveCodexTurn: (approval?: PendingCodexApproval | null) => Promise<void>;
  setSelectedChatMessage: (message: string | null) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  setSelectedHostMessage: (message: string | null) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setPendingCodexApprovalForRoom: (roomId: string, approval: PendingCodexApproval | null) => void;
  enqueueCodexApprovalForRoom: (roomId: string, turn: QueuedCodexTurn) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  setDraftForRoom: (roomId: string, draft: string) => void;
  setReplyToMessageForRoom: (roomId: string, messageId: string | null) => void;
  setRoomGoalForRoom: (roomId: string, goal: RoomGoal | null) => void;
  clearPendingAttachmentsForRoom: (roomId: string) => void;
}

export function useCodexInvokeActions({
  hasSelectedRoom,
  selectedRoom,
  selectedRoomIdRef,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  isActiveHost,
  codexRunning,
  canReadLocalWorkspace,
  hostGateMessage,
  localUser,
  draft,
  replyToMessageId,
  roomGoal,
  pendingAttachments,
  messages,
  roomTerminals,
  browserRequests,
  gitStatus,
  activeCodexApproval,
  queuedCodexApprovals,
  publishChatMessage,
  handleCodexBrowserOpenCommand,
  approveCodexTurn,
  setSelectedChatMessage,
  setChatMessageForRoom,
  setSelectedHostMessage,
  setHostMessageForRoom,
  setPendingCodexApprovalForRoom,
  enqueueCodexApprovalForRoom,
  setApprovalVisibleForRoom,
  setDraftForRoom,
  setReplyToMessageForRoom,
  setRoomGoalForRoom,
  clearPendingAttachmentsForRoom
}: UseCodexInvokeActionsOptions) {
  function startRoomGoal(text: string) {
    const roomId = selectedRoom.id;
    setRoomGoalForRoom(roomId, createRoomGoal(text));
    setDraftForRoom(roomId, "");
    setReplyToMessageForRoom(roomId, null);
    clearPendingAttachmentsForRoom(roomId);
    setChatMessageForRoom(roomId, "Goal started.");
  }

  function pauseGoal() {
    if (!roomGoal) return;
    setRoomGoalForRoom(selectedRoom.id, pauseRoomGoal(roomGoal));
  }

  function resumeGoal() {
    if (!roomGoal) return;
    setRoomGoalForRoom(selectedRoom.id, resumeRoomGoal(roomGoal));
  }

  function editGoal(text: string) {
    if (!roomGoal) return;
    const nextText = text.trim();
    if (!nextText) return;
    setRoomGoalForRoom(selectedRoom.id, editRoomGoal(roomGoal, nextText));
  }

  function deleteGoal() {
    setRoomGoalForRoom(selectedRoom.id, null);
  }

  function tickGoalElapsed() {
    if (!roomGoal || roomGoal.status !== "running") return;
    setRoomGoalForRoom(selectedRoom.id, updateRoomGoalElapsed(roomGoal));
  }

  async function sendMessage() {
    if (!hasSelectedRoom) {
      setSelectedChatMessage("Create or join a room before sending messages.");
      return;
    }
    const roomId = selectedRoom.id;
    if (isSelectedRoomLocked) {
      setChatMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!canUseRoomChat(selectedRoom)) {
      setChatMessageForRoom(roomId, roomChatGateMessage(selectedRoom));
      return;
    }
    const attachments = pendingAttachments;
    const body = draft.trim();
    if (!body && attachments.length === 0) return;
    const goalText = parseRoomGoalCommand(body);
    if (goalText) {
      startRoomGoal(goalText);
      return;
    }
    const attachmentError = validatePendingAttachments(attachments);
    if (attachmentError) {
      setChatMessageForRoom(roomId, attachmentError);
      return;
    }
    const invokesCodex = messageInvokesCodex(body);
    const createdAt = new Date().toISOString();
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      author: localUser.name,
      role: invokesCodex ? "system" : "human",
      body: body || "Attached files.",
      time: formatMessageTime(createdAt),
      createdAt,
      replyTo: replyToMessageId ?? undefined,
      attachments: attachments.length ? attachments : undefined
    };
    await publishChatMessage(message);
    if (invokesCodex) {
      if (!handleCodexBrowserOpenCommand(message, selectedRoom)) handleCodexInvoke(message);
    }
    setDraftForRoom(roomId, "");
    setReplyToMessageForRoom(roomId, null);
    clearPendingAttachmentsForRoom(roomId);
  }

  function handleCodexInvoke(pendingMessage?: ChatMessage) {
    if (!hasSelectedRoom) {
      setSelectedHostMessage("Create or join a room before invoking Codex.");
      return;
    }
    const roomId = selectedRoom.id;
    if (isSelectedRoomLocked) {
      setHostMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (!canUseRoomChat(selectedRoom)) {
      setHostMessageForRoom(roomId, roomChatGateMessage(selectedRoom));
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (!selectedRoom.mode.code) {
      setHostMessageForRoom(roomId, "Code mode is disabled for this room.");
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (selectedRoom.approvalPolicy === "never_host") {
      setHostMessageForRoom(roomId, "This room is set to never host Codex turns.");
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    const turnIntent: QueuedCodexTurn = {
      roomId,
      turnId: crypto.randomUUID(),
      requestedBy: localUser.name,
      requestedByUserId: localUser.id,
      queuedAt: new Date().toISOString()
    };
    if (activeCodexApproval || codexRunning) {
      if (queuedCodexApprovals.length >= 5) {
        setHostMessageForRoom(roomId, "Codex queue is full. Wait for one turn to finish or cancel a queued turn.");
        return;
      }
      enqueueCodexApprovalForRoom(roomId, turnIntent);
      setHostMessageForRoom(roomId, `Queued Codex turn ${queuedCodexApprovals.length + 1} of 5.`);
      return;
    }
    const approvalSnapshot: PendingCodexApproval = {
      ...buildCodexApprovalSnapshot(selectedRoom, messages, pendingMessage, roomTerminals, browserRequests, gitStatus, {
        includeWorkspaceContext: canReadLocalWorkspace
      }),
      ...turnIntent
    };
    if (selectedRoom.approvalPolicy === "auto_chat_only") {
      if (shouldAutoApproveChatOnlyTurn(approvalSnapshot.summary, isActiveHost, approvalSnapshot.riskFlags ?? [])) {
        setPendingCodexApprovalForRoom(roomId, null);
        setApprovalVisibleForRoom(roomId, false);
        setHostMessageForRoom(roomId, "Auto-approved chat-only Codex turn.");
        approveCodexTurn(approvalSnapshot).catch((error) => {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHostMessageForRoom(roomId, String(error));
        });
        return;
      }
      setPendingCodexApprovalForRoom(roomId, approvalSnapshot);
      setApprovalVisibleForRoom(roomId, true);
      setHostMessageForRoom(
        roomId,
        isActiveHost
          ? (approvalSnapshot.riskFlags ?? []).length > 0
            ? "This turn includes content warnings, so host approval is required."
            : "This turn includes workspace, browser, terminal, or attachment context, so host approval is required."
          : hostGateMessage
      );
      return;
    }
    setPendingCodexApprovalForRoom(roomId, approvalSnapshot);
    setApprovalVisibleForRoom(roomId, true);
  }

  return {
    handleCodexInvoke,
    sendMessage,
    pauseGoal,
    resumeGoal,
    editGoal,
    deleteGoal,
    tickGoalElapsed
  };
}
