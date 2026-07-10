import { createCodexInvokeActions } from "../lib/codexInvokeActions";
import { useCodexTurnActions } from "./useCodexTurnActions";

type CodexTurnActionsOptions = Parameters<typeof useCodexTurnActions>[0];
type CodexInvokeActionsOptions = Parameters<typeof createCodexInvokeActions>[0];

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
  } = createCodexInvokeActions({
    ...invoke
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
