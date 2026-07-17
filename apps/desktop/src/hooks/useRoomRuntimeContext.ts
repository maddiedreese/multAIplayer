import { createCodexInvokeActions } from "../application/codex/codexInvokeActions";
import { useRoomBackgroundEffects } from "./useRoomBackgroundEffects";
import { useRoomToolActions } from "./useRoomToolActions";
import { useCodexTurnActions } from "./useCodexTurnActions";

type CodexTurnActionsOptions = Parameters<typeof useCodexTurnActions>[0];
type CodexInvokeActionsOptions = Parameters<typeof createCodexInvokeActions>[0];
type RoomToolActionOptions = Parameters<typeof useRoomToolActions>[0];
type RoomBackgroundEffectOptions = Parameters<typeof useRoomBackgroundEffects>[0];
type RuntimeBackgroundEffectOptions = Omit<RoomBackgroundEffectOptions, "terminalAutoOpen"> & {
  terminalAutoOpen: Omit<RoomBackgroundEffectOptions["terminalAutoOpen"], "openInteractiveTerminal">;
};

export function useRoomRuntimeContext({
  codexActions,
  toolActions,
  backgroundEffects
}: {
  codexActions: {
    turn: CodexTurnActionsOptions;
    invoke: CodexInvokeActionsOptions;
  };
  toolActions: RoomToolActionOptions;
  backgroundEffects: RuntimeBackgroundEffectOptions;
}) {
  const { approveCodexTurn, promoteNextCodexApprovalForRoom } = useCodexTurnActions(codexActions.turn);
  const codexInvokeActions = createCodexInvokeActions(codexActions.invoke);
  const tools = useRoomToolActions(toolActions);

  useRoomBackgroundEffects({
    ...backgroundEffects,
    terminalAutoOpen: {
      ...backgroundEffects.terminalAutoOpen,
      openInteractiveTerminal: tools.openInteractiveTerminal
    }
  });

  return {
    approveCodexTurn,
    promoteNextCodexApprovalForRoom,
    ...codexInvokeActions,
    ...tools
  };
}
