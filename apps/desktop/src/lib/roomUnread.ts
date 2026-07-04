import type { RoomRecord } from "@multaiplayer/protocol";

export function markRoomRead(rooms: RoomRecord[], roomId: string): RoomRecord[] {
  return rooms.map((room) => (room.id === roomId && room.unread !== 0 ? { ...room, unread: 0 } : room));
}

export function markRoomUnreadForIncomingChat(
  rooms: RoomRecord[],
  roomId: string,
  activeRoomId: string,
  senderDeviceId: string,
  localDeviceId: string
): RoomRecord[] {
  if (roomId === activeRoomId || senderDeviceId === localDeviceId) return rooms;
  return rooms.map((room) => (room.id === roomId ? { ...room, unread: room.unread + 1 } : room));
}

export function upsertRoomPreservingUnread(rooms: RoomRecord[], room: RoomRecord): RoomRecord[] {
  const existing = rooms.find((item) => item.id === room.id);
  if (existing) {
    return rooms.map((item) => (item.id === room.id ? { ...room, unread: existing.unread } : item));
  }
  return [...rooms, room];
}
