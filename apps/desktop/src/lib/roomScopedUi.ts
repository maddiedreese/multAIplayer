export function shouldApplyRoomScopedUiUpdate(activeRoomId: string, targetRoomId: string): boolean {
  return activeRoomId === targetRoomId;
}
