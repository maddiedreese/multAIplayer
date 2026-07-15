import type { ClientRoomRecord } from "@multaiplayer/protocol";

export function canUseRoomChat(room: ClientRoomRecord, locked = false): boolean {
  void room;
  return !locked;
}

export function canStageRoomChatAttachment(room: ClientRoomRecord, locked = false): boolean {
  return canUseRoomChat(room, locked);
}

export function roomChatGateMessage(room: ClientRoomRecord, locked = false): string {
  if (locked) return "Unlock this room before using chat.";
  void room;
  return "Chat is available.";
}
