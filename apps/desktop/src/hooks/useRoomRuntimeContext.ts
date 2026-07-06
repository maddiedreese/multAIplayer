import { useCodexRoomActions } from "./useCodexRoomActions";
import { useRoomBackgroundEffects } from "./useRoomBackgroundEffects";
import { useRoomToolActions } from "./useRoomToolActions";

type CodexRoomActionOptions = Parameters<typeof useCodexRoomActions>[0];
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
  codexActions: CodexRoomActionOptions;
  toolActions: RoomToolActionOptions;
  backgroundEffects: RuntimeBackgroundEffectOptions;
}) {
  const codex = useCodexRoomActions(codexActions);
  const tools = useRoomToolActions(toolActions);

  useRoomBackgroundEffects({
    ...backgroundEffects,
    terminalAutoOpen: {
      ...backgroundEffects.terminalAutoOpen,
      openInteractiveTerminal: tools.openInteractiveTerminal
    }
  });

  return {
    ...codex,
    ...tools
  };
}
