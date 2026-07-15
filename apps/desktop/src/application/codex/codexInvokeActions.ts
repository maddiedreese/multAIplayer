import { defaultCodexModel, type CodexEventPlaintextPayload, type ClientRoomRecord } from "@multaiplayer/protocol";
import { useAppStore } from "../../store/appStore";
import { buildCodexApprovalSnapshot, hasActionableCodexTurnContext } from "../../lib/codex/codexTurn";
import { canUseRoomChat, roomChatGateMessage } from "../../lib/chat/chatPolicy";
import { messageInvokesCodex } from "../../lib/codex/codexInvoke";
import { roomLockMessage } from "../runtime/appRuntime";
import { formatMessageTime, validatePendingAttachments } from "../../lib/formatting/appFormatters";
import { shouldApplyRoomScopedUiUpdate } from "../../lib/room/roomScopedUi";
import { codexGoalToRoomGoal, parseRoomGoalCommand, updateRoomGoalElapsed } from "../../lib/room/roomGoals";
import { clearCodexGoal, setCodexGoal, steerCodexTurn, type CodexSteerResult } from "../../lib/platform/localBackend";
import { codexSteeringInput, loadCodexFollowUpBehavior } from "../../lib/codex/codexFollowUpBehavior";
import { currentSelectedRoomContext } from "../workspace/selectedWorkspace";
import type { ChatMessage, PendingCodexApproval, QueuedCodexTurn, RoomGoal } from "../../types";

type AppState = ReturnType<typeof useAppStore.getState>;
type AppCodexRuntime = AppState["codexRuntimeByRoom"][string];
type AppRoomChatRuntime = AppState["roomChatByRoom"][string];

export interface CodexInvokeActionsOptions {
  selectedRoomIdRef: { current: string };
  publishChatMessage: (message: ChatMessage, room?: ClientRoomRecord) => Promise<void>;
  handleCodexBrowserOpenCommand: (message: ChatMessage, room: ClientRoomRecord) => boolean;
  publishCodexQueueEvent: (
    event: {
      turnId: string;
      action: "queued" | "cancelled" | "coalesced" | "promoted" | "dropped";
      triggerMessageId?: string;
      reason?: string;
      queuePosition?: number;
      queueSize: number;
    },
    room?: ClientRoomRecord
  ) => Promise<void>;
  publishCodexEvent: (
    event: Omit<CodexEventPlaintextPayload, "eventType" | "host" | "hostUserId" | "createdAt">,
    room?: ClientRoomRecord
  ) => Promise<void>;
}

export function createCodexInvokeActions({
  selectedRoomIdRef,
  publishChatMessage,
  handleCodexBrowserOpenCommand,
  publishCodexQueueEvent,
  publishCodexEvent
}: CodexInvokeActionsOptions) {
  const store = useAppStore.getState;

  function currentRoomState() {
    const state = store();
    const context = currentSelectedRoomContext();
    if (!context) return null;
    const selectedRoom = context.room;
    const roomId = selectedRoom.id;
    const codexRuntime = state.codexRuntimeByRoom[roomId] ?? {};
    const roomChat = state.roomChatByRoom[roomId] ?? {};
    const isSelectedRoomRevoked = state.revokedRoomIds.has(roomId) || state.revokedTeamIds.has(selectedRoom.teamId);
    return {
      isSelectedRoomRevoked,
      isSelectedRoomLocked:
        selectedRoom.archivedAt != null || state.forgottenRoomIds.has(roomId) || isSelectedRoomRevoked,
      ...codexRoomStateFields(codexRuntime),
      ...chatRoomStateFields(roomChat),
      messages: state.messagesByRoom[roomId] ?? [],
      roomTerminals: state.terminals.filter((terminal) => terminal.roomId === roomId),
      browserRequests: state.browserByRoom[roomId]?.requests ?? [],
      gitStatus: state.gitWorkflowRuntimeByRoom[roomId]?.workflow?.status ?? null,
      selectedRoom,
      ...context
    };
  }

  function codexRoomStateFields(runtime: AppCodexRuntime) {
    return {
      codexRunning: runtime.running ?? false,
      roomGoal: runtime.goal ?? null,
      activeCodexApproval: runtime.pendingApproval ?? null,
      queuedCodexApprovals: runtime.queuedApprovals ?? [],
      codexThreadId: runtime.threadGraph?.activeThreadId ?? null
    };
  }

  function chatRoomStateFields(runtime: AppRoomChatRuntime) {
    return {
      draft: runtime.draft ?? "",
      replyToMessageId: runtime.replyToMessageId ?? null,
      pendingAttachments: runtime.pendingAttachments ?? []
    };
  }

  async function startRoomGoal(text: string) {
    const current = currentRoomState();
    if (!current) return;
    const { selectedRoom, codexThreadId } = current;
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
    const current = currentRoomState();
    if (!current) return;
    const { selectedRoom, roomGoal, codexThreadId } = current;
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
    const current = currentRoomState();
    if (!current) return;
    const { selectedRoom, codexThreadId } = current;
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
    const current = currentRoomState();
    if (!current) return;
    const { selectedRoom, roomGoal } = current;
    if (!roomGoal || roomGoal.status !== "active") return;
    store().setRoomGoalForRoom(selectedRoom.id, updateRoomGoalElapsed(roomGoal));
  }

  async function updateCodexGoalStatus(status: RoomGoal["status"], successMessage: string) {
    const current = currentRoomState();
    if (!current) return;
    const { selectedRoom, roomGoal, codexThreadId } = current;
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
    const current = currentRoomState();
    if (!current) {
      store().setChatMessageForRoom(selectedRoomIdRef.current, "Create or join a room before sending messages.");
      return;
    }
    const {
      selectedRoom,
      localUser,
      pendingAttachments,
      draft,
      replyToMessageId,
      isSelectedRoomLocked,
      isSelectedRoomRevoked
    } = current;
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
      ...(replyToMessageId ? { replyTo: replyToMessageId } : {}),
      ...(attachments.length ? { attachments } : {})
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
    const current = currentRoomState();
    if (!current) {
      store().setHostMessageForRoom(selectedRoomIdRef.current, "Create or join a room before invoking Codex.");
      return;
    }
    const {
      selectedRoom,
      localUser,
      isActiveHost,
      canReadLocalWorkspace,
      hostGateMessage,
      activeCodexApproval,
      codexRunning,
      queuedCodexApprovals,
      messages,
      roomTerminals,
      browserRequests,
      gitStatus
    } = current;
    const roomId = selectedRoom.id;
    if (!canInvokeCodex(current)) return;
    const turnIntent: QueuedCodexTurn = {
      roomId,
      turnId: crypto.randomUUID(),
      requestedBy: localUser.name,
      requestedByUserId: localUser.id,
      queuedAt: new Date().toISOString(),
      ...(pendingMessage?.id ? { triggerMessageId: pendingMessage.id } : {})
    };
    const followUpBehavior = loadCodexFollowUpBehavior();
    const steeringInput = pendingMessage ? codexSteeringInput(pendingMessage.body) : "";
    const steeringFallback = steeringFallbackMessage(
      codexRunning,
      isActiveHost,
      pendingMessage,
      followUpBehavior,
      steeringInput
    );
    if (shouldSteerCurrentTurn(codexRunning, isActiveHost, pendingMessage, followUpBehavior, steeringFallback)) {
      store().setHostMessageForRoom(roomId, "Steering the current Codex turn…");
      void (async () => {
        let result: CodexSteerResult;
        try {
          result = await steerCodexTurn(roomId, steeringInput);
        } catch {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            store().setHostMessageForRoom(
              roomId,
              "Codex could not steer the current turn. Choose Queue next turn and send the instruction again."
            );
          }
          return;
        }

        try {
          await publishCodexEvent(
            {
              turnId: result.clientTurnId,
              status: "event",
              message: `${localUser.name} steered the current Codex turn.`,
              model: selectedRoom.codexModel ?? defaultCodexModel,
              threadId: result.threadId,
              eventName: "turn/steer acknowledged",
              consumedMessageIds: [pendingMessage.id]
            },
            selectedRoom
          );
        } catch {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            store().setHostMessageForRoom(
              roomId,
              "Codex accepted the steering message, but its room acknowledgement could not be shared. Do not send the instruction again."
            );
          }
          return;
        }

        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          store().setHostMessageForRoom(roomId, "Codex accepted the steering message for the current turn.");
        }
      })();
      return;
    }
    if (activeCodexApproval || codexRunning || queuedCodexApprovals.length > 0) {
      if (queuedCodexApprovals.length >= 5) {
        store().setHostMessageForRoom(
          roomId,
          "Codex queue is full. Wait for one turn to finish or cancel a queued turn."
        );
        return;
      }
      store().enqueueCodexApprovalForRoom(roomId, turnIntent);
      const queuePosition = queuedCodexApprovals.length + 1;
      store().setHostMessageForRoom(
        roomId,
        steeringFallback ?? `Proposed Codex turn ${queuePosition} of 5 for host approval.`
      );
      publishCodexQueueEvent(
        {
          turnId: turnIntent.turnId,
          action: "queued",
          ...(turnIntent.triggerMessageId ? { triggerMessageId: turnIntent.triggerMessageId } : {}),
          queuePosition,
          queueSize: queuePosition
        },
        selectedRoom
      ).catch((error) => {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
          store().setHostMessageForRoom(roomId, String(error));
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
      store().setHostMessageForRoom(
        roomId,
        "Codex needs a new message, attachment, or room context before starting another turn."
      );
      store().setApprovalVisibleForRoom(roomId, false);
      return;
    }
    store().enqueueCodexApprovalForRoom(roomId, turnIntent);
    publishCodexQueueEvent(
      {
        turnId: turnIntent.turnId,
        action: "queued",
        ...(turnIntent.triggerMessageId ? { triggerMessageId: turnIntent.triggerMessageId } : {}),
        queuePosition: 1,
        queueSize: 1
      },
      selectedRoom
    ).catch((error) => {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
        store().setHostMessageForRoom(roomId, String(error));
    });
    store().setPendingCodexApprovalForRoom(roomId, isActiveHost ? approvalSnapshot : null);
    store().setApprovalVisibleForRoom(roomId, isActiveHost);
    store().setHostMessageForRoom(
      roomId,
      isActiveHost ? "Codex turn is waiting for active-host approval." : hostGateMessage
    );
  }

  function canInvokeCodex(current: NonNullable<ReturnType<typeof currentRoomState>>) {
    const { selectedRoom, isSelectedRoomLocked, isSelectedRoomRevoked } = current;
    const roomId = selectedRoom.id;
    const gateMessage = isSelectedRoomLocked
      ? roomLockMessage(selectedRoom, isSelectedRoomRevoked)
      : !canUseRoomChat(selectedRoom)
        ? roomChatGateMessage(selectedRoom)
        : selectedRoom.approvalPolicy === "never_host"
          ? "This room is set to never host Codex turns."
          : null;
    if (!gateMessage) return true;
    store().setHostMessageForRoom(roomId, gateMessage);
    if (selectedRoom.approvalPolicy === "never_host") store().setPendingCodexApprovalForRoom(roomId, null);
    store().setApprovalVisibleForRoom(roomId, false);
    return false;
  }

  function steeringFallbackMessage(
    running: boolean,
    activeHost: boolean,
    message: ChatMessage | undefined,
    behavior: ReturnType<typeof loadCodexFollowUpBehavior>,
    steeringInput: string
  ) {
    if (!running || !activeHost || !message || behavior !== "steer") return null;
    if (message.attachments?.length) {
      return "Attachments cannot be added to an in-flight turn, so this was queued for the next turn.";
    }
    return steeringInput ? null : "The message has no steering instruction, so it was queued for the next turn.";
  }

  function shouldSteerCurrentTurn(
    running: boolean,
    activeHost: boolean,
    message: ChatMessage | undefined,
    behavior: ReturnType<typeof loadCodexFollowUpBehavior>,
    fallback: string | null
  ): message is ChatMessage {
    return running && activeHost && Boolean(message) && behavior === "steer" && !fallback;
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
