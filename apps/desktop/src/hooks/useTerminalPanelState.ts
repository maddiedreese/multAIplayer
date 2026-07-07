import { useLayoutEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";

export function useTerminalPanelState({
  initialTerminalLinesByRoom
}: {
  initialTerminalLinesByRoom: Record<string, string[]>;
}) {
  const terminalLinesByRoom = useAppStore((state) => state.terminalLinesByRoom);
  const initializeTerminalLinesByRoom = useAppStore((state) => state.initializeTerminalLinesByRoom);
  const terminalBusyByRoom = useAppStore((state) => state.terminalBusyByRoom);
  const terminals = useAppStore((state) => state.terminals);
  const clearTerminalSnapshots = useAppStore((state) => state.clearTerminalSnapshots);
  const replaceTerminalSnapshotsForRoom = useAppStore((state) => state.replaceTerminalSnapshotsForRoom);
  const upsertTerminalSnapshot = useAppStore((state) => state.upsertTerminalSnapshot);
  const terminalRequestsByRoom = useAppStore((state) => state.terminalRequestsByRoom);
  const selectedTerminalIdsByRoom = useAppStore((state) => state.selectedTerminalIdsByRoom);
  const terminalUiByRoom = useAppStore((state) => state.terminalUiByRoom);
  const terminalAutoOpenedRoomsRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    initializeTerminalLinesByRoom(initialTerminalLinesByRoom);
  }, [initialTerminalLinesByRoom, initializeTerminalLinesByRoom]);

  return {
    terminalLinesByRoom,
    terminalBusyByRoom,
    terminals,
    clearTerminalSnapshots,
    replaceTerminalSnapshotsForRoom,
    upsertTerminalSnapshot,
    terminalRequestsByRoom,
    selectedTerminalIdsByRoom,
    terminalUiByRoom,
    terminalAutoOpenedRoomsRef
  };
}
