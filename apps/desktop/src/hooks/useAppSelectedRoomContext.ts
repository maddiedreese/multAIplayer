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
      customCodexModelsByRoom: roomSettingsState.customCodexModelsByRoom,
      projectPathDraftsByRoom: roomSettingsState.projectPathDraftsByRoom,
      messagesByRoom: workspaceState.messagesByRoom,
      draftsByRoom: roomChatState.draftsByRoom,
      pendingAttachmentsByRoom: roomChatState.pendingAttachmentsByRoom,
      roomGoalsByRoom: codexRoomState.roomGoalsByRoom,
      browserRequestsByRoom: browserPanelState.browserRequestsByRoom,
      browserUrlsByRoom: browserPanelState.browserUrlsByRoom,
      browserReasonsByRoom: browserPanelState.browserReasonsByRoom,
      activeBrowserUrlsByRoom: browserPanelState.activeBrowserUrlsByRoom,
      gitStatusByRoom: githubWorkflowPanelState.gitStatusByRoom,
      gitWorkflowDraftsByRoom: githubWorkflowPanelState.gitWorkflowDraftsByRoom,
      gitWorkflowBusyByRoom: githubWorkflowPanelState.gitWorkflowBusyByRoom,
      gitWorkflowMessagesByRoom: githubWorkflowPanelState.gitWorkflowMessagesByRoom,
      actionRunsByRoom: githubWorkflowPanelState.actionRunsByRoom,
      actionsBusyByRoom: githubWorkflowPanelState.actionsBusyByRoom,
      actionsLastCheckedByRoom: githubWorkflowPanelState.actionsLastCheckedByRoom,
      actionsMessagesByRoom: githubWorkflowPanelState.actionsMessagesByRoom,
      terminalLinesByRoom: terminalPanelState.terminalLinesByRoom,
      terminalBusyByRoom: terminalPanelState.terminalBusyByRoom,
      selectedTerminalIdsByRoom: terminalPanelState.selectedTerminalIdsByRoom,
      terminalNamesByRoom: terminalPanelState.terminalNamesByRoom,
      terminalCommandsByRoom: terminalPanelState.terminalCommandsByRoom,
      terminalInputsByRoom: terminalPanelState.terminalInputsByRoom,
      terminalErrorsByRoom: terminalPanelState.terminalErrorsByRoom,
      fileQueriesByRoom: filePanelState.fileQueriesByRoom,
      projectFilesByRoom: filePanelState.projectFilesByRoom,
      selectedFilesByRoom: filePanelState.selectedFilesByRoom,
      selectedDiffsByRoom: filePanelState.selectedDiffsByRoom,
      filePreviewTabsByRoom: filePanelState.filePreviewTabsByRoom,
      fileBusyByRoom: filePanelState.fileBusyByRoom,
      fileMessagesByRoom: filePanelState.fileMessagesByRoom,
      inviteLinksByRoom: invitePanelState.inviteLinksByRoom,
      inviteApprovalGatesByRoom: invitePanelState.inviteApprovalGatesByRoom,
      inviteMessagesByRoom: invitePanelState.inviteMessagesByRoom,
      hostMessagesByRoom: roomSettingsState.hostMessagesByRoom,
      chatMessagesByRoom: roomChatState.chatMessagesByRoom,
      settingsMessagesByRoom: roomSettingsState.settingsMessagesByRoom,
      historyMessagesByRoom: historyDefaultsState.historyMessagesByRoom,
      teamHistoryMessagesByTeam: historyDefaultsState.teamHistoryMessagesByTeam,
      markdownCopyFallbacksByRoom: filePanelState.markdownCopyFallbacksByRoom,
      defaultBrowserUrl,
      defaultBrowserReason
    }
  });
}
