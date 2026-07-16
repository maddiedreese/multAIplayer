import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { isLocalUserActiveHostForRoom, type LocalHostUser } from "../access/roomHost";

export function canRequestBrowserAccess(room: ClientRoomRecord, locked = false): boolean {
  void room;
  return !locked;
}

export function canHostBrowserAction(room: ClientRoomRecord, user: LocalHostUser, locked = false): boolean {
  return canRequestBrowserAccess(room, locked) && isLocalUserActiveHostForRoom(room, user);
}

export interface BrowserRequestCandidate {
  id: string;
  status: "pending" | "approved" | "denied";
}

export function findRoomBrowserRequest<T extends BrowserRequestCandidate>(requests: T[], requestId: string): T | null {
  return requests.find((request) => request.id === requestId) ?? null;
}

export function canActOnRoomBrowserRequest<T extends BrowserRequestCandidate>(
  requests: T[],
  requestId: string,
  expectedStatus?: BrowserRequestCandidate["status"]
): boolean {
  const request = findRoomBrowserRequest(requests, requestId);
  if (!request) return false;
  return expectedStatus ? request.status === expectedStatus : true;
}

export function roomBrowserRequestMessage<T extends BrowserRequestCandidate>(
  requests: T[],
  requestId: string,
  expectedStatus?: BrowserRequestCandidate["status"]
): string {
  const request = findRoomBrowserRequest(requests, requestId);
  if (!request) return "Browser request is no longer available in this room.";
  if (expectedStatus && request.status !== expectedStatus) {
    return `Browser request is ${request.status}, not ${expectedStatus}.`;
  }
  return "Browser request is available.";
}

export function browserAccessGateMessage(room: ClientRoomRecord, locked = false): string {
  if (locked) return "Unlock this room before using browser access.";
  void room;
  return "Browser access is available for this room.";
}
