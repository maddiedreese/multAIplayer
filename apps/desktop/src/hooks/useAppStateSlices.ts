import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { projectBrowserPanelMaps } from "../store/slices/browserSlice";
import { projectCodexRuntimeMaps } from "../store/slices/codexHostHandoffSlice";
import { projectFilePanelMaps } from "../store/slices/filePanelSlice";
import { projectGitHubWorkflowPanelMaps } from "../store/slices/gitWorkflowSlice";
import { projectInvitePanelMaps } from "../store/slices/inviteSlice";
import { projectLocalPreviewPanelMaps } from "../store/slices/localPreviewSlice";
import { projectRoomChatPanelMaps } from "../store/slices/roomChatSlice";
import { projectRoomSettingsPanelMaps } from "../store/slices/roomSettingsSlice";
import { useAppConfigState } from "./useAppConfigState";
import { useAppRuntimeState } from "./useAppRuntimeState";
import { useHistoryDefaultsState } from "./useHistoryDefaultsState";
import { useRoomRuntimeState } from "./useRoomRuntimeState";
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
    shellLayout
  };
}

function useRoomChatState() {
  const roomChatByRoom = useAppStore((state) => state.roomChatByRoom);
  const sensitiveAttachmentReviewKey = useAppStore((state) => state.sensitiveAttachmentReviewKey);
  const setSensitiveAttachmentReviewKey = useAppStore((state) => state.setSensitiveAttachmentReviewKey);
  const roomChatMaps = useMemo(() => projectRoomChatPanelMaps(roomChatByRoom), [roomChatByRoom]);

  return {
    roomChatByRoom,
    ...roomChatMaps,
    sensitiveAttachmentReviewKey,
    setSensitiveAttachmentReviewKey
  };
}

function useRoomSettingsState() {
  const roomSettingsByRoom = useAppStore((state) => state.roomSettingsByRoom);
  const roomSettingsMaps = useMemo(() => projectRoomSettingsPanelMaps(roomSettingsByRoom), [roomSettingsByRoom]);

  return {
    roomSettingsByRoom,
    ...roomSettingsMaps
  };
}

function useCodexRoomState() {
  const codexRuntimeByRoom = useAppStore((state) => state.codexRuntimeByRoom);
  const codexRuntimeMaps = useMemo(() => projectCodexRuntimeMaps(codexRuntimeByRoom), [codexRuntimeByRoom]);

  return {
    codexRuntimeByRoom,
    ...codexRuntimeMaps
  };
}

function useLocalPreviewState() {
  const localPreviewByRoom = useAppStore((state) => state.localPreviewByRoom);
  const localPreviewDialog = useAppStore((state) => state.localPreviewDialog);
  const openLocalPreviewDialogForRoom = useAppStore((state) => state.openLocalPreviewDialogForRoom);
  const closeLocalPreviewDialog = useAppStore((state) => state.closeLocalPreviewDialog);
  const setLocalPreviewDialogCandidates = useAppStore((state) => state.setLocalPreviewDialogCandidates);
  const setLocalPreviewDialogSelectedUrl = useAppStore((state) => state.setLocalPreviewDialogSelectedUrl);
  const setLocalPreviewDialogManualUrl = useAppStore((state) => state.setLocalPreviewDialogManualUrl);
  const setLocalPreviewDialogPhase = useAppStore((state) => state.setLocalPreviewDialogPhase);
  const setLocalPreviewDialogConfirmation = useAppStore((state) => state.setLocalPreviewDialogConfirmation);
  const setLocalPreviewDialogError = useAppStore((state) => state.setLocalPreviewDialogError);
  const localPreviewMaps = useMemo(() => projectLocalPreviewPanelMaps(localPreviewByRoom), [localPreviewByRoom]);

  return {
    ...localPreviewMaps,
    localPreviewDialog,
    openLocalPreviewDialogForRoom,
    closeLocalPreviewDialog,
    setLocalPreviewDialogCandidates,
    setLocalPreviewDialogSelectedUrl,
    setLocalPreviewDialogManualUrl,
    setLocalPreviewDialogPhase,
    setLocalPreviewDialogConfirmation,
    setLocalPreviewDialogError
  };
}

function useBrowserPanelState() {
  const browserByRoom = useAppStore((state) => state.browserByRoom);
  const browserMaps = useMemo(() => projectBrowserPanelMaps(browserByRoom), [browserByRoom]);

  return {
    browserByRoom,
    ...browserMaps
  };
}

function useGitHubWorkflowPanelState() {
  const gitWorkflowRuntimeByRoom = useAppStore((state) => state.gitWorkflowRuntimeByRoom);
  const gitWorkflowMaps = useMemo(
    () => projectGitHubWorkflowPanelMaps(gitWorkflowRuntimeByRoom),
    [gitWorkflowRuntimeByRoom]
  );

  return {
    gitWorkflowRuntimeByRoom,
    ...gitWorkflowMaps
  };
}

function useFilePanelState() {
  const filePanelByRoom = useAppStore((state) => state.filePanelByRoom);
  const filePanelMaps = useMemo(() => projectFilePanelMaps(filePanelByRoom), [filePanelByRoom]);

  return {
    filePanelByRoom,
    ...filePanelMaps
  };
}

function useInvitePanelState() {
  const inviteByRoom = useAppStore((state) => state.inviteByRoom);
  const inviteSecretInput = useAppStore((state) => state.inviteSecretInput);
  const setInviteSecretInputValue = useAppStore((state) => state.setInviteSecretInputValue);
  const clearInviteSecretInput = useAppStore((state) => state.clearInviteSecretInput);
  const inviteMaps = useMemo(() => projectInvitePanelMaps(inviteByRoom), [inviteByRoom]);

  return {
    inviteByRoom,
    ...inviteMaps,
    inviteSecretInput,
    setInviteSecretInputValue,
    clearInviteSecretInput
  };
}
