import type { RoomRecord } from "@multaiplayer/protocol";

export interface LocalHostUser {
  id: string;
  name: string;
}

export function isLocalUserActiveHostForRoom(room: RoomRecord, user: LocalHostUser): boolean {
  return room.hostStatus === "active" &&
    (room.hostUserId ? room.hostUserId === user.id : room.host === user.name);
}
