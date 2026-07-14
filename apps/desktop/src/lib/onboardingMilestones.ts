import type { CodexRoomEvent, InviteJoinRequest } from "../types";

export function newestInviteRequestForDevice(
  requests: readonly InviteJoinRequest[],
  userId: string | undefined,
  deviceId: string
): InviteJoinRequest | null {
  if (!userId) return null;
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const request = requests[index];
    if (request?.requesterUserId === userId && request.requesterDeviceId === deviceId) return request;
  }
  return null;
}

export function completedTurnIds(events: readonly CodexRoomEvent[]): Set<string> {
  return new Set(events.filter((event) => event.status === "completed").map((event) => event.turnId));
}

export function hasNewCompletedTurn(events: readonly CodexRoomEvent[], baseline: ReadonlySet<string>): boolean {
  return events.some((event) => event.status === "completed" && !baseline.has(event.turnId));
}
