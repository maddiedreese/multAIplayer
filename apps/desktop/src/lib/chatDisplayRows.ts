import type {
  LocalPreviewCardDisplay,
  PendingAttachmentDisplay,
  RoomChatMessageDisplay
} from "../components/RoomChatPanel";
import type { ChatAttachment, ChatMessage, LocalPreviewRecord } from "../types";
import { canOpenChatAttachment, formatAttachmentMeta } from "./appFormatters";
import { localPreviewStatusLabel } from "./localPreview";
import { isBrowserDecisionSystemMessage } from "./localRoomHistoryPayload";

const roomReactionEmoji = ["👍", "✅", "👀"];

export function buildRoomChatMessageRows({
  messages,
  markdownSelectionMode,
  selectedMessageIds,
  localUserId
}: {
  messages: ChatMessage[];
  markdownSelectionMode: boolean;
  selectedMessageIds: string[];
  localUserId: string;
}): RoomChatMessageDisplay[] {
  const visibleMessages = messages.filter((message) => !isBrowserDecisionSystemMessage(message));
  const messagesById = new Map(visibleMessages.map((message) => [message.id, message]));
  const lastCodexIndex = visibleMessages.reduce((lastIndex, message, index) => (
    message.role === "codex" ? index : lastIndex
  ), -1);
  return visibleMessages.map((message) => ({
    id: message.id,
    author: message.author,
    role: message.role,
    body: message.deletedAt ? "Message deleted" : message.body,
    time: message.time,
    edited: Boolean(message.editedAt && !message.deletedAt),
    deleted: Boolean(message.deletedAt),
    canEdit: canMutateMessage(message, localUserId) && visibleMessages.indexOf(message) > lastCodexIndex,
    canDelete: canMutateMessage(message, localUserId) && visibleMessages.indexOf(message) > lastCodexIndex,
    replyPreview: message.replyTo ? buildReplyPreview(messagesById.get(message.replyTo)) : null,
    selected: markdownSelectionMode && selectedMessageIds.includes(message.id),
    attachments: message.deletedAt ? [] : (message.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      meta: formatAttachmentMeta(attachment),
      encryptedBlob: Boolean(attachment.blobId),
      canPreview: canOpenChatAttachment(attachment)
    })),
    reactions: message.deletedAt ? [] : roomReactionEmoji.map((emoji) => {
      const reaction = message.reactions?.find((item) => item.emoji === emoji);
      return {
        emoji,
        count: reaction?.reactors.length ?? 0,
        active: reaction?.reactors.some((reactor) => reactor.userId === localUserId) ?? false,
        title: reaction?.reactors.map((reactor) => reactor.name).join(", ") || "React"
      };
    })
  }));
}

function canMutateMessage(message: ChatMessage, localUserId: string): boolean {
  return message.role !== "codex" && !message.deletedAt && message.authorUserId === localUserId;
}

function buildReplyPreview(message: ChatMessage | undefined): RoomChatMessageDisplay["replyPreview"] {
  if (!message) {
    return {
      author: "Original message",
      body: "Original message unavailable or deleted"
    };
  }
  return {
    author: message.author,
    body: message.deletedAt ? "Original message deleted" : message.body || "Original message unavailable or deleted"
  };
}

export function buildPendingAttachmentRows(attachments: ChatAttachment[]): PendingAttachmentDisplay[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    encryptedBlob: Boolean(attachment.blobId)
  }));
}

export function buildLocalPreviewCards(previews: LocalPreviewRecord[], localUserId: string): LocalPreviewCardDisplay[] {
  return previews.slice(-6).map((preview) => ({
    id: preview.id,
    sharedBy: preview.sharedBy,
    sourceUrl: preview.sourceUrl,
    publicUrl: preview.publicUrl,
    status: preview.status,
    statusLabel: localPreviewStatusLabel(preview.status),
    message: preview.message,
    canStop: preview.sharedByUserId === localUserId && (preview.status === "live" || preview.status === "starting")
  }));
}
