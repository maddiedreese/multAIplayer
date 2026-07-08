import { useLayoutEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";

export function useTerminalPanelState({
  initialTerminalLinesByRoom
}: {
  initialTerminalLinesByRoom: Record<string, string[]>;
}) {
  const terminalLinesByRoom = useAppStore((state) => state.terminalLinesByRoom);
  const seedInitialTerminalLines = useAppStore((state) => state.seedInitialTerminalLines);
  const terminalBusyByRoom = useAppStore((state) => state.terminalBusyByRoom);
  const terminals = useAppStore((state) => state.terminals);
  const clearTerminalSnapshots = useAppStore((state) => state.clearTerminalSnapshots);
  const clearTerminalSnapshotsForRoom = useAppStore((state) => state.clearTerminalSnapshotsForRoom);
  const syncTerminalSnapshotsForRoom = useAppStore((state) => state.syncTerminalSnapshotsForRoom);
  const upsertTerminalSnapshot = useAppStore((state) => state.upsertTerminalSnapshot);
  const terminalRequestsByRoom = useAppStore((state) => state.terminalRequestsByRoom);
  const selectedTerminalIdsByRoom = useAppStore((state) => state.selectedTerminalIdsByRoom);
  const terminalUiByRoom = useAppStore((state) => state.terminalUiByRoom);
  const terminalAutoOpenedRoomsRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    seedInitialTerminalLines(initialTerminalLinesByRoom);
  }, [initialTerminalLinesByRoom, seedInitialTerminalLines]);

  return {
    terminalLinesByRoom,
    terminalBusyByRoom,
    terminals,
    clearTerminalSnapshots,
    clearTerminalSnapshotsForRoom,
    syncTerminalSnapshotsForRoom,
    upsertTerminalSnapshot,
    terminalRequestsByRoom,
    selectedTerminalIdsByRoom,
    terminalUiByRoom,
    terminalAutoOpenedRoomsRef
  };
}
