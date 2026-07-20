import type { MlsRelayMessage, ClientRoomRecord } from "@multaiplayer/protocol";

export interface LocalHostUser {
  id: string;
  name: string;
}

export function isLocalUserActiveHostForRoom(room: ClientRoomRecord, user: LocalHostUser, deviceId: string): boolean {
  return (
    room.hostStatus === "active" &&
    Boolean(room.hostUserId) &&
    Boolean(room.activeHostDeviceId) &&
    room.hostUserId === user.id &&
    room.activeHostDeviceId === deviceId
  );
}

export function findEnvelopeRoom(rooms: ClientRoomRecord[], roomId: string): ClientRoomRecord | null {
  return rooms.find((room) => room.id === roomId) ?? null;
}

export function isEnvelopeFromActiveRoomHost(
  room: ClientRoomRecord | null,
  envelope: Pick<MlsRelayMessage, "senderUserId" | "senderDeviceId">
): boolean {
  return Boolean(
    room?.hostStatus === "active" &&
    room.hostUserId &&
    room.activeHostDeviceId &&
    room.hostUserId === envelope.senderUserId &&
    room.activeHostDeviceId === envelope.senderDeviceId
  );
}

export function roomHostEnvelopeRejectionMessage(room: ClientRoomRecord | null, eventLabel: string): string {
  if (!room) return `Rejected ${eventLabel} because the room is not known locally.`;
  if (room.hostStatus !== "active") return `Rejected ${eventLabel} because ${room.name} has no active host.`;
  if (!room.hostUserId) return `Rejected ${eventLabel} because ${room.name} does not have a stable host identity.`;
  return `Rejected ${eventLabel} because it was not sent by ${room.host}.`;
}
