import { createRoomChatPanelActions } from "../chat/roomChatPanelActions";
import { createRoomHeaderActions } from "./roomHeaderActions";
import { createTerminalPanelActions } from "../terminal/terminalPanelActions";
import { createWorkspaceFilesPanelActions } from "../files/workspaceFilesPanelActions";

export function createRoomPanelActions({
  chat,
  header,
  terminal,
  workspaceFiles
}: {
  chat: Parameters<typeof createRoomChatPanelActions>[0];
  header: Parameters<typeof createRoomHeaderActions>[0];
  terminal: Parameters<typeof createTerminalPanelActions>[0];
  workspaceFiles: Parameters<typeof createWorkspaceFilesPanelActions>[0];
}) {
  return {
    roomChatPanelActions: createRoomChatPanelActions(chat),
    roomHeaderActions: createRoomHeaderActions(header),
    terminalPanelActions: createTerminalPanelActions(terminal),
    workspaceFilesPanelActions: createWorkspaceFilesPanelActions(workspaceFiles)
  };
}
