import { useAppConfigState } from "./useAppConfigState";
import { useAppRuntimeState } from "./useAppRuntimeState";
import { useBrowserPanelState } from "./useBrowserPanelState";
import { useCodexRoomState } from "./useCodexRoomState";
import { useFilePanelState } from "./useFilePanelState";
import { useGitHubWorkflowPanelState } from "./useGitHubWorkflowPanelState";
import { useHistoryDefaultsState } from "./useHistoryDefaultsState";
import { useInvitePanelState } from "./useInvitePanelState";
import { useLocalPreviewState } from "./useLocalPreviewState";
import { useRoomChatState } from "./useRoomChatState";
import { useRoomRuntimeState } from "./useRoomRuntimeState";
import { useRoomSettingsState } from "./useRoomSettingsState";
import { useShellLayout } from "./useShellLayout";
import { useTerminalPanelState } from "./useTerminalPanelState";
import { useWorkspaceUiState } from "./useWorkspaceUiState";

export function useAppStateSlices({
  workspace,
  historyDefaults,
  terminals
}: {
  workspace: Parameters<typeof useWorkspaceUiState>[0];
  historyDefaults: Parameters<typeof useHistoryDefaultsState>[0];
  terminals: Parameters<typeof useTerminalPanelState>[0];
}) {
  return {
    ...useWorkspaceUiState(workspace),
    ...useAppConfigState(),
    ...useRoomChatState(),
    ...useRoomSettingsState(),
    ...useHistoryDefaultsState(historyDefaults),
    ...useRoomRuntimeState(),
    ...useCodexRoomState(),
    ...useLocalPreviewState(),
    ...useAppRuntimeState(),
    ...useTerminalPanelState(terminals),
    ...useBrowserPanelState(),
    ...useGitHubWorkflowPanelState(),
    ...useFilePanelState(),
    ...useInvitePanelState(),
    ...useShellLayout()
  };
}
