import { useMemo } from "react";
import { useAppStore } from "../store/appStore";

export function useRoomChatState() {
  const roomChatByRoom = useAppStore((state) => state.roomChatByRoom);
  const sensitiveAttachmentReviewKey = useAppStore((state) => state.sensitiveAttachmentReviewKey);
  const setSensitiveAttachmentReviewKey = useAppStore((state) => state.setSensitiveAttachmentReviewKey);

  const {
    chatMessagesByRoom,
    draftsByRoom,
    pendingAttachmentsByRoom,
    selectedMessageIdsByRoom
  } = useMemo(() => ({
    chatMessagesByRoom: Object.fromEntries(
      Object.entries(roomChatByRoom)
        .filter(([, chat]) => chat.message)
        .map(([roomId, chat]) => [roomId, chat.message ?? null])
    ),
    draftsByRoom: Object.fromEntries(
      Object.entries(roomChatByRoom)
        .filter(([, chat]) => chat.draft)
        .map(([roomId, chat]) => [roomId, chat.draft ?? ""])
    ),
    pendingAttachmentsByRoom: Object.fromEntries(
      Object.entries(roomChatByRoom)
        .filter(([, chat]) => chat.pendingAttachments)
        .map(([roomId, chat]) => [roomId, chat.pendingAttachments ?? []])
    ),
    selectedMessageIdsByRoom: Object.fromEntries(
      Object.entries(roomChatByRoom)
        .filter(([, chat]) => chat.selectedMessageIds)
        .map(([roomId, chat]) => [roomId, chat.selectedMessageIds ?? []])
    )
  }), [roomChatByRoom]);

  return {
    roomChatByRoom,
    chatMessagesByRoom,
    draftsByRoom,
    pendingAttachmentsByRoom,
    selectedMessageIdsByRoom,
    sensitiveAttachmentReviewKey,
    setSensitiveAttachmentReviewKey
  };
}
