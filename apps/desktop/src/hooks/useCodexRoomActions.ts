import { useCodexInvokeActions } from "./useCodexInvokeActions";
import { useCodexTurnActions } from "./useCodexTurnActions";

type CodexTurnActionsOptions = Parameters<typeof useCodexTurnActions>[0];
type CodexInvokeActionsOptions = Omit<Parameters<typeof useCodexInvokeActions>[0], "approveCodexTurn">;

export function useCodexRoomActions({
  turn,
  invoke
}: {
  turn: CodexTurnActionsOptions;
  invoke: CodexInvokeActionsOptions;
}) {
  const { approveCodexTurn, promoteNextCodexApprovalForRoom } = useCodexTurnActions(turn);
  const {
    handleCodexInvoke,
    sendMessage,
    pauseGoal,
    resumeGoal,
    editGoal,
    deleteGoal,
    tickGoalElapsed
  } = useCodexInvokeActions({
    ...invoke,
    approveCodexTurn
  });

  return {
    approveCodexTurn,
    promoteNextCodexApprovalForRoom,
    handleCodexInvoke,
    sendMessage,
    pauseGoal,
    resumeGoal,
    editGoal,
    deleteGoal,
    tickGoalElapsed
  };
}
