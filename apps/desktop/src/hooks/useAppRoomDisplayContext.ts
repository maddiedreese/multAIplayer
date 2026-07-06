import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "./useAppStateSlices";
import { useRoomDisplayContext } from "./useRoomDisplayContext";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;

export function useAppRoomDisplayContext({
  appState,
  selected,
  selectedRuntime,
  approvalPolicyLabels
}: {
  appState: AppStateSlices;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  approvalPolicyLabels: Record<string, string>;
}) {
  const {
    workspaceState,
    appConfigState,
    roomChatState,
    codexRoomState,
    appRuntimeState,
    terminalPanelState,
    browserPanelState
  } = appState;
  const {
    selectedRoom,
    selectedFile,
    terminalLines,
    terminalCommand
  } = selected;

  return useRoomDisplayContext({
    fileTerminal: {
      selectedFile,
      selectedRoomId: selectedRoom.id,
      selectedRoomProjectPath: selectedRoom.projectPath,
      sensitiveAttachmentReviewKey: roomChatState.sensitiveAttachmentReviewKey,
      selectedTerminal: selectedRuntime.selectedTerminal,
      terminalLines,
      terminalCommand,
      terminalRequests: selectedRuntime.terminalRequests,
      codexEvents: selectedRuntime.codexEvents
    },
    sidebar: {
      sidebarQuery: workspaceState.sidebarQuery,
      rooms: workspaceState.rooms,
      teams: workspaceState.teams,
      selectedTeam: workspaceState.selectedTeam,
      selectedRoomId: workspaceState.selectedRoomId,
      messagesByRoom: workspaceState.messagesByRoom,
      historySearchMessagesByRoom: appRuntimeState.historySearchMessagesByRoom,
      approvalVisibleByRoom: codexRoomState.approvalVisibleByRoom,
      terminalRequestsByRoom: terminalPanelState.terminalRequestsByRoom,
      browserRequestsByRoom: browserPanelState.browserRequestsByRoom,
      approvalPolicyLabels
    },
    teamMembers: {
      selectedTeam: workspaceState.selectedTeam,
      relayHttpUrl: appConfigState.appConfig.relayHttpUrl,
      setTeamMembersByTeam: workspaceState.setTeamMembersByTeam,
      setTeamMembersMessageByTeam: workspaceState.setTeamMembersMessageByTeam
    }
  });
}
