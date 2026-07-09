import type { MutableRefObject } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { buildCodexApprovalSnapshot, hasActionableCodexTurnContext } from "../lib/codexTurn";
import { canUseRoomChat, roomChatGateMessage } from "../lib/chatPolicy";
import { messageInvokesCodex } from "../lib/codexInvoke";
import { roomLockMessage } from "../lib/appRuntime";
import {
  formatMessageTime,
  validatePendingAttachments
} from "../lib/appFormatters";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import {
  codexGoalToRoomGoal,
  parseRoomGoalCommand,
  updateRoomGoalElapsed
} from "../lib/roomGoals";
import { clearCodexGoal, setCodexGoal } from "../lib/localBackend";
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
  codexThreadId: string | null;
  publishChatMessage: (message: ChatMessage, room?: RoomRecord) => Promise<void>;
  handleCodexBrowserOpenCommand: (message: ChatMessage, room: RoomRecord) => boolean;
  publishCodexQueueEvent: (
    event: {
      turnId: string;
      action: "queued" | "cancelled" | "coalesced" | "promoted" | "dropped";
      triggerMessageId?: string;
      reason?: string;
      queuePosition?: number;
      queueSize: number;
    },
    room?: RoomRecord
  ) => Promise<void>;
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
  codexThreadId,
  publishChatMessage,
  handleCodexBrowserOpenCommand,
  publishCodexQueueEvent,
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
  async function startRoomGoal(text: string) {
    const roomId = selectedRoom.id;
    if (!codexThreadId) {
      setChatMessageForRoom(roomId, "Start an approved Codex turn before setting a Codex goal.");
      return;
    }
    try {
      const goal = await setCodexGoal(roomId, codexThreadId, text, "active");
      setRoomGoalForRoom(roomId, codexGoalToRoomGoal(goal));
      setChatMessageForRoom(roomId, "Codex goal started.");
    } catch (error) {
      setChatMessageForRoom(roomId, `Codex goal could not be started: ${String(error)}`);
      return;
    }
    setDraftForRoom(roomId, "");
    setReplyToMessageForRoom(roomId, null);
    clearPendingAttachmentsForRoom(roomId);
  }

  async function pauseGoal() {
    await updateCodexGoalStatus("paused", "Codex goal paused.");
  }

  async function resumeGoal() {
    await updateCodexGoalStatus("active", "Codex goal resumed.");
  }

  async function editGoal(text: string) {
    if (!roomGoal) return;
    const nextText = text.trim();
    if (!nextText) return;
    if (!codexThreadId) {
      setChatMessageForRoom(selectedRoom.id, "Start an approved Codex turn before editing a Codex goal.");
      return;
    }
    try {
      const goal = await setCodexGoal(selectedRoom.id, codexThreadId, nextText, roomGoal.status);
      setRoomGoalForRoom(selectedRoom.id, codexGoalToRoomGoal(goal));
      setChatMessageForRoom(selectedRoom.id, "Codex goal updated.");
    } catch (error) {
      setChatMessageForRoom(selectedRoom.id, `Codex goal could not be updated: ${String(error)}`);
    }
  }

  async function deleteGoal() {
    if (!codexThreadId) {
      setRoomGoalForRoom(selectedRoom.id, null);
      return;
    }
    try {
      await clearCodexGoal(selectedRoom.id, codexThreadId);
      setRoomGoalForRoom(selectedRoom.id, null);
      setChatMessageForRoom(selectedRoom.id, "Codex goal cleared.");
    } catch (error) {
      setChatMessageForRoom(selectedRoom.id, `Codex goal could not be cleared: ${String(error)}`);
    }
  }

  function tickGoalElapsed() {
    if (!roomGoal || roomGoal.status !== "active") return;
    setRoomGoalForRoom(selectedRoom.id, updateRoomGoalElapsed(roomGoal));
  }

  async function updateCodexGoalStatus(status: RoomGoal["status"], successMessage: string) {
    if (!roomGoal) return;
    if (!codexThreadId) {
      setChatMessageForRoom(selectedRoom.id, "Start an approved Codex turn before updating a Codex goal.");
      return;
    }
    try {
      const goal = await setCodexGoal(selectedRoom.id, codexThreadId, roomGoal.text, status);
      setRoomGoalForRoom(selectedRoom.id, codexGoalToRoomGoal(goal));
      setChatMessageForRoom(selectedRoom.id, successMessage);
    } catch (error) {
      setChatMessageForRoom(selectedRoom.id, `Codex goal could not be updated: ${String(error)}`);
    }
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
      await startRoomGoal(goalText);
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
      authorUserId: localUser.id,
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
      queuedAt: new Date().toISOString(),
      ...(pendingMessage?.id ? { triggerMessageId: pendingMessage.id } : {})
    };
    if (activeCodexApproval || codexRunning || queuedCodexApprovals.length > 0) {
      if (queuedCodexApprovals.length >= 5) {
        setHostMessageForRoom(roomId, "Codex queue is full. Wait for one turn to finish or cancel a queued turn.");
        return;
      }
      enqueueCodexApprovalForRoom(roomId, turnIntent);
      const queuePosition = queuedCodexApprovals.length + 1;
      setHostMessageForRoom(roomId, `Proposed Codex turn ${queuePosition} of 5 for host approval.`);
      publishCodexQueueEvent({
        turnId: turnIntent.turnId,
        action: "queued",
        ...(turnIntent.triggerMessageId ? { triggerMessageId: turnIntent.triggerMessageId } : {}),
        queuePosition,
        queueSize: queuePosition
      }, selectedRoom).catch((error) => {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHostMessageForRoom(roomId, String(error));
      });
      return;
    }
    const approvalSnapshot: PendingCodexApproval = {
      ...buildCodexApprovalSnapshot(selectedRoom, messages, pendingMessage, roomTerminals, browserRequests, gitStatus, {
        includeWorkspaceContext: canReadLocalWorkspace
      }),
      ...turnIntent
    };
    if (!hasActionableCodexTurnContext(approvalSnapshot.summary)) {
      setHostMessageForRoom(roomId, "Codex needs a new message, attachment, or room context before starting another turn.");
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    enqueueCodexApprovalForRoom(roomId, turnIntent);
    publishCodexQueueEvent({
      turnId: turnIntent.turnId,
      action: "queued",
      ...(turnIntent.triggerMessageId ? { triggerMessageId: turnIntent.triggerMessageId } : {}),
      queuePosition: 1,
      queueSize: 1
    }, selectedRoom).catch((error) => {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHostMessageForRoom(roomId, String(error));
    });
    setPendingCodexApprovalForRoom(roomId, isActiveHost ? approvalSnapshot : null);
    setApprovalVisibleForRoom(roomId, isActiveHost);
    setHostMessageForRoom(
      roomId,
      isActiveHost
        ? "Codex turn is waiting for active-host approval."
        : hostGateMessage
    );
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
