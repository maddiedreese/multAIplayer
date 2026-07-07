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
  maxTerminalActivityLines,
  defaultBrowserUrl,
  defaultBrowserReason,
  defaultCodexModel,
  defaultProjectPath
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  selectedRoom: SelectedRoom;
  maxTerminalActivityLines: number;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
  defaultCodexModel: string;
  defaultProjectPath: string;
}) {
  const {
    workspaceState,
    roomSettingsState,
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
    selectedRoomId: selectedRoom.id,
    selectedTeamId: workspaceState.selectedTeam,
    busy: {
      gitWorkflowBusyRef: appRefs.gitWorkflowBusyRef,
      actionsBusyRef: appRefs.actionsBusyRef,
      localPreviewBusyRef: appRefs.localPreviewBusyRef,
      hostBusyRef: appRefs.hostBusyRef,
      settingsBusyRef: appRefs.settingsBusyRef,
      keyRotationBusyRef: appRefs.keyRotationBusyRef,
      fileBusyRef: appRefs.fileBusyRef,
      terminalBusyRef: appRefs.terminalBusyRef
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
      defaultBrowserUrl,
      defaultBrowserReason
    },
    project: {
      roomsRef: appRefs.roomsRef,
      defaultCodexModel,
      defaultProjectPath
    },
    events: {
      setGitWorkflowEventsByRoom: roomRuntimeState.setGitWorkflowEventsByRoom,
      setGitHubActionsEventsByRoom: roomRuntimeState.setGitHubActionsEventsByRoom,
      setLocalPreviewsByRoom: localPreviewState.setLocalPreviewsByRoom,
      setHostHandoffsByRoom: roomRuntimeState.setHostHandoffsByRoom,
      setInviteRequestsByRoom: invitePanelState.setInviteRequestsByRoom,
      setCodexEventsByRoom: codexRoomState.setCodexEventsByRoom
    }
  });
}
