import type { RoomRecord } from "@multaiplayer/protocol";

export function canUseRoomChat(room: RoomRecord, locked = false): boolean {
  void room;
  return !locked;
}

export function canStageRoomChatAttachment(room: RoomRecord, locked = false): boolean {
  return canUseRoomChat(room, locked);
}

export function roomChatGateMessage(room: RoomRecord, locked = false): string {
  if (locked) return "Unlock this room before using chat.";
  void room;
  return "Chat is available.";
}
