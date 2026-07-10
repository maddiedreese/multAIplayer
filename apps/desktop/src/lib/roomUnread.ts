import type { RoomRecord } from "@multaiplayer/protocol";
import type { ChatMessage, LocalRoomReadState } from "../types";

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

export function replaceRoomPreservingUnread(rooms: RoomRecord[], room: RoomRecord): RoomRecord[] {
  const existing = rooms.find((item) => item.id === room.id);
  if (!existing) return rooms;
  return rooms.map((item) => (item.id === room.id ? { ...room, unread: existing.unread } : item));
}

export function applyLocalRoomReadState(
  rooms: RoomRecord[],
  roomId: string,
  readState?: LocalRoomReadState
): RoomRecord[] {
  if (!readState) return rooms;
  const unread = sanitizeUnread(readState.unread);
  return rooms.map((room) => (room.id === roomId && room.unread !== unread ? { ...room, unread } : room));
}

export function hideUnreadForLockedRooms(
  rooms: RoomRecord[],
  forgottenRoomIds: ReadonlySet<string>,
  revokedRoomIds: ReadonlySet<string>,
  revokedTeamIds: ReadonlySet<string>
): RoomRecord[] {
  return rooms.map((room) =>
    (forgottenRoomIds.has(room.id) || revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId)) &&
    room.unread !== 0
      ? { ...room, unread: 0 }
      : room
  );
}

export function localRoomReadStateForHistory(room: RoomRecord, messages: readonly ChatMessage[]): LocalRoomReadState {
  const lastReadMessageId = room.unread === 0 ? messages.at(-1)?.id : undefined;
  return {
    unread: sanitizeUnread(room.unread),
    ...(lastReadMessageId ? { lastReadMessageId } : {})
  };
}

export function sanitizeLocalRoomReadState(value: unknown): LocalRoomReadState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<LocalRoomReadState>;
  return {
    unread: sanitizeUnread(record.unread),
    ...(typeof record.lastReadMessageId === "string" && record.lastReadMessageId.trim()
      ? { lastReadMessageId: record.lastReadMessageId.trim() }
      : {})
  };
}

function sanitizeUnread(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(999, Math.round(Number(value)))) : 0;
}
