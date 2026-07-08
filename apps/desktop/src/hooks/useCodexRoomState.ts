import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { projectCodexRuntimeMaps } from "../store/slices/codexHostHandoffSlice";

export function useCodexRoomState() {
  const codexRuntimeByRoom = useAppStore((state) => state.codexRuntimeByRoom);

  const roomState = useMemo(() => projectCodexRuntimeMaps(codexRuntimeByRoom), [codexRuntimeByRoom]);

  return {
    codexRuntimeByRoom,
    ...roomState
  };
}
