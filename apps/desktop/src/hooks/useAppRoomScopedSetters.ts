import type { useAppRefs } from "./useAppRefs";
import type { useAppSelectedContext } from "./useAppSelectedContext";
import type { useAppStateSlices } from "./useAppStateSlices";
import { useRoomScopedSetters } from "./useRoomScopedSetters";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type SelectedRoom = ReturnType<typeof useAppSelectedContext>["selectedRoom"];

export function useAppRoomScopedSetters({
  appState,
  appRefs,
  selectedRoom,
  hasSelectedRoom,
  maxTerminalActivityLines,
  defaultBrowserUrl,
  defaultBrowserReason,
  defaultCodexModel,
  defaultProjectPath
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  selectedRoom: SelectedRoom;
  hasSelectedRoom: boolean;
  maxTerminalActivityLines: number;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
  defaultCodexModel: string;
  defaultProjectPath: string;
}) {
  const {
    workspaceState,
    roomChatState,
    roomSettingsState,
    historyDefaultsState,
    roomRuntimeState,
    codexRoomState,
    localPreviewState,
    terminalPanelState,
    browserPanelState,
    githubWorkflowPanelState,
    filePanelState,
    invitePanelState
  } = appState;

  return useRoomScopedSetters({
    messages: {
      selectedRoomId: selectedRoom.id,
      selectedTeamId: workspaceState.selectedTeam,
      setHostMessagesByRoom: roomSettingsState.setHostMessagesByRoom,
      setChatMessagesByRoom: roomChatState.setChatMessagesByRoom,
      setMarkdownCopyFallbacksByRoom: filePanelState.setMarkdownCopyFallbacksByRoom,
      setSecretWarningsVisibleByRoom: codexRoomState.setSecretWarningsVisibleByRoom,
      setHistoryMessagesByRoom: historyDefaultsState.setHistoryMessagesByRoom,
      setTeamHistoryMessagesByTeam: historyDefaultsState.setTeamHistoryMessagesByTeam,
      setSettingsMessagesByRoom: roomSettingsState.setSettingsMessagesByRoom
    },
    busy: {
      gitWorkflowBusyRef: appRefs.gitWorkflowBusyRef,
      actionsBusyRef: appRefs.actionsBusyRef,
      localPreviewBusyRef: appRefs.localPreviewBusyRef,
      hostBusyRef: appRefs.hostBusyRef,
      settingsBusyRef: appRefs.settingsBusyRef,
      keyRotationBusyRef: appRefs.keyRotationBusyRef,
      fileBusyRef: appRefs.fileBusyRef,
      terminalBusyRef: appRefs.terminalBusyRef,
      setGitWorkflowBusyByRoom: githubWorkflowPanelState.setGitWorkflowBusyByRoom,
      setActionsBusyByRoom: githubWorkflowPanelState.setActionsBusyByRoom,
      setLocalPreviewBusyByRoom: localPreviewState.setLocalPreviewBusyByRoom,
      setHostBusyByRoom: roomSettingsState.setHostBusyByRoom,
      setSettingsBusyByRoom: roomSettingsState.setSettingsBusyByRoom,
      setKeyRotationBusyByRoom: invitePanelState.setKeyRotationBusyByRoom,
      setFileBusyByRoom: filePanelState.setFileBusyByRoom,
      setTerminalBusyByRoom: terminalPanelState.setTerminalBusyByRoom
    },
    files: {
      selectedRoomId: selectedRoom.id,
      setFileQueriesByRoom: filePanelState.setFileQueriesByRoom,
      setProjectFilesByRoom: filePanelState.setProjectFilesByRoom,
      setSelectedFilesByRoom: filePanelState.setSelectedFilesByRoom,
      setSelectedDiffsByRoom: filePanelState.setSelectedDiffsByRoom,
      setFilePreviewTabsByRoom: filePanelState.setFilePreviewTabsByRoom,
      setFileBusyByRoom: filePanelState.setFileBusyByRoom,
      setFileMessagesByRoom: filePanelState.setFileMessagesByRoom
    },
    terminals: {
      selectedRoomId: selectedRoom.id,
      maxTerminalActivityLines,
      setSelectedTerminalIdsByRoom: terminalPanelState.setSelectedTerminalIdsByRoom,
      setTerminalNamesByRoom: terminalPanelState.setTerminalNamesByRoom,
      setTerminalCommandsByRoom: terminalPanelState.setTerminalCommandsByRoom,
      setTerminalInputsByRoom: terminalPanelState.setTerminalInputsByRoom,
      setTerminalErrorsByRoom: terminalPanelState.setTerminalErrorsByRoom,
      setTerminalLinesByRoom: terminalPanelState.setTerminalLinesByRoom
    },
    codexApprovals: {
      setApprovalVisibleByRoom: codexRoomState.setApprovalVisibleByRoom,
      setPendingCodexApprovalsByRoom: codexRoomState.setPendingCodexApprovalsByRoom,
      setCodexRunningByRoom: codexRoomState.setCodexRunningByRoom
    },
    browser: {
      selectedRoomId: selectedRoom.id,
      defaultBrowserUrl,
      defaultBrowserReason,
      setBrowserUrlsByRoom: browserPanelState.setBrowserUrlsByRoom,
      setBrowserReasonsByRoom: browserPanelState.setBrowserReasonsByRoom,
      setBrowserMessagesByRoom: browserPanelState.setBrowserMessagesByRoom
    },
    invites: {
      selectedRoomId: selectedRoom.id,
      setInviteLinksByRoom: invitePanelState.setInviteLinksByRoom,
      setInviteApprovalGatesByRoom: invitePanelState.setInviteApprovalGatesByRoom,
      setInviteMessagesByRoom: invitePanelState.setInviteMessagesByRoom
    },
    drafts: {
      setPendingAttachmentsByRoom: roomChatState.setPendingAttachmentsByRoom,
      setDraftsByRoom: roomChatState.setDraftsByRoom
    },
    project: {
      roomsRef: appRefs.roomsRef,
      defaultCodexModel,
      defaultProjectPath,
      setCustomCodexModelsByRoom: roomSettingsState.setCustomCodexModelsByRoom,
      setProjectPathDraftsByRoom: roomSettingsState.setProjectPathDraftsByRoom
    },
    git: {
      selectedRoomId: selectedRoom.id,
      hasSelectedRoom,
      setGitWorkflowMessagesByRoom: githubWorkflowPanelState.setGitWorkflowMessagesByRoom,
      setGitWorkflowDraftsByRoom: githubWorkflowPanelState.setGitWorkflowDraftsByRoom,
      setGitStatusByRoom: githubWorkflowPanelState.setGitStatusByRoom
    },
    events: {
      setGitWorkflowEventsByRoom: roomRuntimeState.setGitWorkflowEventsByRoom,
      setGitHubActionsEventsByRoom: roomRuntimeState.setGitHubActionsEventsByRoom,
      setLocalPreviewsByRoom: localPreviewState.setLocalPreviewsByRoom,
      setHostHandoffsByRoom: roomRuntimeState.setHostHandoffsByRoom,
      setInviteRequestsByRoom: invitePanelState.setInviteRequestsByRoom,
      setCodexEventsByRoom: codexRoomState.setCodexEventsByRoom
    },
    requests: {
      setInviteRequestsByRoom: invitePanelState.setInviteRequestsByRoom,
      setTerminalRequestsByRoom: terminalPanelState.setTerminalRequestsByRoom,
      setBrowserRequestsByRoom: browserPanelState.setBrowserRequestsByRoom
    }
  });
}
