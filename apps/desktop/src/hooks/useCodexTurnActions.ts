import { defaultCodexSandboxLevel } from "@multaiplayer/protocol";
import { runCodexTurn, getCodexGoal } from "../lib/localBackend";
import { codexGoalToRoomGoal } from "../lib/roomGoals";
import { assessCodexCompatibility } from "../lib/codexCompatibility";
import { resolveCodexRunSettings } from "../lib/codexCatalogResolver";
import { canApproveCodexTurn } from "../lib/codexApproval";
import {
  buildCodexApprovalSnapshot,
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
import type { PendingCodexApproval } from "../types";
import type { UseCodexTurnActionsOptions } from "./codexTurnActionTypes";
import { isExpiredCodexInvocation, refreshApprovalMessagesFromRoom } from "./codexTurnQueue";
import { handleCodexUsageLimit as executeCodexUsageLimit } from "./codexUsageLimit";

export function useCodexTurnActions({
  selectedRoom,
  codexProbe,
  activeCodexApproval,
  roomsRef,
  selectedRoomIdRef,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  localUser,
  messagesByRoom,
  terminals,
  browserRequestsByRoom,
  gitStatusByRoom,
  codexContinuationByRoom,
  codexThreadIdsByRoom,
  queuedCodexApprovalsByRoom,
  setHostMessageForRoom,
  setPendingCodexApprovalForRoom,
  setApprovalVisibleForRoom,
  removeQueuedCodexApprovalForRoom,
  setCodexRunningForRoom,
  appendTerminalLinesForRoom,
  replaceRoom,
  publishCodexEvent,
  publishChatMessage,
  publishHostHandoff
}: UseCodexTurnActionsOptions) {
  const setCodexThreadIdForRoom = useAppStore((state) => state.setCodexThreadIdForRoom);
  const setCodexContinuationForRoom = useAppStore((state) => state.setCodexContinuationForRoom);
  const setRoomGoalForRoom = useAppStore((state) => state.setRoomGoalForRoom);
  const codexUsageLimitContext = {
    localUserId: localUser.id,
    selectedRoomId: () => selectedRoomIdRef.current,
    publishCodexEvent,
    appendTerminalLines: appendTerminalLinesForRoom,
    publishChatMessage,
    replaceRoom,
    publishHostHandoff,
    setHostMessage: setHostMessageForRoom
  };

  function promoteNextCodexApprovalForRoom(roomId: string) {
    const nextTurn = queuedCodexApprovalsByRoom[roomId]?.[0];
    if (!nextTurn) return;
    if (isExpiredCodexInvocation(nextTurn.queuedAt)) {
      removeQueuedCodexApprovalForRoom(roomId, nextTurn.turnId);
      setHostMessageForRoom(
        roomId,
        `Dropped ${nextTurn.requestedBy}'s Codex proposal because host approval timed out.`
      );
      promoteNextCodexApprovalForRoom(roomId);
      return;
    }
    const room = roomsRef.current.find((item) => item.id === roomId);
    if (!room) {
      removeQueuedCodexApprovalForRoom(roomId, nextTurn.turnId);
      return;
    }
    const roomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const roomLocked = forgottenRoomIds.has(room.id) || roomRevoked;
    if (roomLocked || room.approvalPolicy === "never_host") {
      removeQueuedCodexApprovalForRoom(roomId, nextTurn.turnId);
      const cancellationMessage = roomLocked
        ? roomLockMessage(room, roomRevoked)
        : "Queued Codex turn was cancelled because Codex is unavailable in this room.";
      void publishChatMessage(
        {
          id: crypto.randomUUID(),
          author: "multAIplayer",
          role: "system",
          body: cancellationMessage,
          time: formatMessageTime(),
          createdAt: new Date().toISOString()
        },
        room
      );
      setHostMessageForRoom(roomId, cancellationMessage);
      return;
    }
    const roomCanReadLocalWorkspace = canUseLocalWorkspace(room, localUser, roomLocked);
    const approvalSnapshot = buildCodexApprovalSnapshot(
      room,
      messagesByRoom[roomId] ?? [],
      undefined,
      terminals.filter((terminal) => terminal.roomId === roomId),
      browserRequestsByRoom[roomId] ?? [],
      gitStatusByRoom[roomId] ?? null,
      { includeWorkspaceContext: roomCanReadLocalWorkspace }
    );
    if (!hasActionableCodexTurnContext(approvalSnapshot.summary)) {
      removeQueuedCodexApprovalForRoom(roomId, nextTurn.turnId);
      void publishChatMessage(
        {
          id: crypto.randomUUID(),
          author: "multAIplayer",
          role: "system",
          body: `Dropped ${nextTurn.requestedBy}'s queued Codex turn because there is no new room context to send.`,
          time: formatMessageTime(),
          createdAt: new Date().toISOString()
        },
        room
      );
      setHostMessageForRoom(roomId, "Dropped an empty queued Codex turn.");
      promoteNextCodexApprovalForRoom(roomId);
      return;
    }
    const approval = {
      ...approvalSnapshot,
      turnId: nextTurn.turnId,
      requestedBy: nextTurn.requestedBy,
      requestedByUserId: nextTurn.requestedByUserId,
      queuedAt: nextTurn.queuedAt
    };
    removeQueuedCodexApprovalForRoom(roomId, nextTurn.turnId);
    setPendingCodexApprovalForRoom(roomId, approval);
    setApprovalVisibleForRoom(roomId, true);
    setHostMessageForRoom(roomId, "Queued Codex turn is ready for host approval with current room context.");
  }

  async function approveCodexTurn(approval: PendingCodexApproval | null = activeCodexApproval) {
    const roomId = approval?.roomId ?? selectedRoom.id;
    const room = roomsRef.current.find((item) => item.id === roomId);
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
    appendTerminalLinesForRoom(roomId, [
      "$ codex app-server",
      `Starting approved Codex turn with ${formatCodexModel(model)} from encrypted room context...`,
      ...resolvedSettings.warnings.map((warning) => `Catalog fallback: ${warning}`)
    ]);

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
        previousThreadId
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
          .catch(() => undefined);
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
      const body =
        result.transcript.trim() ||
        `Codex turn finished with status: ${roomStatus}.${roomEvents.length ? ` Events: ${roomEvents.slice(0, 8).join(", ")}` : ""}`;
      await publishChatMessage(
        {
          id: crypto.randomUUID(),
          author: `Codex via ${localUser.name}`,
          role: "codex",
          body,
          time: formatMessageTime(),
          createdAt: new Date().toISOString()
        },
        room
      );
      appendTerminalLinesForRoom(roomId, [
        `Codex status: ${result.status}`,
        `Codex thread: ${result.threadId ?? "unknown"}`,
        ...result.events.slice(-8).map((event) => `event: ${event}`),
        ...(result.stderr ? [`stderr: ${result.stderr}`] : [])
      ]);
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
      appendTerminalLinesForRoom(roomId, [`Codex error: ${String(error)}`]);
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
