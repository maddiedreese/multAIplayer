import { useAppStore } from "../store/appStore";

export function useCodexRoomState() {
  const codexEventsByRoom = useAppStore((state) => state.codexEventsByRoom);
  const setCodexEventsByRoom = useAppStore((state) => state.setCodexEventsByRoom);
  const approvalVisibleByRoom = useAppStore((state) => state.approvalVisibleByRoom);
  const setApprovalVisibleByRoom = useAppStore((state) => state.setApprovalVisibleByRoom);
  const pendingCodexApprovalsByRoom = useAppStore((state) => state.pendingCodexApprovalsByRoom);
  const setPendingCodexApprovalsByRoom = useAppStore((state) => state.setPendingCodexApprovalsByRoom);
  const codexRunningByRoom = useAppStore((state) => state.codexRunningByRoom);
  const setCodexRunningByRoom = useAppStore((state) => state.setCodexRunningByRoom);
  const roomGoalsByRoom = useAppStore((state) => state.roomGoalsByRoom);
  const setRoomGoalsByRoom = useAppStore((state) => state.setRoomGoalsByRoom);
  const secretWarningsVisibleByRoom = useAppStore((state) => state.secretWarningsVisibleByRoom);
  const setSecretWarningsVisibleByRoom = useAppStore((state) => state.setSecretWarningsVisibleByRoom);
  const codexThreadIdsByRoom = useAppStore((state) => state.codexThreadIdsByRoom);
  const setCodexThreadIdsByRoom = useAppStore((state) => state.setCodexThreadIdsByRoom);

  return {
    codexEventsByRoom,
    setCodexEventsByRoom,
    approvalVisibleByRoom,
    setApprovalVisibleByRoom,
    pendingCodexApprovalsByRoom,
    setPendingCodexApprovalsByRoom,
    codexRunningByRoom,
    setCodexRunningByRoom,
    roomGoalsByRoom,
    setRoomGoalsByRoom,
    secretWarningsVisibleByRoom,
    setSecretWarningsVisibleByRoom,
    codexThreadIdsByRoom,
    setCodexThreadIdsByRoom
  };
}
