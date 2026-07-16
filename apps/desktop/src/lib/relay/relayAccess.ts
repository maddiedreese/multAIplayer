export function isMembershipRemovedRelayError(error: string | { code?: string | undefined; message: string }): boolean {
  const code = typeof error === "string" ? undefined : error.code;
  const message = typeof error === "string" ? error : error.message;
  return code === "membership_removed" || /\bteam membership was removed\b/i.test(message);
}

export function membershipRemovedRoomMessage(roomName: string): string {
  return `Access to ${roomName} was removed on the relay. Rejoin with a fresh invite before continuing.`;
}
