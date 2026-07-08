import type { MutableRefObject } from "react";
import type {
  CodexApprovalPlaintextPayload,
  CodexEventPlaintextPayload,
  RoomRecord
} from "@multaiplayer/protocol";
import {
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed
} from "@multaiplayer/protocol";
import {
  runCodexTurn,
  shutdownCodexRoom,
  type GitStatusSummary,
  type TerminalSnapshot
} from "../lib/localBackend";
import {
  canApproveCodexTurn,
  canDelegateApproveCodexTurn,
  isDelegatedApprovalExecutionPolicy
} from "../lib/codexApproval";
import {
  buildCodexTurnInput,
  buildCodexTurnSummary
} from "../lib/codexTurn";
import { normalizeCodexThreadId } from "../lib/codexThread";
import {
  classifyCodexFailure,
  codexUsageLimitMessage
} from "../lib/codexFailure";
import {
  formatCodexModel,
  formatMessageTime
} from "../lib/appFormatters";
import { roomLockMessage } from "../lib/appRuntime";
import { canUseLocalWorkspace } from "../lib/workspaceAccess";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import { updateRoomHost } from "../lib/workspaceClient";
import { useAppStore } from "../store/appStore";
import type {
  BrowserAccessRequest,
  ChatMessage,
  HostHandoffRecord,
  PendingCodexApproval
} from "../types";

interface LocalUser {
  id: string;
  name: string;
}

interface UseCodexTurnActionsOptions {
  selectedRoom: RoomRecord;
  activeCodexApproval: PendingCodexApproval | null;
  roomsRef: MutableRefObject<RoomRecord[]>;
  selectedRoomIdRef: MutableRefObject<string>;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  localUser: LocalUser;
  messagesByRoom: Record<string, ChatMessage[]>;
  terminals: TerminalSnapshot[];
  browserRequestsByRoom: Record<string, BrowserAccessRequest[]>;
  gitStatusByRoom: Record<string, GitStatusSummary | null>;
  codexContinuationByRoom: Record<string, HostHandoffRecord>;
  codexThreadIdsByRoom: Record<string, string>;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setPendingCodexApprovalForRoom: (roomId: string, approval: PendingCodexApproval | null) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  setCodexRunningForRoom: (roomId: string, running: boolean) => void;
  appendTerminalLinesForRoom: (roomId: string, lines: string[]) => void;
  replaceRoom: (room: RoomRecord) => void;
  publishCodexEvent: (
    event: Omit<CodexEventPlaintextPayload, "eventType" | "host" | "hostUserId" | "createdAt">,
    room?: RoomRecord
  ) => Promise<void>;
  publishCodexApproval: (
    event: Omit<CodexApprovalPlaintextPayload, "eventType" | "approver" | "approverUserId" | "approvedAt">,
    room?: RoomRecord
  ) => Promise<void>;
  publishChatMessage: (message: ChatMessage, room?: RoomRecord) => Promise<void>;
  publishHostHandoff: (
    room: RoomRecord,
    reason?: HostHandoffRecord["reason"],
    handoffMessages?: ChatMessage[]
  ) => Promise<void>;
}

export function useCodexTurnActions({
  selectedRoom,
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
  setHostMessageForRoom,
  setPendingCodexApprovalForRoom,
  setApprovalVisibleForRoom,
  setCodexRunningForRoom,
  appendTerminalLinesForRoom,
  replaceRoom,
  publishCodexEvent,
  publishCodexApproval,
  publishChatMessage,
  publishHostHandoff
}: UseCodexTurnActionsOptions) {
  const setCodexThreadIdForRoom = useAppStore((state) => state.setCodexThreadIdForRoom);
  const setCodexContinuationForRoom = useAppStore((state) => state.setCodexContinuationForRoom);

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
    if (!room.mode.code) {
      setHostMessageForRoom(roomId, "Code mode is disabled for this room.");
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (room.approvalPolicy === "never_host") {
      setHostMessageForRoom(roomId, "This room is set to never host Codex turns.");
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (!canApproveCodexTurn(room, localUser, roomLocked)) {
      if (canDelegateApproveCodexTurn(room, localUser, roomLocked)) {
        if (!isDelegatedApprovalExecutionPolicy(room.approvalDelegationPolicy)) {
          setHostMessageForRoom(roomId, "This room is not configured for delegated Codex approvals.");
          return;
        }
        await publishCodexApproval({
          approvalId: crypto.randomUUID(),
          roomId,
          delegationPolicy: room.approvalDelegationPolicy,
          message: `${localUser.name} approved this Codex turn. The active host device will execute it.`
        }, room);
        setPendingCodexApprovalForRoom(roomId, null);
        setApprovalVisibleForRoom(roomId, false);
        setHostMessageForRoom(roomId, "Approval sent to the active host device.");
        return;
      }
      setHostMessageForRoom(roomId, roomHostGateMessage);
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    const turnMessages = approval?.messages ?? messagesByRoom[roomId] ?? [];
    const turnSummary = buildCodexTurnSummary(
      turnMessages,
      room,
      terminals.filter((terminal) => terminal.roomId === roomId),
      browserRequestsByRoom[roomId] ?? [],
      gitStatusByRoom[roomId] ?? null,
      { includeWorkspaceContext: roomCanReadLocalWorkspace }
    );
    const model = room.codexModel ?? defaultCodexModel;
    const reasoningEffort = room.codexReasoningEffort ?? defaultCodexReasoningEffort;
    const speed = room.codexSpeed ?? defaultCodexSpeed;
    const sandboxLevel = room.codexSandboxLevel ?? defaultCodexSandboxLevel;
    const projectPath = room.projectPath;
    setPendingCodexApprovalForRoom(roomId, null);
    setApprovalVisibleForRoom(roomId, false);
    setCodexRunningForRoom(roomId, true);
    appendTerminalLinesForRoom(roomId, [
      "$ codex app-server",
      `Starting approved Codex turn with ${formatCodexModel(model)} from encrypted room context...`
    ]);

    const turnId = crypto.randomUUID();
    const continuationHandoff = codexContinuationByRoom[roomId] ?? null;
    const input = buildCodexTurnInput(turnMessages, projectPath, model, turnSummary, {
      fullRoomContext: Boolean(continuationHandoff)
    });
    const previousThreadId = codexThreadIdsByRoom[roomId] ?? null;
    try {
      await publishCodexEvent({
        turnId,
        status: "started",
        message: previousThreadId
          ? `Resuming Codex thread ${previousThreadId} with ${formatCodexModel(model)}.`
          : `Started Codex turn with ${formatCodexModel(model)}.`,
        model
      }, room);
      const result = await runCodexTurn(roomId, projectPath, input, model, reasoningEffort, speed, sandboxLevel, previousThreadId);
      if (classifyCodexFailure([result.status, result.stderr, result.transcript, ...result.events]) === "usage_limit") {
        await handleCodexUsageLimit(room, turnId, model, turnMessages, result.events, result.stderr);
        return;
      }
      const threadId = normalizeCodexThreadId(result.threadId);
      if (threadId) {
        setCodexThreadIdForRoom(roomId, threadId);
      }
      for (const eventName of result.events.slice(-16)) {
        await publishCodexEvent({
          turnId,
          status: "event",
          message: eventName,
          eventName,
          model,
          ...(threadId ? { threadId } : {})
        }, room);
      }
      await publishCodexEvent({
        turnId,
        status: "completed",
        message: `Codex turn finished with status: ${result.status}.`,
        model,
        ...(threadId ? { threadId } : {})
      }, room);
      const body =
        result.transcript.trim() ||
        `Codex turn finished with status: ${result.status}. Events: ${result.events.slice(0, 8).join(", ")}`;
      await publishChatMessage({
        id: crypto.randomUUID(),
        author: `Codex via ${localUser.name}`,
        role: "codex",
        body,
        time: formatMessageTime(),
        createdAt: new Date().toISOString()
      }, room);
      appendTerminalLinesForRoom(roomId, [
        `Codex status: ${result.status}`,
        `Codex thread: ${result.threadId ?? "unknown"}`,
        ...result.events.slice(-8).map((event) => `event: ${event}`),
        ...(result.stderr ? [`stderr: ${result.stderr}`] : [])
      ]);
    } catch (error) {
      if (classifyCodexFailure([String(error)]) === "usage_limit") {
        await handleCodexUsageLimit(room, turnId, model, turnMessages, [String(error)], String(error));
        return;
      }
      await publishCodexEvent({
        turnId,
        status: "failed",
        message: String(error),
        model
      }, room);
      await publishChatMessage({
        id: crypto.randomUUID(),
        author: `Codex via ${localUser.name}`,
        role: "codex",
        body: `Codex could not start from this host: ${String(error)}`,
        time: formatMessageTime(),
        createdAt: new Date().toISOString()
      }, room);
      appendTerminalLinesForRoom(roomId, [`Codex error: ${String(error)}`]);
    } finally {
      if (continuationHandoff) {
        setCodexContinuationForRoom(roomId, null);
      }
      setCodexRunningForRoom(roomId, false);
    }
  }

  async function handleCodexUsageLimit(
    room: RoomRecord,
    turnId: string,
    model: string,
    turnMessages: ChatMessage[],
    events: string[],
    stderr: string
  ) {
    const roomId = room.id;
    await publishCodexEvent({
      turnId,
      status: "failed",
      message: codexUsageLimitMessage(room.host),
      model
    }, room);
    appendTerminalLinesForRoom(roomId, [
      codexUsageLimitMessage(room.host),
      ...events.slice(-4).map((event) => `event: ${event}`),
      ...(stderr ? [`stderr: ${stderr}`] : [])
    ]);
    await publishChatMessage({
      id: crypto.randomUUID(),
      author: "multAIplayer",
      role: "system",
      body: `${codexUsageLimitMessage(room.host)} Click Continue with another host in the room panel to keep going from this room context.`,
      time: formatMessageTime(),
      createdAt: new Date().toISOString()
    }, room);
    try {
      const handedOff = await updateRoomHost(roomId, room.host, room.hostUserId ?? localUser.id, "handoff");
      void shutdownCodexRoom(roomId);
      replaceRoom(handedOff);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setHostMessageForRoom(roomId, `Codex usage is unavailable, but host handoff could not update room host status: ${String(error)}`);
      }
    }
    await publishHostHandoff(room, "usage_limit", turnMessages);
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
      setHostMessageForRoom(roomId, codexUsageLimitMessage(room.host));
    }
  }

  return {
    approveCodexTurn
  };
}
