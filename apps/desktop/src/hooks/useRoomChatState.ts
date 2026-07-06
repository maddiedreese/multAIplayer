import { useState } from "react";
import type { ChatAttachment } from "../types";

export function useRoomChatState() {
  const [chatMessagesByRoom, setChatMessagesByRoom] = useState<Record<string, string | null>>({});
  const [draftsByRoom, setDraftsByRoom] = useState<Record<string, string>>({});
  const [pendingAttachmentsByRoom, setPendingAttachmentsByRoom] = useState<Record<string, ChatAttachment[]>>({});
  const [sensitiveAttachmentReviewKey, setSensitiveAttachmentReviewKey] = useState<string | null>(null);

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
