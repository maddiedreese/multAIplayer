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
  return messages.filter((message) => !isBrowserDecisionSystemMessage(message)).map((message) => ({
    id: message.id,
    author: message.author,
    role: message.role,
    body: message.body,
    time: message.time,
    selected: markdownSelectionMode && selectedMessageIds.includes(message.id),
    attachments: (message.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      meta: formatAttachmentMeta(attachment),
      encryptedBlob: Boolean(attachment.blobId),
      canPreview: canOpenChatAttachment(attachment)
    })),
    reactions: roomReactionEmoji.map((emoji) => {
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
