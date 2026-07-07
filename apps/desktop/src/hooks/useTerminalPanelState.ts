import { useLayoutEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";

export function useTerminalPanelState({
  initialTerminalLinesByRoom
}: {
  initialTerminalLinesByRoom: Record<string, string[]>;
}) {
  const terminalLinesByRoom = useAppStore((state) => state.terminalLinesByRoom);
  const setTerminalLinesByRoom = useAppStore((state) => state.setTerminalLinesByRoom);
  const terminalBusyByRoom = useAppStore((state) => state.terminalBusyByRoom);
  const setTerminalBusyByRoom = useAppStore((state) => state.setTerminalBusyByRoom);
  const terminals = useAppStore((state) => state.terminals);
  const setTerminals = useAppStore((state) => state.setTerminals);
  const terminalRequestsByRoom = useAppStore((state) => state.terminalRequestsByRoom);
  const setTerminalRequestsByRoom = useAppStore((state) => state.setTerminalRequestsByRoom);
  const selectedTerminalIdsByRoom = useAppStore((state) => state.selectedTerminalIdsByRoom);
  const setSelectedTerminalIdsByRoom = useAppStore((state) => state.setSelectedTerminalIdsByRoom);
  const terminalNamesByRoom = useAppStore((state) => state.terminalNamesByRoom);
  const setTerminalNamesByRoom = useAppStore((state) => state.setTerminalNamesByRoom);
  const terminalCommandsByRoom = useAppStore((state) => state.terminalCommandsByRoom);
  const setTerminalCommandsByRoom = useAppStore((state) => state.setTerminalCommandsByRoom);
  const terminalInputsByRoom = useAppStore((state) => state.terminalInputsByRoom);
  const setTerminalInputsByRoom = useAppStore((state) => state.setTerminalInputsByRoom);
  const terminalErrorsByRoom = useAppStore((state) => state.terminalErrorsByRoom);
  const setTerminalErrorsByRoom = useAppStore((state) => state.setTerminalErrorsByRoom);
  const terminalAutoOpenedRoomsRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    if (Object.keys(initialTerminalLinesByRoom).length === 0) {
      return;
    }
    setTerminalLinesByRoom((current) => (
      Object.keys(current).length === 0 ? initialTerminalLinesByRoom : current
    ));
  }, [initialTerminalLinesByRoom, setTerminalLinesByRoom]);

  return {
    terminalLinesByRoom,
    setTerminalLinesByRoom,
    terminalBusyByRoom,
    setTerminalBusyByRoom,
    terminals,
    setTerminals,
    terminalRequestsByRoom,
    setTerminalRequestsByRoom,
    selectedTerminalIdsByRoom,
    setSelectedTerminalIdsByRoom,
    terminalNamesByRoom,
    setTerminalNamesByRoom,
    terminalCommandsByRoom,
    setTerminalCommandsByRoom,
    terminalInputsByRoom,
    setTerminalInputsByRoom,
    terminalErrorsByRoom,
    setTerminalErrorsByRoom,
    terminalAutoOpenedRoomsRef
  };
}
