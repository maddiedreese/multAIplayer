import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { projectRoomChatPanelMaps } from "../store/slices/roomChatSlice";

export function useRoomChatState() {
  const roomChatByRoom = useAppStore((state) => state.roomChatByRoom);
  const sensitiveAttachmentReviewKey = useAppStore((state) => state.sensitiveAttachmentReviewKey);
  const setSensitiveAttachmentReviewKey = useAppStore((state) => state.setSensitiveAttachmentReviewKey);

  const {
    chatMessagesByRoom,
    draftsByRoom,
    pendingAttachmentsByRoom,
    selectedMessageIdsByRoom
  } = useMemo(() => projectRoomChatPanelMaps(roomChatByRoom), [roomChatByRoom]);

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
