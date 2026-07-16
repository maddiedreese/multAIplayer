import { useEffect } from "react";
import { useAppStore } from "../store/appStore";

const noSelectedMessageIds: string[] = [];

interface UseMarkdownSelectionOptions {
  activeRoomId: string | null;
  enabled: boolean;
  resetKey: string | null;
}

export function useMarkdownSelection({ activeRoomId, enabled, resetKey }: UseMarkdownSelectionOptions) {
  const markdownSelectionMode = useAppStore((state) =>
    activeRoomId ? (state.roomChatByRoom[activeRoomId]?.markdownSelectionMode ?? false) : false
  );
  const selectedMessageIds = useAppStore((state) =>
    activeRoomId
      ? (state.roomChatByRoom[activeRoomId]?.selectedMessageIds ?? noSelectedMessageIds)
      : noSelectedMessageIds
  );
  const toggleSelectedMessageForRoom = useAppStore((state) => state.toggleSelectedMessageForRoom);
  const clearSelectedMessagesForRoom = useAppStore((state) => state.clearSelectedMessagesForRoom);
  const toggleMarkdownSelectionModeForRoom = useAppStore((state) => state.toggleMarkdownSelectionModeForRoom);
  const disableMarkdownSelectionModeForRoom = useAppStore((state) => state.disableMarkdownSelectionModeForRoom);

  useEffect(() => {
    if (activeRoomId) disableMarkdownSelectionModeForRoom(activeRoomId);
  }, [activeRoomId, disableMarkdownSelectionModeForRoom, resetKey]);

  function toggleMessageSelection(messageId: string) {
    if (!enabled || !activeRoomId) return;
    toggleSelectedMessageForRoom(activeRoomId, messageId);
  }

  function clearSelectedMessages() {
    if (activeRoomId) clearSelectedMessagesForRoom(activeRoomId);
  }

  function toggleMarkdownSelectionMode() {
    if (activeRoomId) toggleMarkdownSelectionModeForRoom(activeRoomId);
  }

  return {
    markdownSelectionMode,
    selectedMessageIds,
    clearSelectedMessages,
    toggleMarkdownSelectionMode,
    toggleMessageSelection
  };
}
