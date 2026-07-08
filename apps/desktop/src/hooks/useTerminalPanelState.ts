import { useLayoutEffect, useMemo, useRef } from "react";
import { useAppStore } from "../store/appStore";
import {
  projectSelectedTerminalRuntimeIdsByRoom,
  projectTerminalRuntimeBusyByRoom,
  projectTerminalRuntimeLinesByRoom,
  projectTerminalRuntimeRequestsByRoom,
  projectTerminalRuntimeUiByRoom
} from "../store/slices/terminalSlice";

export function useTerminalPanelState({
  initialTerminalLinesByRoom
}: {
  initialTerminalLinesByRoom: Record<string, string[]>;
}) {
  const terminalRuntimeByRoom = useAppStore((state) => state.terminalRuntimeByRoom);
  const seedInitialTerminalLines = useAppStore((state) => state.seedInitialTerminalLines);
  const terminals = useAppStore((state) => state.terminals);
  const clearTerminalSnapshots = useAppStore((state) => state.clearTerminalSnapshots);
  const clearTerminalSnapshotsForRoom = useAppStore((state) => state.clearTerminalSnapshotsForRoom);
  const syncTerminalSnapshotsForRoom = useAppStore((state) => state.syncTerminalSnapshotsForRoom);
  const upsertTerminalSnapshot = useAppStore((state) => state.upsertTerminalSnapshot);
  const {
    terminalLinesByRoom,
    terminalBusyByRoom,
    terminalRequestsByRoom,
    selectedTerminalIdsByRoom,
    terminalUiByRoom
  } = useMemo(() => ({
    terminalLinesByRoom: projectTerminalRuntimeLinesByRoom(terminalRuntimeByRoom),
    terminalBusyByRoom: projectTerminalRuntimeBusyByRoom(terminalRuntimeByRoom),
    terminalRequestsByRoom: projectTerminalRuntimeRequestsByRoom(terminalRuntimeByRoom),
    selectedTerminalIdsByRoom: projectSelectedTerminalRuntimeIdsByRoom(terminalRuntimeByRoom),
    terminalUiByRoom: projectTerminalRuntimeUiByRoom(terminalRuntimeByRoom)
  }), [terminalRuntimeByRoom]);
  const terminalAutoOpenedRoomsRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    seedInitialTerminalLines(initialTerminalLinesByRoom);
  }, [initialTerminalLinesByRoom, seedInitialTerminalLines]);

  return {
    terminalRuntimeByRoom,
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
