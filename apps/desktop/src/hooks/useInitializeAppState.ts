import { useEffect, useLayoutEffect } from "react";
import { useAppStore } from "../store/appStore";
import { useInitializeWorkspaceUi, type WorkspaceUiSeed } from "./useInitializeWorkspaceUi";

/** Seeds external starter data without subscribing App to the resulting store state. */
export function useInitializeAppState({
  workspace,
  initialTerminalLinesByRoom
}: {
  workspace: WorkspaceUiSeed;
  initialTerminalLinesByRoom: Record<string, string[]>;
}): void {
  useInitializeWorkspaceUi(workspace);
  useLayoutEffect(() => {
    useAppStore.getState().seedInitialTerminalLines(initialTerminalLinesByRoom);
  }, [initialTerminalLinesByRoom]);
  useEffect(() => useAppStore.getState().loadTrustedDeviceKeysOnce(), []);
}
