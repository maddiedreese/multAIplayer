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
  const workspaceState = useWorkspaceUiState(workspace);
  const appConfigState = useAppConfigState();
  const roomChatState = useRoomChatState();
  const roomSettingsState = useRoomSettingsState();
  const historyDefaultsState = useHistoryDefaultsState(historyDefaults);
  const roomRuntimeState = useRoomRuntimeState();
  const codexRoomState = useCodexRoomState();
  const localPreviewState = useLocalPreviewState();
  const appRuntimeState = useAppRuntimeState();
  const terminalPanelState = useTerminalPanelState(terminals);
  const browserPanelState = useBrowserPanelState();
  const githubWorkflowPanelState = useGitHubWorkflowPanelState();
  const filePanelState = useFilePanelState();
  const invitePanelState = useInvitePanelState();
  const shellLayout = useShellLayout();

  return {
    workspaceState,
    appConfigState,
    roomChatState,
    roomSettingsState,
    historyDefaultsState,
    roomRuntimeState,
    codexRoomState,
    localPreviewState,
    appRuntimeState,
    terminalPanelState,
    browserPanelState,
    githubWorkflowPanelState,
    filePanelState,
    invitePanelState,
    shellLayout,
    ...workspaceState,
    ...appConfigState,
    ...roomChatState,
    ...roomSettingsState,
    ...historyDefaultsState,
    ...roomRuntimeState,
    ...codexRoomState,
    ...localPreviewState,
    ...appRuntimeState,
    ...terminalPanelState,
    ...browserPanelState,
    ...githubWorkflowPanelState,
    ...filePanelState,
    ...invitePanelState,
    ...shellLayout
  };
}
