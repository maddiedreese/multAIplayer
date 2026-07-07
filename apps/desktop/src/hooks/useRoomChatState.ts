import { useAppStore } from "../store/appStore";

export function useRoomChatState() {
  const chatMessagesByRoom = useAppStore((state) => state.chatMessagesByRoom);
  const draftsByRoom = useAppStore((state) => state.draftsByRoom);
  const pendingAttachmentsByRoom = useAppStore((state) => state.pendingAttachmentsByRoom);
  const sensitiveAttachmentReviewKey = useAppStore((state) => state.sensitiveAttachmentReviewKey);
  const setSensitiveAttachmentReviewKey = useAppStore((state) => state.setSensitiveAttachmentReviewKey);

  return {
    chatMessagesByRoom,
    draftsByRoom,
    pendingAttachmentsByRoom,
    sensitiveAttachmentReviewKey,
    setSensitiveAttachmentReviewKey
  };
}
