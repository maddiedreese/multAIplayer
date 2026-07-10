import type { RelayEnvelope, RoomRecord } from "@multaiplayer/protocol";

export interface LocalHostUser {
  id: string;
  name: string;
}

export function isLocalUserActiveHostForRoom(room: RoomRecord, user: LocalHostUser): boolean {
  return room.hostStatus === "active" && (room.hostUserId ? room.hostUserId === user.id : room.host === user.name);
}

export function findEnvelopeRoom(rooms: RoomRecord[], roomId: string): RoomRecord | null {
  return rooms.find((room) => room.id === roomId) ?? null;
}

export function isEnvelopeFromActiveRoomHost(
  room: RoomRecord | null,
  envelope: Pick<RelayEnvelope, "senderUserId">
): boolean {
  return Boolean(room?.hostStatus === "active" && room.hostUserId && room.hostUserId === envelope.senderUserId);
}

export function roomHostEnvelopeRejectionMessage(room: RoomRecord | null, eventLabel: string): string {
  if (!room) return `Rejected ${eventLabel} because the room is not known locally.`;
  if (room.hostStatus !== "active") return `Rejected ${eventLabel} because ${room.name} has no active host.`;
  if (!room.hostUserId) return `Rejected ${eventLabel} because ${room.name} does not have a stable host identity.`;
  return `Rejected ${eventLabel} because it was not sent by ${room.host}.`;
}
