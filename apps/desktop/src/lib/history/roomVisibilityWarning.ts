const roomVisibilityWarningPrefix = "multaiplayer:room-visibility-warning:";
const acknowledgedValue = "acknowledged";

export function roomVisibilityWarningKey(roomId: string): string {
  return `${roomVisibilityWarningPrefix}${roomId}`;
}

export function hasAcknowledgedRoomVisibilityWarning(roomId: string): boolean {
  if (!roomId) return true;
  return localStorage.getItem(roomVisibilityWarningKey(roomId)) === acknowledgedValue;
}

export function acknowledgeRoomVisibilityWarning(roomId: string): void {
  if (!roomId) return;
  localStorage.setItem(roomVisibilityWarningKey(roomId), acknowledgedValue);
}

export function clearRoomVisibilityWarningAcknowledgement(roomId: string): void {
  if (!roomId) return;
  localStorage.removeItem(roomVisibilityWarningKey(roomId));
}
