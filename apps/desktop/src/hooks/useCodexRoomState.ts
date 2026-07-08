import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import type { CodexRoomEvent, PendingCodexApproval, RoomGoal } from "../types";

function projectCodexRuntimeMaps(codexRuntimeByRoom: ReturnType<typeof useAppStore.getState>["codexRuntimeByRoom"]) {
  const codexEventsByRoom: Record<string, CodexRoomEvent[]> = {};
  const approvalVisibleByRoom: Record<string, boolean> = {};
  const pendingCodexApprovalsByRoom: Record<string, PendingCodexApproval> = {};
  const codexRunningByRoom: Record<string, boolean> = {};
  const roomGoalsByRoom: Record<string, RoomGoal> = {};
  const secretWarningsVisibleByRoom: Record<string, boolean> = {};
  const codexThreadIdsByRoom: Record<string, string> = {};

  Object.entries(codexRuntimeByRoom).forEach(([roomId, runtime]) => {
    if (runtime.events) codexEventsByRoom[roomId] = runtime.events;
    if (runtime.approvalVisible) approvalVisibleByRoom[roomId] = true;
    if (runtime.pendingApproval) pendingCodexApprovalsByRoom[roomId] = runtime.pendingApproval;
    if (runtime.running) codexRunningByRoom[roomId] = true;
    if (runtime.goal) roomGoalsByRoom[roomId] = runtime.goal;
    if (runtime.secretWarningVisible) secretWarningsVisibleByRoom[roomId] = true;
    if (runtime.threadId) codexThreadIdsByRoom[roomId] = runtime.threadId;
  });

  return {
    codexEventsByRoom,
    approvalVisibleByRoom,
    pendingCodexApprovalsByRoom,
    codexRunningByRoom,
    roomGoalsByRoom,
    secretWarningsVisibleByRoom,
    codexThreadIdsByRoom
  };
}

export function useCodexRoomState() {
  const codexRuntimeByRoom = useAppStore((state) => state.codexRuntimeByRoom);

  const roomState = useMemo(() => projectCodexRuntimeMaps(codexRuntimeByRoom), [codexRuntimeByRoom]);

  return {
    ...roomState
  };
}
