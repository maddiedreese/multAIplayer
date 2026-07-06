import { useRoomChatPanelActions } from "./useRoomChatPanelActions";
import { useRoomHeaderActions } from "./useRoomHeaderActions";
import { useTerminalPanelActions } from "./useTerminalPanelActions";
import { useWorkspaceFilesPanelActions } from "./useWorkspaceFilesPanelActions";

export function useRoomPanelActions({
  chat,
  header,
  terminal,
  workspaceFiles
}: {
  chat: Parameters<typeof useRoomChatPanelActions>[0];
  header: Parameters<typeof useRoomHeaderActions>[0];
  terminal: Parameters<typeof useTerminalPanelActions>[0];
  workspaceFiles: Parameters<typeof useWorkspaceFilesPanelActions>[0];
}) {
  return {
    roomChatPanelActions: useRoomChatPanelActions(chat),
    roomHeaderActions: useRoomHeaderActions(header),
    terminalPanelActions: useTerminalPanelActions(terminal),
    workspaceFilesPanelActions: useWorkspaceFilesPanelActions(workspaceFiles)
  };
}
