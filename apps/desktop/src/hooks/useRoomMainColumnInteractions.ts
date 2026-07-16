import { useCallback } from "react";
import type { ComponentProps } from "react";
import { RoomMainColumn } from "../components/RoomMainColumn";
import { acknowledgeRoomVisibilityWarning } from "../lib/history/roomVisibilityWarning";
import { useAppStore } from "../store/appStore";

type HeaderProps = ComponentProps<typeof RoomMainColumn>["headerProps"];

export interface MarkdownFallback {
  title: string;
  markdown: string;
}

export function useRoomMainColumnInteractions({
  roomId,
  selectedRoomId,
  fallback,
  onOpenRoomBrowser,
  retryMarkdownCopy
}: {
  roomId: string;
  selectedRoomId: string | null;
  fallback: MarkdownFallback | null;
  onOpenRoomBrowser: () => void;
  retryMarkdownCopy: (title: string, markdown: string, roomId: string) => void;
}) {
  const onSelectTeam = useCallback(
    (teamId: string) => useAppStore.getState().selectTeamRoom(teamId, selectedRoomId),
    [selectedRoomId]
  );
  const onSelectInspectorTab = useCallback(
    (tab: HeaderProps["activeInspectorTab"]) => {
      useAppStore.getState().setInspectorTabForRoom(roomId, tab);
      if (tab === "browser" && !useAppStore.getState().browserByRoom[roomId]?.activeUrl) onOpenRoomBrowser();
    },
    [onOpenRoomBrowser, roomId]
  );
  const onToggleMarkdownSelection = useCallback(
    () => useAppStore.getState().toggleMarkdownSelectionModeForRoom(roomId),
    [roomId]
  );
  const onClearSelectedMessages = useCallback(
    () => useAppStore.getState().clearSelectedMessagesForRoom(roomId),
    [roomId]
  );
  const onToggleMessageSelection = useCallback(
    (messageId: string) => useAppStore.getState().toggleSelectedMessageForRoom(roomId, messageId),
    [roomId]
  );
  const onOpenFileSelector = useCallback(
    () => useAppStore.getState().setInspectorTabForRoom(roomId, "files"),
    [roomId]
  );
  const onReplyToMessage = useCallback(
    (messageId: string) => useAppStore.getState().setReplyToMessageForRoom(roomId, messageId),
    [roomId]
  );
  const onCancelReply = useCallback(() => useAppStore.getState().setReplyToMessageForRoom(roomId, null), [roomId]);
  const onDraftChange = useCallback((draft: string) => useAppStore.getState().setDraftForRoom(roomId, draft), [roomId]);
  const onAcknowledgeSecretWarning = useCallback(() => {
    acknowledgeRoomVisibilityWarning(roomId);
    useAppStore.getState().setSecretWarningVisibleForRoom(roomId, false);
  }, [roomId]);
  const onDismissMarkdownFallback = useCallback(
    () => useAppStore.getState().setMarkdownCopyFallbackForRoom(roomId, null),
    [roomId]
  );
  const onRetryMarkdownCopy = useCallback(() => {
    if (fallback) retryMarkdownCopy(fallback.title, fallback.markdown, roomId);
  }, [fallback, retryMarkdownCopy, roomId]);

  return {
    onSelectTeam,
    onSelectInspectorTab,
    onToggleMarkdownSelection,
    onClearSelectedMessages,
    onToggleMessageSelection,
    onOpenFileSelector,
    onReplyToMessage,
    onCancelReply,
    onDraftChange,
    onAcknowledgeSecretWarning,
    onDismissMarkdownFallback,
    onRetryMarkdownCopy
  };
}
