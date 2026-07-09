import type { AppViewModelOptions } from "./appViewModelTypes";
import type { useAppViewProps } from "./useAppViewProps";

type AppSidebarInput = Parameters<typeof useAppViewProps>[0]["appSidebar"];
type AppSidebarOptions = Pick<
  AppViewModelOptions,
  | "appState"
  | "githubAuth"
  | "localIdentity"
  | "theme"
  | "selected"
  | "selectedRuntime"
  | "roomInteraction"
  | "roomActions"
  | "roomDisplay"
  | "roomRuntime"
  | "workspaceFlow"
>;

export function createAppSidebarInput({
  appState,
  githubAuth,
  localIdentity,
  theme,
  selected,
  selectedRuntime,
  roomInteraction,
  roomActions,
  roomDisplay,
  roomRuntime,
  workspaceFlow
}: AppSidebarOptions): AppSidebarInput {
  const { workspaceState, roomSettingsState, historyDefaultsState, appConfigState, appRuntimeState } = appState;
  const {
    selectedRoom,
    hasSelectedRoom,
    selectedCodexModel,
    settingsMessage,
    visibleHistoryMessage
  } = selected;

  return {
    currentUser: githubAuth.currentUser,
    authBusy: githubAuth.authBusy,
    authConfig: githubAuth.authConfig,
    authError: githubAuth.authError,
    deviceFlow: githubAuth.deviceFlow,
    sidebarQuery: workspaceState.sidebarQuery,
    searchActive: roomDisplay.searchActive,
    workspaceError: workspaceState.workspaceError,
    newTeamName: workspaceState.newTeamName,
    newRoomName: workspaceState.newRoomName,
    newRoomProjectPath: workspaceState.newRoomProjectPath,
    selectedTeamId: workspaceState.selectedTeam,
    teams: roomDisplay.sidebarTeamRows,
    rooms: roomDisplay.sidebarRoomRows,
    messageHits: roomDisplay.sidebarMessageHitRows,
    historySearchBusy: appRuntimeState.historySearchBusy,
    activeSidebarPanel: workspaceState.activeSidebarPanel,
    themeMode: theme.themeMode,
    localUserName: localIdentity.localUser.name,
    selectedRoomName: selectedRoom.name,
    deviceId: localIdentity.deviceId,
    deviceIdentity: appRuntimeState.deviceIdentity,
    deviceIdentityMessage: appRuntimeState.deviceIdentityMessage,
    relayStatus: appRuntimeState.relayStatus,
    relayWsUrl: appConfigState.appConfig.relayWsUrl,
    relayHttpUrl: appConfigState.appConfig.relayHttpUrl,
    codexProbe: appRuntimeState.codexProbe,
    projectPath: selectedRoom.projectPath,
    selectedCodexModel,
    selectedRoomApprovalPolicy: selectedRoom.approvalPolicy,
    roomPosture: roomInteraction.roomPosture,
    hasSelectedRoom,
    isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
    settingsBusy: selectedRuntime.settingsBusy,
    isActiveHost: roomInteraction.isActiveHost,
    relayHttpDraft: appConfigState.relayHttpDraft,
    relayWsDraft: appConfigState.relayWsDraft,
    roomSettingsGateMessage: roomInteraction.roomSettingsGateMessage,
    notificationsMuted: roomSettingsState.notificationMutedRoomIds.has(selectedRoom.id),
    historySettings: historyDefaultsState.historySettings,
    teamHistorySettings: historyDefaultsState.teamHistorySettings,
    teamDefaultApprovalPolicy: historyDefaultsState.teamDefaultApprovalPolicy,
    teamDefaultCodexModel: historyDefaultsState.teamDefaultCodexModel,
    teamDefaultBrowserProfilePersistent: historyDefaultsState.teamDefaultBrowserProfilePersistent,
    teamDefaultInviteApprovalGate: historyDefaultsState.teamDefaultInviteApprovalGate,
    appConfigMessage: appConfigState.appConfigMessage,
    roomSettingsMessage: settingsMessage,
    historyMessage: visibleHistoryMessage,
    onSignIn: githubAuth.beginGitHubSignIn,
    onSignOut: roomRuntime.signOut,
    onSidebarQueryChange: workspaceState.setSidebarQuery,
    onNewTeamNameChange: workspaceState.setNewTeamName,
    onCreateTeam: workspaceFlow.addTeam,
    onSelectTeam: workspaceState.setSelectedTeam,
    onNewRoomNameChange: workspaceState.setNewRoomName,
    onNewRoomProjectPathChange: workspaceState.setNewRoomProjectPath,
    onChooseNewRoomProjectPath: workspaceFlow.chooseNewRoomProjectPath,
    onCreateRoom: workspaceFlow.addRoom,
    onSelectRoom: workspaceState.setSelectedRoomId,
    onSetTeamLifecycle: workspaceFlow.setTeamLifecycle,
    onSetRoomLifecycle: workspaceFlow.setRoomLifecycle,
    onSelectSidebarPanel: workspaceState.setActiveSidebarPanel,
    onToggleTheme: theme.toggleThemeMode,
    onRotateDeviceIdentity: roomRuntime.rotateDeviceIdentity,
    onChooseProject: roomRuntime.chooseProjectPath,
    onRelayHttpDraftChange: appConfigState.setRelayHttpDraft,
    onRelayWsDraftChange: appConfigState.setRelayWsDraft,
    onResetRelay: appConfigState.resetRelayConfiguration,
    onSaveRelay: appConfigState.saveRelayConfiguration,
    onNotificationsMutedChange: (muted) => roomActions.setRoomNotificationsMuted(selectedRoom.id, muted),
    onHistorySettingsChange: workspaceFlow.updateLocalHistorySettings,
    onClearRoomHistory: workspaceFlow.clearRoomHistory,
    onForgetRoomLocalData: workspaceFlow.forgetSelectedRoomLocalData,
    onTeamHistoryDefaultsChange: workspaceFlow.updateTeamHistoryDefaults,
    onTeamDefaultApprovalPolicyChange: workspaceFlow.updateTeamDefaultApprovalPolicy,
    onTeamDefaultCodexModelChange: workspaceFlow.updateTeamDefaultCodexModel,
    onTeamDefaultBrowserProfilePersistentChange: historyDefaultsState.setTeamDefaultBrowserProfilePersistent,
    onTeamDefaultInviteApprovalGateChange: workspaceFlow.updateTeamDefaultInviteApprovalGate,
    onApplyTeamDefaultsToRoom: workspaceFlow.applyTeamDefaultsToRoom,
    roomRecords: workspaceState.rooms
  };
}
