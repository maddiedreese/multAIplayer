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
