import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { TerminalSnapshot } from "../platform/localBackend";
import { isLocalUserActiveHostForRoom, type LocalHostUser } from "../access/roomHost";

export function canControlRoomTerminal(
  room: ClientRoomRecord,
  user: LocalHostUser,
  deviceId: string,
  terminal: Pick<TerminalSnapshot, "roomId"> | null | undefined,
  locked = false
): boolean {
  return !locked && isLocalUserActiveHostForRoom(room, user, deviceId) && terminal?.roomId === room.id;
}

export function roomTerminalControlMessage(
  room: ClientRoomRecord,
  terminal: Pick<TerminalSnapshot, "roomId"> | null | undefined,
  locked = false
): string {
  if (locked) return "Unlock this room before controlling terminals.";
  if (!terminal) return "Select a terminal in this room before controlling it.";
  if (terminal.roomId !== room.id) return "Selected terminal belongs to a different room.";
  return "Terminal control is available.";
}
