import { useAppStore } from "../store/appStore";

export function useRoomChatState() {
  const chatMessagesByRoom = useAppStore((state) => state.chatMessagesByRoom);
  const setChatMessagesByRoom = useAppStore((state) => state.setChatMessagesByRoom);
  const draftsByRoom = useAppStore((state) => state.draftsByRoom);
  const setDraftsByRoom = useAppStore((state) => state.setDraftsByRoom);
  const pendingAttachmentsByRoom = useAppStore((state) => state.pendingAttachmentsByRoom);
  const setPendingAttachmentsByRoom = useAppStore((state) => state.setPendingAttachmentsByRoom);
  const sensitiveAttachmentReviewKey = useAppStore((state) => state.sensitiveAttachmentReviewKey);
  const setSensitiveAttachmentReviewKey = useAppStore((state) => state.setSensitiveAttachmentReviewKey);

  return {
    chatMessagesByRoom,
    setChatMessagesByRoom,
    draftsByRoom,
    setDraftsByRoom,
    pendingAttachmentsByRoom,
    setPendingAttachmentsByRoom,
    sensitiveAttachmentReviewKey,
    setSensitiveAttachmentReviewKey
  };
}
