export interface TerminalApprovalRequest {
  id: string;
  requester: string;
  requesterUserId: string;
  command: string;
  cwd: string;
  requestedAt: string;
  status: "pending" | "approved" | "denied";
}

export function terminalRequestForApprovedRun<T extends TerminalApprovalRequest>(
  request: T,
  roomProjectPath: string
): T {
  const projectPath = roomProjectPath.trim();
  if (!projectPath) {
    throw new Error("Room project path is required before approving a terminal request.");
  }
  const command = request.command.trim();
  if (!command) {
    throw new Error("Terminal request command is required.");
  }
  return {
    ...request,
    command,
    cwd: projectPath
  };
}

export function findRoomTerminalRequest<T extends TerminalApprovalRequest>(
  requests: T[],
  requestId: string
): T | null {
  return requests.find((request) => request.id === requestId) ?? null;
}

export function canActOnRoomTerminalRequest<T extends TerminalApprovalRequest>(
  requests: T[],
  requestId: string,
  expectedStatus: TerminalApprovalRequest["status"] = "pending"
): boolean {
  const request = findRoomTerminalRequest(requests, requestId);
  return request?.status === expectedStatus;
}

export function roomTerminalRequestMessage<T extends TerminalApprovalRequest>(
  requests: T[],
  requestId: string,
  expectedStatus: TerminalApprovalRequest["status"] = "pending"
): string {
  const request = findRoomTerminalRequest(requests, requestId);
  if (!request) return "Terminal request is no longer available in this room.";
  if (request.status !== expectedStatus) {
    return `Terminal request is ${request.status}, not ${expectedStatus}.`;
  }
  return "Terminal request is available.";
}
