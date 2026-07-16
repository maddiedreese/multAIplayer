export function shouldApplyRoomScopedUiUpdate(activeRoomId: string | null, targetRoomId: string): boolean {
  return activeRoomId === targetRoomId;
}
