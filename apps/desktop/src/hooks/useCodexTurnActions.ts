import { defaultCodexSandboxLevel, type ClientRoomRecord } from "@multaiplayer/protocol";
import { runCodexTurn, getCodexGoal } from "../lib/platform/localBackend";
import { codexGoalToRoomGoal } from "../lib/room/roomGoals";
import { assessCodexCompatibility } from "../lib/codex/codexCompatibility";
import { resolveCodexRunSettings } from "../lib/codex/codexCatalogResolver";
import { canApproveCodexTurn } from "../lib/codex/codexApproval";
import {
  buildCodexTurnInput,
  buildCodexTurnSummary,
  detectCodexTurnRiskFlags,
  hasActionableCodexTurnContext,
  messagesSinceLastCodex
} from "../lib/codex/codexTurn";
import { normalizeCodexThreadId } from "../lib/codex/codexThread";
import {
  codexHostFailureRoomMessage,
  projectCodexRoomEvent,
  projectCodexRoomStatus
} from "../lib/codex/codexRoomSharing";
import { classifyCodexFailure } from "../lib/codex/codexFailure";
import { formatCodexModel, formatMessageTime } from "../lib/formatting/appFormatters";
import { roomLockMessage } from "../application/runtime/appRuntime";
import { canUseLocalWorkspace } from "../lib/access/workspaceAccess";
import { useAppStore } from "../store/appStore";
import { reportNonFatal } from "../lib/core/nonFatalReporting";
import type { PendingCodexApproval } from "../types";
import type { UseCodexTurnActionsOptions } from "./codexTurnActionTypes";
import { promoteNextCodexApproval } from "./codexApprovalPromotion";
import { refreshApprovalMessagesFromRoom } from "./codexTurnQueue";
import { handleCodexUsageLimit as executeCodexUsageLimit } from "./codexUsageLimit";
import { createCodexImageAttachment } from "../application/codex/codexGeneratedImage";

export function useCodexTurnActions({
  localUser,
  maxTerminalActivityLines,
  replaceRoom,
  publishCodexEvent,
  publishChatMessage,
  publishHostHandoff
}: UseCodexTurnActionsOptions) {
  const codexUsageLimitContext = {
    localUserId: localUser.id,
    selectedRoomId: () => useAppStore.getState().selectedRoomId,
    publishCodexEvent,
    appendTerminalLines: (roomId: string, lines: string[]) =>
      useAppStore.getState().appendTerminalLinesForRoom(roomId, lines, maxTerminalActivityLines),
    publishChatMessage,
    replaceRoom,
    publishHostHandoff,
    setHostMessage: (roomId: string, message: string | null) =>
      useAppStore.getState().setHostMessageForRoom(roomId, message)
  };

  function promoteNextCodexApprovalForRoom(roomId: string) {
    promoteNextCodexApproval({
      roomId,
      localUser,
      publishChatMessage,
      promoteNext: promoteNextCodexApprovalForRoom
    });
  }

  function validateApprovalRoom(
    room: ClientRoomRecord,
    roomId: string,
    state: ReturnType<typeof useAppStore.getState>
  ) {
    const revoked = state.revokedRoomIds.has(room.id) || state.revokedTeamIds.has(room.teamId);
    const locked = state.forgottenRoomIds.has(room.id) || revoked;
    if (locked) {
      state.setHostMessageForRoom(roomId, roomLockMessage(room, revoked));
      state.setPendingCodexApprovalForRoom(roomId, null);
      state.setApprovalVisibleForRoom(roomId, false);
      return false;
    }
    if (room.approvalPolicy === "never_host") {
      state.setHostMessageForRoom(roomId, "This room is set to never host Codex turns.");
      state.setPendingCodexApprovalForRoom(roomId, null);
      state.setApprovalVisibleForRoom(roomId, false);
      return false;
    }
    if (!canApproveCodexTurn(room, localUser, locked)) {
      const message =
        room.hostStatus === "active"
          ? `Only ${room.host} can approve host-side actions in this room.`
          : "Claim host before approving host-side actions in this room.";
      state.setHostMessageForRoom(roomId, message);
      state.setApprovalVisibleForRoom(roomId, false);
      return false;
    }
    const compatibility = assessCodexCompatibility(state.codexProbe?.version);
    if (state.codexProbe?.available && compatibility.status === "unsupported_older") {
      state.setHostMessageForRoom(roomId, compatibility.message);
      state.setApprovalVisibleForRoom(roomId, true);
      return false;
    }
    return true;
  }

  async function approveCodexTurn(approval: PendingCodexApproval | null = null) {
    const state = useAppStore.getState();
    const selected = selectCodexApprovalContext(state, approval);
    approval = selected.approval;
    const { roomId, room, browserRequests, gitStatus, codexContinuation, codexThreadId } = selected;
    const {
      codexProbe,
      forgottenRoomIds,
      revokedRoomIds,
      revokedTeamIds,
      messagesByRoom,
      terminals,
      setHostMessageForRoom,
      setPendingCodexApprovalForRoom,
      setApprovalVisibleForRoom,
      removeQueuedCodexApprovalForRoom,
      setCodexRunningForRoom,
      appendTerminalLinesForRoom,
      setCodexThreadIdForRoom,
      setCodexContinuationForRoom,
      setRoomGoalForRoom
    } = state;
    if (!room) {
      setHostMessageForRoom(roomId, "This Codex approval belongs to a room that is no longer available.");
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (!validateApprovalRoom(room, roomId, state)) return;
    const roomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const roomLocked = forgottenRoomIds.has(room.id) || roomRevoked;
    const roomCanReadLocalWorkspace = canUseLocalWorkspace(room, localUser, roomLocked);
    const currentRoomMessages = messagesByRoom[roomId] ?? [];
    const turnMessages = approval?.messages
      ? refreshApprovalMessagesFromRoom(approval.messages, currentRoomMessages)
      : currentRoomMessages;
    const turnSummary = buildCodexTurnSummary(
      turnMessages,
      room,
      terminals.filter((terminal) => terminal.roomId === roomId),
      browserRequests,
      gitStatus,
      { includeWorkspaceContext: roomCanReadLocalWorkspace }
    );
    const resolvedSettings = resolveCodexRunSettings(room, codexProbe);
    const { model, reasoningEffort, speed } = resolvedSettings;
    const sandboxLevel = room.codexSandboxLevel ?? defaultCodexSandboxLevel;
    const projectPath = room.projectPath;
    if (room.configPending) {
      setHostMessageForRoom(roomId, "Waiting for the active host's encrypted room configuration.");
      return;
    }
    if (!hasActionableCodexTurnContext(turnSummary)) {
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      setHostMessageForRoom(roomId, "The pending Codex turn became empty after room edits or deletes.");
      promoteNextCodexApprovalForRoom(roomId);
      return;
    }
    setPendingCodexApprovalForRoom(roomId, null);
    setApprovalVisibleForRoom(roomId, false);
    if (approval?.turnId) {
      removeQueuedCodexApprovalForRoom(roomId, approval.turnId);
    }
    setCodexRunningForRoom(roomId, true);
    appendTerminalLinesForRoom(
      roomId,
      [
        "$ codex app-server",
        `Starting approved Codex turn with ${formatCodexModel(model)} from encrypted room context...`,
        ...resolvedSettings.warnings.map((warning) => `Catalog fallback: ${warning}`)
      ],
      maxTerminalActivityLines
    );

    const turnId = approval?.turnId ?? crypto.randomUUID();
    const continuationHandoff = codexContinuation;
    const input = buildCodexTurnInput(turnMessages, projectPath, model, turnSummary, {
      fullRoomContext: Boolean(continuationHandoff)
    });
    const riskFlags = detectCodexTurnRiskFlags(turnMessages, gitStatus, {
      includeWorkspaceContext: roomCanReadLocalWorkspace
    });
    const consumedMessageIds = messagesSinceLastCodex(turnMessages)
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));
    const previousThreadId = codexThreadId;
    async function executeApprovedTurn(room: ClientRoomRecord) {
      try {
        await publishCodexEvent(
          {
            turnId,
            status: "started",
            message: previousThreadId
              ? `Resuming Codex thread ${previousThreadId} with ${formatCodexModel(model)}.`
              : `Started Codex turn with ${formatCodexModel(model)}.`,
            model,
            ...(consumedMessageIds.length ? { consumedMessageIds } : {}),
            ...(riskFlags.length ? { riskFlags } : {})
          },
          room
        );
        const result = await runCodexTurn(
          roomId,
          turnId,
          projectPath,
          input,
          model,
          reasoningEffort,
          speed,
          resolvedSettings.serviceTier,
          sandboxLevel,
          previousThreadId,
          180,
          {
            proposedBy: approval?.requestedBy ?? localUser.name,
            contextSummary: `${turnSummary.messagesSinceLastCodex} room message(s); ${turnSummary.attachments.length} attachment(s); ${turnSummary.browserAccess.length} approved browser origin(s); ${turnSummary.terminals.length} terminal label(s); ${turnSummary.git?.totalFiles ?? 0} Git change(s)`
          },
          room.codexRawReasoningEnabled ?? false
        );
        if (
          classifyCodexFailure([result.status, result.stderr, result.transcript, ...result.events]) === "usage_limit"
        ) {
          await executeCodexUsageLimit(
            codexUsageLimitContext,
            room,
            turnId,
            model,
            turnMessages,
            result.events,
            result.stderr
          );
          return;
        }
        await publishSuccessfulTurn(room, result);
      } catch (error) {
        if (classifyCodexFailure([String(error)]) === "usage_limit") {
          await executeCodexUsageLimit(
            codexUsageLimitContext,
            room,
            turnId,
            model,
            turnMessages,
            [String(error)],
            String(error)
          );
          return;
        }
        await publishCodexEvent({ turnId, status: "failed", message: codexHostFailureRoomMessage, model }, room);
        await publishChatMessage(
          {
            id: crypto.randomUUID(),
            author: `Codex via ${localUser.name}`,
            role: "codex",
            body: codexHostFailureRoomMessage,
            time: formatMessageTime(),
            createdAt: new Date().toISOString()
          },
          room
        );
        appendTerminalLinesForRoom(roomId, [`Codex error: ${String(error)}`], maxTerminalActivityLines);
      } finally {
        if (continuationHandoff) setCodexContinuationForRoom(roomId, null);
        setCodexRunningForRoom(roomId, false);
        promoteNextCodexApprovalForRoom(roomId);
      }
    }

    async function publishSuccessfulTurn(room: ClientRoomRecord, result: Awaited<ReturnType<typeof runCodexTurn>>) {
      const threadId = normalizeCodexThreadId(result.threadId);
      if (threadId) {
        setCodexThreadIdForRoom(roomId, threadId);
        void getCodexGoal(roomId, threadId)
          .then((goal) => {
            setRoomGoalForRoom(roomId, goal ? codexGoalToRoomGoal(goal) : null);
          })
          .catch((error) => reportNonFatal("load a Codex goal after completing a turn", error));
      }
      const roomEvents = result.events
        .map(projectCodexRoomEvent)
        .filter((eventName): eventName is string => Boolean(eventName))
        .slice(-16);
      const roomStatus = projectCodexRoomStatus(result.status);
      for (const eventName of roomEvents) {
        await publishCodexEvent(
          {
            turnId,
            status: "event",
            message: eventName,
            eventName,
            model,
            ...(threadId ? { threadId } : {})
          },
          room
        );
      }
      await publishCodexEvent(
        {
          turnId,
          status: roomStatus === "completed" ? "completed" : "failed",
          message: `Codex turn finished with status: ${roomStatus}.`,
          model,
          ...(threadId ? { threadId } : {})
        },
        room
      );
      const imageAttachments = [];
      for (const generatedImage of result.generatedImages ?? []) {
        try {
          imageAttachments.push(await createCodexImageAttachment(room, generatedImage));
        } catch (error) {
          appendTerminalLinesForRoom(
            roomId,
            [`Could not publish a Codex-generated image: ${String(error)}`],
            maxTerminalActivityLines
          );
        }
      }
      const body =
        result.transcript.trim() ||
        (imageAttachments.length
          ? "Generated an image."
          : `Codex turn finished with status: ${roomStatus}.${roomEvents.length ? ` Events: ${roomEvents.slice(0, 8).join(", ")}` : ""}`);
      await publishChatMessage(
        {
          id: crypto.randomUUID(),
          author: `Codex via ${localUser.name}`,
          role: "codex",
          body,
          time: formatMessageTime(),
          createdAt: new Date().toISOString(),
          ...(imageAttachments.length ? { attachments: imageAttachments } : {})
        },
        room
      );
      appendTerminalLinesForRoom(
        roomId,
        [
          `Codex status: ${result.status}`,
          `Codex thread: ${result.threadId ?? "unknown"}`,
          ...result.events.slice(-8).map((event) => `event: ${event}`),
          ...(result.stderr ? [`stderr: ${result.stderr}`] : [])
        ],
        maxTerminalActivityLines
      );
    }
    await executeApprovedTurn(room);
  }

  return {
    approveCodexTurn,
    promoteNextCodexApprovalForRoom
  };
}

function selectCodexApprovalContext(
  state: ReturnType<typeof useAppStore.getState>,
  requestedApproval: PendingCodexApproval | null
) {
  const selectedRoom = state.rooms.find((item) => item.id === state.selectedRoomId);
  const activeApproval = selectedRoom ? pendingApprovalForRoom(state.codexRuntimeByRoom, selectedRoom.id) : null;
  const approval = requestedApproval ?? activeApproval;
  const roomId = approval?.roomId ?? selectedRoom?.id ?? state.selectedRoomId;
  return {
    approval,
    roomId,
    room: state.rooms.find((item) => item.id === roomId),
    browserRequests: state.browserByRoom[roomId]?.requests ?? [],
    gitStatus: state.gitWorkflowRuntimeByRoom[roomId]?.workflow?.status ?? null,
    codexContinuation: state.codexRuntimeByRoom[roomId]?.continuation ?? null,
    codexThreadId: state.codexRuntimeByRoom[roomId]?.threadGraph?.activeThreadId ?? null
  };
}

function pendingApprovalForRoom(
  runtimeByRoom: ReturnType<typeof useAppStore.getState>["codexRuntimeByRoom"],
  roomId: string
) {
  return runtimeByRoom[roomId]?.pendingApproval ?? null;
}
