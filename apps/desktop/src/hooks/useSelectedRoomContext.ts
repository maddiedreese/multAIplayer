import { useMemo } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import type { TerminalSnapshot } from "../lib/localBackend";
import type { InspectorTab } from "../components/RoomInspectorPanel";
import { hasAcknowledgedRoomVisibilityWarning } from "../lib/roomVisibilityWarning";

interface UseSelectedRoomContextOptions {
  rooms: RoomRecord[];
  selectedRoomId: string;
  fallbackRoom: RoomRecord;
  inspectorTabsByRoom: Record<string, InspectorTab | "diff">;
  secretWarningsVisibleByRoom: Record<string, boolean>;
  terminals: TerminalSnapshot[];
}

export function useSelectedRoomContext({
  rooms,
  selectedRoomId,
  fallbackRoom,
  inspectorTabsByRoom,
  secretWarningsVisibleByRoom,
  terminals
}: UseSelectedRoomContextOptions) {
  const hasSelectedRoom = rooms.some((room) => room.id === selectedRoomId);
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? fallbackRoom;
  const inspectorTab = inspectorTabsByRoom[selectedRoom.id] === "diff"
    ? "files"
    : inspectorTabsByRoom[selectedRoom.id] ?? "files";
  const secretWarningVisible = hasSelectedRoom && (
    secretWarningsVisibleByRoom[selectedRoom.id ?? selectedRoomId] ??
    !hasAcknowledgedRoomVisibilityWarning(selectedRoom.id ?? selectedRoomId)
  );
  const roomTerminals = useMemo(
    () => terminals.filter((terminal) => terminal.roomId === selectedRoom.id),
    [terminals, selectedRoom.id]
  );

  return {
    hasSelectedRoom,
    selectedRoom,
    inspectorTab,
    secretWarningVisible,
    roomTerminals
  };
}
