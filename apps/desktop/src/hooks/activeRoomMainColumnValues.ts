import type { ChatAttachment, ChatMessage, CodexActivity, CodexRoomEvent } from "../types";
import { messagesSinceLastCodex } from "../lib/codex/codexTurn";
import type { AppStoreState } from "../store/appStore";
import type { GuidedActivityKind } from "../components/GuidedFirstTurn";

const noPendingAttachments: ChatAttachment[] = [];
const noSelectedMessageIds: string[] = [];
const noCodexEvents: CodexRoomEvent[] = [];

export function mainColumnLocalUser(user: { id: string; name?: string; login: string } | null, localDeviceId: string) {
  return {
    id: user?.id ?? `local:${localDeviceId}`,
    name: user?.name ?? user?.login ?? "Local user"
  };
}

export function deriveMainColumnValues(
  chat: AppStoreState["roomChatByRoom"][string] | undefined,
  codex: AppStoreState["codexRuntimeByRoom"][string] | undefined,
  messages: ChatMessage[]
) {
  const activeApproval = codex?.pendingApproval ?? null;
  return {
    pendingAttachments: chat?.pendingAttachments ?? noPendingAttachments,
    selectedMessageIds: chat?.selectedMessageIds ?? noSelectedMessageIds,
    markdownSelectionMode: chat?.markdownSelectionMode ?? false,
    activeApproval,
    approvalMessages: messagesSinceLastCodex(activeApproval?.messages ?? messages) as ChatMessage[],
    codexEvents: codex?.events ?? noCodexEvents,
    queuedApprovals: codex?.queuedApprovals ?? [],
    currentMessagesSinceLastCodex: messagesSinceLastCodex(messages).length,
    replyTargetMessage: findReplyTargetMessage(messages, chat?.replyToMessageId)
  };
}

export function replyTargetDisplay(message: ChatMessage | null) {
  if (!message) return null;
  return {
    author: message.deletedAt ? "Original message" : message.author,
    body: message.deletedAt ? "Original message deleted" : message.body || "Original message unavailable or deleted"
  };
}

export function guidedActivityKind(kind: CodexActivity["kind"]): GuidedActivityKind | null {
  if (kind === "reasoning") return "thinking";
  if (kind === "command") return "commands";
  if (kind === "file_change") return "edits";
  if (kind === "agent") return "subagents";
  if (kind === "tool" || kind === "web_search" || kind === "image_generation" || kind === "hook") return "tools";
  return null;
}

function findReplyTargetMessage(messages: ChatMessage[], replyToMessageId: string | null | undefined) {
  if (!replyToMessageId) return null;
  return messages.find((message) => message.id === replyToMessageId) ?? null;
}
