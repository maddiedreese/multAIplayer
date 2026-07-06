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
  const { approveCodexTurn } = useCodexTurnActions(turn);
  const { handleCodexInvoke, sendMessage } = useCodexInvokeActions({
    ...invoke,
    approveCodexTurn
  });

  return {
    approveCodexTurn,
    handleCodexInvoke,
    sendMessage
  };
}
