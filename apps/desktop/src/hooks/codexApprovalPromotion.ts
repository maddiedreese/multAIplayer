import { buildCodexApprovalSnapshot, hasActionableCodexTurnContext } from "../lib/codexTurn";
import { formatMessageTime } from "../lib/appFormatters";
import { roomLockMessage } from "../lib/appRuntime";
import { canUseLocalWorkspace } from "../lib/workspaceAccess";
import { useAppStore } from "../store/appStore";
import type { UseCodexTurnActionsOptions } from "./codexTurnActionTypes";
import { isExpiredCodexInvocation } from "./codexTurnQueue";

export function promoteNextCodexApproval({
  roomId,
  localUser,
  publishChatMessage,
  promoteNext
}: {
  roomId: string;
  localUser: UseCodexTurnActionsOptions["localUser"];
  publishChatMessage: UseCodexTurnActionsOptions["publishChatMessage"];
  promoteNext: (roomId: string) => void;
}) {
  const state = useAppStore.getState();
  const { forgottenRoomIds, revokedRoomIds, revokedTeamIds, messagesByRoom, terminals } = state;
  const {
    removeQueuedCodexApprovalForRoom,
    setHostMessageForRoom,
    setPendingCodexApprovalForRoom,
    setApprovalVisibleForRoom
  } = state;
  const nextTurn = state.codexRuntimeByRoom[roomId]?.queuedApprovals?.[0];
  if (!nextTurn) return;
  if (isExpiredCodexInvocation(nextTurn.queuedAt)) {
    removeQueuedCodexApprovalForRoom(roomId, nextTurn.turnId);
    setHostMessageForRoom(roomId, `Dropped ${nextTurn.requestedBy}'s Codex proposal because host approval timed out.`);
    promoteNext(roomId);
    return;
  }
  const room = state.rooms.find((item) => item.id === roomId);
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
    state.browserByRoom[roomId]?.requests ?? [],
    state.gitWorkflowRuntimeByRoom[roomId]?.workflow?.status ?? null,
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
    promoteNext(roomId);
    return;
  }
  removeQueuedCodexApprovalForRoom(roomId, nextTurn.turnId);
  setPendingCodexApprovalForRoom(roomId, {
    ...approvalSnapshot,
    turnId: nextTurn.turnId,
    requestedBy: nextTurn.requestedBy,
    requestedByUserId: nextTurn.requestedByUserId,
    queuedAt: nextTurn.queuedAt
  });
  setApprovalVisibleForRoom(roomId, true);
  setHostMessageForRoom(roomId, "Queued Codex turn is ready for host approval with current room context.");
}
