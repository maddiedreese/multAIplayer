import { useMemo } from "react";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { TerminalSnapshot } from "../lib/platform/localBackend";
import type { InspectorTab } from "../lib/core/uiTypes";
import { hasAcknowledgedRoomVisibilityWarning } from "../lib/history/roomVisibilityWarning";

interface UseSelectedRoomContextOptions {
  rooms: ClientRoomRecord[];
  selectedRoomId: string | null;
  inspectorTab: InspectorTab | undefined;
  secretWarningVisible: boolean | undefined;
  terminals: TerminalSnapshot[];
}

export function useSelectedRoomContext({
  rooms,
  selectedRoomId,
  inspectorTab: selectedInspectorTab,
  secretWarningVisible: selectedSecretWarningVisible,
  terminals
}: UseSelectedRoomContextOptions) {
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? null;
  const hasSelectedRoom = selectedRoom != null;
  const inspectorTab = selectedRoom ? (selectedInspectorTab ?? "files") : "files";
  const secretWarningVisible =
    selectedRoom != null && (selectedSecretWarningVisible ?? !hasAcknowledgedRoomVisibilityWarning(selectedRoom.id));
  const roomTerminals = useMemo(
    () => (selectedRoom ? terminals.filter((terminal) => terminal.roomId === selectedRoom.id) : []),
    [terminals, selectedRoom]
  );

  return {
    hasSelectedRoom,
    selectedRoom,
    inspectorTab,
    secretWarningVisible,
    roomTerminals
  };
}
