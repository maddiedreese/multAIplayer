import type { RoomRecord } from "@multaiplayer/protocol";
import type { TerminalSnapshot } from "./localBackend";
import { isLocalUserActiveHostForRoom, type LocalHostUser } from "./roomHost";

export function canControlRoomTerminal(
  room: RoomRecord,
  user: LocalHostUser,
  terminal: Pick<TerminalSnapshot, "roomId"> | null | undefined,
  locked = false
): boolean {
  return (
    !locked &&
    room.mode.workspace &&
    isLocalUserActiveHostForRoom(room, user) &&
    terminal?.roomId === room.id
  );
}

export function roomTerminalControlMessage(
  room: RoomRecord,
  terminal: Pick<TerminalSnapshot, "roomId"> | null | undefined,
  locked = false
): string {
  if (locked) return "Unlock this room before controlling terminals.";
  if (!room.mode.workspace) return "Workspace mode is disabled for this room.";
  if (!terminal) return "Select a terminal in this room before controlling it.";
  if (terminal.roomId !== room.id) return "Selected terminal belongs to a different room.";
  return "Terminal control is available.";
}
