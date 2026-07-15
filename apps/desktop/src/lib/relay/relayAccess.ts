export function isMembershipRemovedRelayError(message: string): boolean {
  return /\bteam membership was removed\b/i.test(message);
}

export function membershipRemovedRoomMessage(roomName: string): string {
  return `Access to ${roomName} was removed on the relay. Rejoin with a fresh invite before continuing.`;
}
