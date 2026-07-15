import { defaultCodexSandboxLevel } from "@multaiplayer/protocol";
import { runCodexTurn, getCodexGoal } from "../lib/localBackend";
import { codexGoalToRoomGoal } from "../lib/roomGoals";
import { assessCodexCompatibility } from "../lib/codexCompatibility";
import { resolveCodexRunSettings } from "../lib/codexCatalogResolver";
import { canApproveCodexTurn } from "../lib/codexApproval";
import {
  buildCodexTurnInput,
  buildCodexTurnSummary,
  detectCodexTurnRiskFlags,
  hasActionableCodexTurnContext,
  messagesSinceLastCodex
} from "../lib/codexTurn";
import { normalizeCodexThreadId } from "../lib/codexThread";
import { codexHostFailureRoomMessage, projectCodexRoomEvent, projectCodexRoomStatus } from "../lib/codexRoomSharing";
import { classifyCodexFailure } from "../lib/codexFailure";
import { formatCodexModel, formatMessageTime } from "../lib/appFormatters";
import { roomLockMessage } from "../lib/appRuntime";
import { canUseLocalWorkspace } from "../lib/workspaceAccess";
import { useAppStore } from "../store/appStore";
import { reportNonFatal } from "../lib/nonFatalReporting";
import type { PendingCodexApproval } from "../types";
import type { UseCodexTurnActionsOptions } from "./codexTurnActionTypes";
import { promoteNextCodexApproval } from "./codexApprovalPromotion";
import { refreshApprovalMessagesFromRoom } from "./codexTurnQueue";
import { handleCodexUsageLimit as executeCodexUsageLimit } from "./codexUsageLimit";
import { createCodexImageAttachment } from "../lib/codexGeneratedImage";

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

  async function approveCodexTurn(approval: PendingCodexApproval | null = null) {
    const state = useAppStore.getState();
    const selectedRoom = state.rooms.find((item) => item.id === state.selectedRoomId);
    const activeCodexApproval = selectedRoom
      ? (state.codexRuntimeByRoom[selectedRoom.id]?.pendingApproval ?? null)
      : null;
    approval ??= activeCodexApproval;
    const roomId = approval?.roomId ?? selectedRoom?.id ?? state.selectedRoomId;
    const room = state.rooms.find((item) => item.id === roomId);
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
    const browserRequestsByRoom = { [roomId]: state.browserByRoom[roomId]?.requests ?? [] };
    const gitStatusByRoom = { [roomId]: state.gitWorkflowRuntimeByRoom[roomId]?.workflow?.status ?? null };
    const codexContinuationByRoom = { [roomId]: state.codexRuntimeByRoom[roomId]?.continuation ?? null };
    const codexThreadIdsByRoom = {
      [roomId]: state.codexRuntimeByRoom[roomId]?.threadGraph?.activeThreadId ?? ""
    };
    if (!room) {
      setHostMessageForRoom(roomId, "This Codex approval belongs to a room that is no longer available.");
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    const roomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const roomLocked = forgottenRoomIds.has(room.id) || roomRevoked;
    const roomCanReadLocalWorkspace = canUseLocalWorkspace(room, localUser, roomLocked);
    if (roomLocked) {
      setHostMessageForRoom(roomId, roomLockMessage(room, roomRevoked));
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    const roomHostGateMessage =
      room.hostStatus === "active"
        ? `Only ${room.host} can approve host-side actions in this room.`
        : "Claim host before approving host-side actions in this room.";
    if (room.approvalPolicy === "never_host") {
      setHostMessageForRoom(roomId, "This room is set to never host Codex turns.");
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (!canApproveCodexTurn(room, localUser, roomLocked)) {
      setHostMessageForRoom(roomId, roomHostGateMessage);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    const compatibility = assessCodexCompatibility(codexProbe?.version);
    if (codexProbe?.available && compatibility.status === "unsupported_older") {
      setHostMessageForRoom(roomId, compatibility.message);
      setApprovalVisibleForRoom(roomId, true);
      return;
    }
    const currentRoomMessages = messagesByRoom[roomId] ?? [];
    const turnMessages = approval?.messages
      ? refreshApprovalMessagesFromRoom(approval.messages, currentRoomMessages)
      : currentRoomMessages;
    const turnSummary = buildCodexTurnSummary(
      turnMessages,
      room,
      terminals.filter((terminal) => terminal.roomId === roomId),
      browserRequestsByRoom[roomId] ?? [],
      gitStatusByRoom[roomId] ?? null,
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
    const continuationHandoff = codexContinuationByRoom[roomId] ?? null;
    const input = buildCodexTurnInput(turnMessages, projectPath, model, turnSummary, {
      fullRoomContext: Boolean(continuationHandoff)
    });
    const riskFlags = detectCodexTurnRiskFlags(
      turnMessages,
      room,
      browserRequestsByRoom[roomId] ?? [],
      gitStatusByRoom[roomId] ?? null,
      { includeWorkspaceContext: roomCanReadLocalWorkspace }
    );
    const consumedMessageIds = messagesSinceLastCodex(turnMessages)
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));
    const previousThreadId = codexThreadIdsByRoom[roomId] ?? null;
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
      if (classifyCodexFailure([result.status, result.stderr, result.transcript, ...result.events]) === "usage_limit") {
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
      const threadId = normalizeCodexThreadId(result.threadId);
      if (threadId) {
        setCodexThreadIdForRoom(roomId, threadId);
        void getCodexGoal(roomId, threadId)
          .then((goal) => {
            setRoomGoalForRoom(roomId, goal ? codexGoalToRoomGoal(goal) : null);
          })
          .catch(() => reportNonFatal("load a Codex goal after completing a turn"));
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
      await publishCodexEvent(
        {
          turnId,
          status: "failed",
          message: codexHostFailureRoomMessage,
          model
        },
        room
      );
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
      if (continuationHandoff) {
        setCodexContinuationForRoom(roomId, null);
      }
      setCodexRunningForRoom(roomId, false);
      promoteNextCodexApprovalForRoom(roomId);
    }
  }

  return {
    approveCodexTurn,
    promoteNextCodexApprovalForRoom
  };
}
