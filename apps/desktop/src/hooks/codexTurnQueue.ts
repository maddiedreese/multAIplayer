import type { ChatMessage } from "../types";

const codexInvocationTimeoutMs = 15 * 60 * 1000;

export function isExpiredCodexInvocation(queuedAt: string, now = Date.now()): boolean {
  const queuedAtMs = Date.parse(queuedAt);
  return !Number.isFinite(queuedAtMs) || now - queuedAtMs > codexInvocationTimeoutMs;
}

export function refreshApprovalMessagesFromRoom(
  approvalMessages: ChatMessage[],
  roomMessages: ChatMessage[]
): ChatMessage[] {
  const approvalMessageIds = new Set(approvalMessages.map((message) => message.id).filter(Boolean));
  const refreshed = roomMessages.filter((message) => approvalMessageIds.has(message.id) && !message.deletedAt);
  return refreshed.length ? refreshed : approvalMessages.filter((message) => !message.deletedAt);
}
