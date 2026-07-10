import type { RoomRecord } from "@multaiplayer/protocol";
import { useAppStore } from "../store/appStore";
import { buildCodexApprovalSnapshot, hasActionableCodexTurnContext } from "./codexTurn";
import { canUseRoomChat, roomChatGateMessage } from "./chatPolicy";
import { messageInvokesCodex } from "./codexInvoke";
import { roomLockMessage } from "./appRuntime";
import {
  formatMessageTime,
  validatePendingAttachments
} from "./appFormatters";
import { shouldApplyRoomScopedUiUpdate } from "./roomScopedUi";
import {
  codexGoalToRoomGoal,
  parseRoomGoalCommand,
  updateRoomGoalElapsed
} from "./roomGoals";
import { clearCodexGoal, setCodexGoal } from "./localBackend";
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
} from "./localBackend";

interface LocalUser {
  id: string;
  name: string;
}

export interface CodexInvokeActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: { current: string };
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
}

export function createCodexInvokeActions({
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
  publishCodexQueueEvent
}: CodexInvokeActionsOptions) {
  const store = useAppStore.getState;

  async function startRoomGoal(text: string) {
    const roomId = selectedRoom.id;
    if (!codexThreadId) {
      store().setChatMessageForRoom(roomId, "Start an approved Codex turn before setting a Codex goal.");
      return;
    }
    try {
      const goal = await setCodexGoal(roomId, codexThreadId, text, "active");
      store().setRoomGoalForRoom(roomId, codexGoalToRoomGoal(goal));
      store().setChatMessageForRoom(roomId, "Codex goal started.");
    } catch (error) {
      store().setChatMessageForRoom(roomId, `Codex goal could not be started: ${String(error)}`);
      return;
    }
    store().setDraftForRoom(roomId, "");
    store().setReplyToMessageForRoom(roomId, null);
    store().clearPendingAttachmentsForRoom(roomId);
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
      store().setChatMessageForRoom(selectedRoom.id, "Start an approved Codex turn before editing a Codex goal.");
      return;
    }
    try {
      const goal = await setCodexGoal(selectedRoom.id, codexThreadId, nextText, roomGoal.status);
      store().setRoomGoalForRoom(selectedRoom.id, codexGoalToRoomGoal(goal));
      store().setChatMessageForRoom(selectedRoom.id, "Codex goal updated.");
    } catch (error) {
      store().setChatMessageForRoom(selectedRoom.id, `Codex goal could not be updated: ${String(error)}`);
    }
  }

  async function deleteGoal() {
    if (!codexThreadId) {
      store().setRoomGoalForRoom(selectedRoom.id, null);
      return;
    }
    try {
      await clearCodexGoal(selectedRoom.id, codexThreadId);
      store().setRoomGoalForRoom(selectedRoom.id, null);
      store().setChatMessageForRoom(selectedRoom.id, "Codex goal cleared.");
    } catch (error) {
      store().setChatMessageForRoom(selectedRoom.id, `Codex goal could not be cleared: ${String(error)}`);
    }
  }

  function tickGoalElapsed() {
    if (!roomGoal || roomGoal.status !== "active") return;
    store().setRoomGoalForRoom(selectedRoom.id, updateRoomGoalElapsed(roomGoal));
  }

  async function updateCodexGoalStatus(status: RoomGoal["status"], successMessage: string) {
    if (!roomGoal) return;
    if (!codexThreadId) {
      store().setChatMessageForRoom(selectedRoom.id, "Start an approved Codex turn before updating a Codex goal.");
      return;
    }
    try {
      const goal = await setCodexGoal(selectedRoom.id, codexThreadId, roomGoal.text, status);
      store().setRoomGoalForRoom(selectedRoom.id, codexGoalToRoomGoal(goal));
      store().setChatMessageForRoom(selectedRoom.id, successMessage);
    } catch (error) {
      store().setChatMessageForRoom(selectedRoom.id, `Codex goal could not be updated: ${String(error)}`);
    }
  }

  async function sendMessage() {
    if (!hasSelectedRoom) {
      store().setChatMessageForRoom(selectedRoomIdRef.current, "Create or join a room before sending messages.");
      return;
    }
    const roomId = selectedRoom.id;
    if (isSelectedRoomLocked) {
      store().setChatMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!canUseRoomChat(selectedRoom)) {
      store().setChatMessageForRoom(roomId, roomChatGateMessage(selectedRoom));
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
      store().setChatMessageForRoom(roomId, attachmentError);
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
    store().setDraftForRoom(roomId, "");
    store().setReplyToMessageForRoom(roomId, null);
    store().clearPendingAttachmentsForRoom(roomId);
  }

  function handleCodexInvoke(pendingMessage?: ChatMessage) {
    if (!hasSelectedRoom) {
      store().setHostMessageForRoom(selectedRoomIdRef.current, "Create or join a room before invoking Codex.");
      return;
    }
    const roomId = selectedRoom.id;
    if (isSelectedRoomLocked) {
      store().setHostMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      store().setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (!canUseRoomChat(selectedRoom)) {
      store().setHostMessageForRoom(roomId, roomChatGateMessage(selectedRoom));
      store().setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (selectedRoom.approvalPolicy === "never_host") {
      store().setHostMessageForRoom(roomId, "This room is set to never host Codex turns.");
      store().setPendingCodexApprovalForRoom(roomId, null);
      store().setApprovalVisibleForRoom(roomId, false);
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
        store().setHostMessageForRoom(roomId, "Codex queue is full. Wait for one turn to finish or cancel a queued turn.");
        return;
      }
      store().enqueueCodexApprovalForRoom(roomId, turnIntent);
      const queuePosition = queuedCodexApprovals.length + 1;
      store().setHostMessageForRoom(roomId, `Proposed Codex turn ${queuePosition} of 5 for host approval.`);
      publishCodexQueueEvent({
        turnId: turnIntent.turnId,
        action: "queued",
        ...(turnIntent.triggerMessageId ? { triggerMessageId: turnIntent.triggerMessageId } : {}),
        queuePosition,
        queueSize: queuePosition
      }, selectedRoom).catch((error) => {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) store().setHostMessageForRoom(roomId, String(error));
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
      store().setHostMessageForRoom(roomId, "Codex needs a new message, attachment, or room context before starting another turn.");
      store().setApprovalVisibleForRoom(roomId, false);
      return;
    }
    store().enqueueCodexApprovalForRoom(roomId, turnIntent);
    publishCodexQueueEvent({
      turnId: turnIntent.turnId,
      action: "queued",
      ...(turnIntent.triggerMessageId ? { triggerMessageId: turnIntent.triggerMessageId } : {}),
      queuePosition: 1,
      queueSize: 1
    }, selectedRoom).catch((error) => {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) store().setHostMessageForRoom(roomId, String(error));
    });
    store().setPendingCodexApprovalForRoom(roomId, isActiveHost ? approvalSnapshot : null);
    store().setApprovalVisibleForRoom(roomId, isActiveHost);
    store().setHostMessageForRoom(
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
