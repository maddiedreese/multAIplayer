import { useRef, useState } from "react";
import type { TerminalSnapshot } from "../lib/localBackend";
import type { TerminalCommandRequest } from "../types";

export function useTerminalPanelState({
  initialTerminalLinesByRoom
}: {
  initialTerminalLinesByRoom: Record<string, string[]>;
}) {
  const [terminalLinesByRoom, setTerminalLinesByRoom] = useState<Record<string, string[]>>(initialTerminalLinesByRoom);
  const [terminalBusyByRoom, setTerminalBusyByRoom] = useState<Record<string, boolean>>({});
  const [terminals, setTerminals] = useState<TerminalSnapshot[]>([]);
  const [terminalRequestsByRoom, setTerminalRequestsByRoom] = useState<Record<string, TerminalCommandRequest[]>>({});
  const [selectedTerminalIdsByRoom, setSelectedTerminalIdsByRoom] = useState<Record<string, string | null>>({});
  const [terminalNamesByRoom, setTerminalNamesByRoom] = useState<Record<string, string>>({});
  const [terminalCommandsByRoom, setTerminalCommandsByRoom] = useState<Record<string, string>>({});
  const [terminalInputsByRoom, setTerminalInputsByRoom] = useState<Record<string, string>>({});
  const [terminalErrorsByRoom, setTerminalErrorsByRoom] = useState<Record<string, string | null>>({});
  const terminalAutoOpenedRoomsRef = useRef<Set<string>>(new Set());

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
