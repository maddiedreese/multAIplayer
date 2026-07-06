import { useEffect, useState } from "react";
import { omitRecordKey } from "../lib/setUtils";

interface UseMarkdownSelectionOptions {
  activeRoomId: string;
  enabled: boolean;
  resetKey: string;
}

export function useMarkdownSelection({ activeRoomId, enabled, resetKey }: UseMarkdownSelectionOptions) {
  const [selectedMessageIdsByRoom, setSelectedMessageIdsByRoom] = useState<Record<string, string[]>>({});
  const [markdownSelectionMode, setMarkdownSelectionMode] = useState(false);

  useEffect(() => {
    setMarkdownSelectionMode(false);
  }, [resetKey]);

  const selectedMessageIds = selectedMessageIdsByRoom[activeRoomId] ?? [];

  function toggleMessageSelection(messageId: string) {
    if (!enabled) return;
    setSelectedMessageIdsByRoom((current) => {
      const roomIds = current[activeRoomId] ?? [];
      const nextIds = roomIds.includes(messageId)
        ? roomIds.filter((id) => id !== messageId)
        : [...roomIds, messageId];
      return {
        ...current,
        [activeRoomId]: nextIds
      };
    });
  }

  function clearSelectedMessages() {
    setSelectedMessageIdsByRoom((current) => omitRecordKey(current, activeRoomId));
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
