import type { RoomRecord } from "@multaiplayer/protocol";
import { isLocalUserActiveHostForRoom, type LocalHostUser } from "./roomHost";

export function canCreateRoomInvite(room: RoomRecord, user: LocalHostUser, locked = false): boolean {
  if (locked) return false;
  return isLocalUserActiveHostForRoom(room, user);
}
