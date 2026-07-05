import type { RoomRecord } from "@multaiplayer/protocol";

export function canUseRoomChat(room: RoomRecord, locked = false): boolean {
  return !locked && room.mode.chat;
}

export function canStageRoomChatAttachment(room: RoomRecord, locked = false): boolean {
  return canUseRoomChat(room, locked);
}

export function roomChatGateMessage(room: RoomRecord, locked = false): string {
  if (locked) return "Unlock this room before using chat.";
  if (!room.mode.chat) return "Chat mode is disabled for this room.";
  return "Chat is available.";
}
