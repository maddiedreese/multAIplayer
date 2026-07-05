import type { RoomRecord } from "@multaiplayer/protocol";
import { isLocalUserActiveHostForRoom, type LocalHostUser } from "./roomHost";

export function canCreateRoomInvite(
  room: RoomRecord,
  user: LocalHostUser,
  locked = false,
  approvalGate = false
): boolean {
  if (locked) return false;
  if (!approvalGate) return true;
  return isLocalUserActiveHostForRoom(room, user);
}
