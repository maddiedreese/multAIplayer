import { useEffect } from "react";
import { useAppStore } from "../store/appStore";

const noSelectedMessageIds: string[] = [];

interface UseMarkdownSelectionOptions {
  activeRoomId: string;
  enabled: boolean;
  resetKey: string;
}

export function useMarkdownSelection({ activeRoomId, enabled, resetKey }: UseMarkdownSelectionOptions) {
  const markdownSelectionMode = useAppStore(
    (state) => state.roomChatByRoom[activeRoomId]?.markdownSelectionMode ?? false
  );
  const selectedMessageIds = useAppStore(
    (state) => state.roomChatByRoom[activeRoomId]?.selectedMessageIds ?? noSelectedMessageIds
  );
  const toggleSelectedMessageForRoom = useAppStore((state) => state.toggleSelectedMessageForRoom);
  const clearSelectedMessagesForRoom = useAppStore((state) => state.clearSelectedMessagesForRoom);
  const toggleMarkdownSelectionModeForRoom = useAppStore((state) => state.toggleMarkdownSelectionModeForRoom);
  const disableMarkdownSelectionModeForRoom = useAppStore((state) => state.disableMarkdownSelectionModeForRoom);

  useEffect(() => {
    disableMarkdownSelectionModeForRoom(activeRoomId);
  }, [activeRoomId, disableMarkdownSelectionModeForRoom, resetKey]);

  function toggleMessageSelection(messageId: string) {
    if (!enabled) return;
    toggleSelectedMessageForRoom(activeRoomId, messageId);
  }

  function clearSelectedMessages() {
    clearSelectedMessagesForRoom(activeRoomId);
  }

  function toggleMarkdownSelectionMode() {
    toggleMarkdownSelectionModeForRoom(activeRoomId);
  }

  return {
    markdownSelectionMode,
    selectedMessageIds,
    clearSelectedMessages,
    toggleMarkdownSelectionMode,
    toggleMessageSelection
  };
}
