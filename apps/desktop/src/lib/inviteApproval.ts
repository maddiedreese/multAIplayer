export interface InviteApprovalRequest {
  id: string;
  requester: string;
  requesterUserId: string;
  requesterDeviceId: string;
  requestedAt: string;
  status: "pending" | "approved" | "denied";
}

export function findRoomInviteRequest<T extends InviteApprovalRequest>(requests: T[], requestId: string): T | null {
  return requests.find((request) => request.id === requestId) ?? null;
}

export function canActOnRoomInviteRequest<T extends InviteApprovalRequest>(
  requests: T[],
  requestId: string,
  expectedStatus: InviteApprovalRequest["status"] = "pending"
): boolean {
  const request = findRoomInviteRequest(requests, requestId);
  return request?.status === expectedStatus;
}

export function roomInviteRequestMessage<T extends InviteApprovalRequest>(
  requests: T[],
  requestId: string,
  expectedStatus: InviteApprovalRequest["status"] = "pending"
): string {
  const request = findRoomInviteRequest(requests, requestId);
  if (!request) return "Invite request is no longer available in this room.";
  if (request.status !== expectedStatus) {
    return `Invite request is ${request.status}, not ${expectedStatus}.`;
  }
  return "Invite request is available.";
}
