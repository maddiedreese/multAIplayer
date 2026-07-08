import { useAppSelectedContext } from "./useAppSelectedContext";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type AppSelectedContextOptions = Parameters<typeof useAppSelectedContext>[0];

export function useAppSelectedRoomContext({
  appState,
  githubAuth,
  localIdentity,
  fallbackRoom,
  defaultBrowserUrl,
  defaultBrowserReason
}: {
  appState: AppStateSlices;
  githubAuth: GitHubAuth;
  localIdentity: LocalIdentity;
  fallbackRoom: AppSelectedContextOptions["roomContext"]["fallbackRoom"];
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
}) {
  const {
    workspaceState,
    roomChatState,
    roomSettingsState,
    historyDefaultsState,
    roomRuntimeState,
    codexRoomState,
    terminalPanelState,
    browserPanelState,
    githubWorkflowPanelState,
    filePanelState,
    invitePanelState
  } = appState;

  return useAppSelectedContext({
    roomContext: {
      rooms: workspaceState.rooms,
      selectedRoomId: workspaceState.selectedRoomId,
      fallbackRoom,
      inspectorTabsByRoom: roomRuntimeState.inspectorTabsByRoom,
      secretWarningsVisibleByRoom: codexRoomState.secretWarningsVisibleByRoom,
      terminals: terminalPanelState.terminals
    },
    markdownSelection: {
      resetKey: workspaceState.selectedRoomId
    },
    teamData: {
      teams: workspaceState.teams,
      selectedTeam: workspaceState.selectedTeam,
      teamMembersByTeam: workspaceState.teamMembersByTeam,
      teamMembersMessageByTeam: workspaceState.teamMembersMessageByTeam,
      teamMembersBusyByTeam: workspaceState.teamMembersBusyByTeam,
      currentUser: githubAuth.currentUser,
      localUserId: localIdentity.localUser.id
    },
    roomValues: {
      selectedRoomId: workspaceState.selectedRoomId,
      selectedTeam: workspaceState.selectedTeam,
      roomSettingsByRoom: roomSettingsState.roomSettingsByRoom,
      messagesByRoom: workspaceState.messagesByRoom,
      roomChatByRoom: roomChatState.roomChatByRoom,
      codexRuntimeByRoom: codexRoomState.codexRuntimeByRoom,
      browserByRoom: browserPanelState.browserByRoom,
      gitWorkflowRuntimeByRoom: githubWorkflowPanelState.gitWorkflowRuntimeByRoom,
      terminalRuntimeByRoom: terminalPanelState.terminalRuntimeByRoom,
      filePanelByRoom: filePanelState.filePanelByRoom,
      inviteByRoom: invitePanelState.inviteByRoom,
      historyMessagesByRoom: historyDefaultsState.historyMessagesByRoom,
      teamHistoryMessagesByTeam: historyDefaultsState.teamHistoryMessagesByTeam,
      defaultBrowserUrl,
      defaultBrowserReason
    }
  });
}
