import { useAppStore } from "../store/appStore";

export function useCodexRoomState() {
  const codexEventsByRoom = useAppStore((state) => state.codexEventsByRoom);
  const approvalVisibleByRoom = useAppStore((state) => state.approvalVisibleByRoom);
  const pendingCodexApprovalsByRoom = useAppStore((state) => state.pendingCodexApprovalsByRoom);
  const codexRunningByRoom = useAppStore((state) => state.codexRunningByRoom);
  const roomGoalsByRoom = useAppStore((state) => state.roomGoalsByRoom);
  const secretWarningsVisibleByRoom = useAppStore((state) => state.secretWarningsVisibleByRoom);
  const codexThreadIdsByRoom = useAppStore((state) => state.codexThreadIdsByRoom);

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
