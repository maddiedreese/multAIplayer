import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { ChatMessage, LocalRoomReadState } from "../../types";

export function markRoomRead(rooms: ClientRoomRecord[], roomId: string): ClientRoomRecord[] {
  return rooms.map((room) => (room.id === roomId && room.unread !== 0 ? { ...room, unread: 0 } : room));
}

export function markRoomUnreadForIncomingChat(
  rooms: ClientRoomRecord[],
  roomId: string,
  activeRoomId: string | null,
  senderDeviceId: string,
  localDeviceId: string
): ClientRoomRecord[] {
  if (roomId === activeRoomId || senderDeviceId === localDeviceId) return rooms;
  return rooms.map((room) => (room.id === roomId ? { ...room, unread: room.unread + 1 } : room));
}

export function applyLocalRoomReadState(
  rooms: ClientRoomRecord[],
  roomId: string,
  readState?: LocalRoomReadState
): ClientRoomRecord[] {
  if (!readState) return rooms;
  const unread = sanitizeUnread(readState.unread);
  return rooms.map((room) => (room.id === roomId && room.unread !== unread ? { ...room, unread } : room));
}

export function hideUnreadForLockedRooms(
  rooms: ClientRoomRecord[],
  forgottenRoomIds: ReadonlySet<string>,
  revokedRoomIds: ReadonlySet<string>,
  revokedTeamIds: ReadonlySet<string>
): ClientRoomRecord[] {
  return rooms.map((room) =>
    (forgottenRoomIds.has(room.id) || revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId)) &&
    room.unread !== 0
      ? { ...room, unread: 0 }
      : room
  );
}

export function localRoomReadStateForHistory(
  room: ClientRoomRecord,
  messages: readonly ChatMessage[]
): LocalRoomReadState {
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

export function isCurrentLocalRoomReadState(value: unknown): value is LocalRoomReadState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LocalRoomReadState>;
  return (
    Number.isInteger(record.unread) &&
    Number(record.unread) >= 0 &&
    (record.lastReadMessageId === undefined || typeof record.lastReadMessageId === "string")
  );
}

function sanitizeUnread(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(999, Math.round(Number(value)))) : 0;
}
