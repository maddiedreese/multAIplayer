import type { useAppRefs } from "./useAppRefs";
import type { useAppSelectedContext } from "./useAppSelectedContext";
import type { useAppStateSlices } from "./useAppStateSlices";
import { useRoomActions } from "./useRoomActions";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type SelectedRoom = ReturnType<typeof useAppSelectedContext>["selectedRoom"];

export function useAppRoomActions({
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

  return useRoomActions({
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
    maxTerminalActivityLines,
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
