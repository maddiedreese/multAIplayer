import type { RelayEnvelope, RoomKeyRotationPlaintextPayload, RoomRecord } from "@multaiplayer/protocol";
import { isEnvelopeFromActiveRoomHost } from "./roomHost";

export function isRoomKeyRotationInFlight(
  busyByRoom: Record<string, boolean>,
  roomId: string
): boolean {
  return busyByRoom[roomId] === true;
}

export function roomKeyRotationInFlightMessage(): string {
  return "Room key rotation is already in progress.";
}

export function isRoomKeyRotationEnvelopeAuthorized(
  room: RoomRecord | null,
  envelope: Pick<RelayEnvelope, "senderUserId">,
  payload: Pick<RoomKeyRotationPlaintextPayload, "rotatedByUserId">
): boolean {
  return isEnvelopeFromActiveRoomHost(room, envelope) && payload.rotatedByUserId === envelope.senderUserId;
}
