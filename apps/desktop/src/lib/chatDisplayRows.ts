import type {
  LocalPreviewCardDisplay,
  PendingAttachmentDisplay,
  RoomChatMessageDisplay
} from "../components/RoomChatPanel";
import type { ChatAttachment, ChatMessage, LocalPreviewRecord } from "../types";
import { canOpenChatAttachment, formatAttachmentMeta } from "./appFormatters";
import { messageIsBeforeCodexWatermark } from "./codexMessageWatermark";
import { localPreviewStatusLabel } from "./localPreview";
import { isBrowserDecisionSystemMessage } from "./localRoomHistoryPayload";
import type { CodexRoomEvent } from "../types";

const roomReactionEmoji = ["👍", "✅", "👀"];

export function buildRoomChatMessageRows({
  messages,
  markdownSelectionMode,
  selectedMessageIds,
  localUserId,
  codexEvents = []
}: {
  messages: ChatMessage[];
  markdownSelectionMode: boolean;
  selectedMessageIds: string[];
  localUserId: string;
  codexEvents?: readonly CodexRoomEvent[];
}): RoomChatMessageDisplay[] {
  const visibleMessages = messages.filter((message) => !isBrowserDecisionSystemMessage(message));
  const messagesById = new Map(visibleMessages.map((message) => [message.id, message]));
  const lastCodexIndex = visibleMessages.reduce(
    (lastIndex, message, index) => (message.role === "codex" ? index : lastIndex),
    -1
  );
  return visibleMessages.map((message) => ({
    id: message.id,
    author: message.author,
    role: message.role,
    body: message.deletedAt ? formatDeletedMessageBody(message) : message.body,
    time: message.time,
    edited: Boolean(message.editedAt && !message.deletedAt),
    deleted: Boolean(message.deletedAt),
    canEdit:
      canMutateMessage(message, localUserId) &&
      visibleMessages.indexOf(message) > lastCodexIndex &&
      messageIsBeforeCodexWatermark(message, codexEvents),
    canDelete:
      canMutateMessage(message, localUserId) &&
      visibleMessages.indexOf(message) > lastCodexIndex &&
      messageIsBeforeCodexWatermark(message, codexEvents),
    replyPreview: message.replyTo ? buildReplyPreview(messagesById.get(message.replyTo)) : null,
    selected: markdownSelectionMode && selectedMessageIds.includes(message.id),
    attachments: message.deletedAt
      ? []
      : (message.attachments ?? []).map((attachment) => {
          const imageSource = safeInlineImageSource(attachment);
          return {
            id: attachment.id,
            name: attachment.name,
            meta: formatAttachmentMeta(attachment),
            encryptedBlob: Boolean(attachment.blobId),
            canPreview: canOpenChatAttachment(attachment),
            ...(imageSource ? { image: { src: imageSource, alt: attachment.name } } : {})
          };
        }),
    reactions: message.deletedAt
      ? []
      : roomReactionEmoji.map((emoji) => {
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

const safeImageDataUrl = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;

/**
 * Convert only an explicitly embedded, allowlisted raster data URL into a display source.
 * File paths, remote URLs, SVG, malformed base64, and encrypted blob ids stay behind the
 * normal attachment-open flow instead of becoming ambient image requests in the chat.
 */
export function safeInlineImageSource(attachment: ChatAttachment): string | null {
  if (!attachment.content || attachment.content.length > 300_000) return null;
  const match = safeImageDataUrl.exec(attachment.content);
  if (!match) return null;
  const encoded = match[2];
  const declaredImage =
    attachment.type === "image" ||
    /^image\/(?:png|jpeg|gif|webp)$/i.test(attachment.type) ||
    /\.(?:png|jpe?g|gif|webp)$/i.test(attachment.name);
  if (!declaredImage || !encoded || encoded.length % 4 !== 0) return null;
  return attachment.content;
}

function canMutateMessage(message: ChatMessage, localUserId: string): boolean {
  return message.role !== "codex" && !message.deletedAt && message.authorUserId === localUserId;
}

function formatDeletedMessageBody(message: ChatMessage): string {
  if (message.deletedBy) return `Message deleted by ${message.deletedBy}`;
  if (message.deletedByUserId) return `Message deleted by ${message.deletedByUserId.replace(/^github:/, "@")}`;
  return "Message deleted";
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
