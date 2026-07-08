import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";

interface UseMarkdownSelectionOptions {
  activeRoomId: string;
  enabled: boolean;
  resetKey: string;
}

export function useMarkdownSelection({ activeRoomId, enabled, resetKey }: UseMarkdownSelectionOptions) {
  const [markdownSelectionMode, setMarkdownSelectionMode] = useState(false);
  const roomChatByRoom = useAppStore((state) => state.roomChatByRoom);
  const toggleSelectedMessageForRoom = useAppStore((state) => state.toggleSelectedMessageForRoom);
  const clearSelectedMessagesForRoom = useAppStore((state) => state.clearSelectedMessagesForRoom);

  useEffect(() => {
    setMarkdownSelectionMode(false);
  }, [resetKey]);

  const selectedMessageIds = roomChatByRoom[activeRoomId]?.selectedMessageIds ?? [];

  function toggleMessageSelection(messageId: string) {
    if (!enabled) return;
    toggleSelectedMessageForRoom(activeRoomId, messageId);
  }

  function clearSelectedMessages() {
    clearSelectedMessagesForRoom(activeRoomId);
  }

  function toggleMarkdownSelectionMode() {
    setMarkdownSelectionMode((current) => {
      if (current) clearSelectedMessages();
      return !current;
    });
  }

  return {
    markdownSelectionMode,
    selectedMessageIds,
    clearSelectedMessages,
    toggleMarkdownSelectionMode,
    toggleMessageSelection
  };
}
