import type { MlsRelayMessage, ClientRoomRecord } from "@multaiplayer/protocol";

export interface LocalHostUser {
  id: string;
  name: string;
}

export function isLocalUserActiveHostForRoom(room: ClientRoomRecord, user: LocalHostUser): boolean {
  return room.hostStatus === "active" && (room.hostUserId ? room.hostUserId === user.id : room.host === user.name);
}

export function findEnvelopeRoom(rooms: ClientRoomRecord[], roomId: string): ClientRoomRecord | null {
  return rooms.find((room) => room.id === roomId) ?? null;
}

export function isEnvelopeFromActiveRoomHost(
  room: ClientRoomRecord | null,
  envelope: Pick<MlsRelayMessage, "senderUserId">
): boolean {
  return Boolean(room?.hostStatus === "active" && room.hostUserId && room.hostUserId === envelope.senderUserId);
}

/**
 * A handoff package can race with the relay's room-state update. The initiating
 * host remains bound in hostUserId while the room is in the handoff state.
 */
export function isEnvelopeFromHandoffInitiator(
  room: ClientRoomRecord | null,
  envelope: Pick<MlsRelayMessage, "senderUserId">
): boolean {
  return Boolean(
    room &&
    (room.hostStatus === "active" || room.hostStatus === "handoff") &&
    room.hostUserId &&
    room.hostUserId === envelope.senderUserId
  );
}

export function roomHostEnvelopeRejectionMessage(room: ClientRoomRecord | null, eventLabel: string): string {
  if (!room) return `Rejected ${eventLabel} because the room is not known locally.`;
  if (room.hostStatus !== "active") return `Rejected ${eventLabel} because ${room.name} has no active host.`;
  if (!room.hostUserId) return `Rejected ${eventLabel} because ${room.name} does not have a stable host identity.`;
  return `Rejected ${eventLabel} because it was not sent by ${room.host}.`;
}
