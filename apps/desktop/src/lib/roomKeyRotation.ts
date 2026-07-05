export function isRoomKeyRotationInFlight(
  busyByRoom: Record<string, boolean>,
  roomId: string
): boolean {
  return busyByRoom[roomId] === true;
}

export function roomKeyRotationInFlightMessage(): string {
  return "Room key rotation is already in progress.";
}
