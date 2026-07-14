const safeCodexStatuses = new Set([
  "completed",
  "interrupted",
  "failed",
  "inProgress",
  "error",
  "timeout",
  "disconnected"
]);

const safeStandaloneEvents = new Set([
  "turn/start acknowledged",
  "turn/steer acknowledged",
  "applyPatchApproval",
  "execCommandApproval"
]);

const appServerMethodPattern = /^[a-z][A-Za-z0-9]*(?:\/[A-Za-z][A-Za-z0-9]*)+$/;

/**
 * Project native app-server diagnostics onto the small vocabulary that is safe
 * to share with room peers. Raw JSON-RPC errors remain host-local.
 */
export function projectCodexRoomEvent(event: string): string | null {
  const value = event.trim();
  if (!value || value.length > 160) return null;
  if (safeStandaloneEvents.has(value) || appServerMethodPattern.test(value)) return value;
  if (value.startsWith("thread/start:")) return "thread/start";
  if (value.startsWith("thread/resume:")) return "thread/resume";
  return null;
}

export function projectCodexRoomStatus(status: string): string {
  const value = status.trim();
  return safeCodexStatuses.has(value) ? value : "failed";
}

export const codexHostFailureRoomMessage =
  "Codex failed on the active host. The host can review local diagnostics and retry.";
