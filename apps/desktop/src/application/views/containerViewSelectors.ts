import type { AppStoreState } from "../../store/appStore";
import type { BrowserRoomState } from "../../store/slices/browserSlice";
import type { CodexRuntimeRoomState } from "../../store/slices/codexHostHandoffSlice";
import type { FilePanelRoomState } from "../../store/slices/filePanelSlice";
import type { GitWorkflowRuntimeRoomState } from "../../store/slices/gitWorkflowSlice";
import type { InviteRoomState } from "../../store/slices/inviteSlice";
import type { RoomSettingsRoomState } from "../../store/slices/roomSettingsSlice";
import type { TerminalRoomState } from "../../store/slices/terminalSlice";

const emptyBrowser: BrowserRoomState = {};
const emptyCodexRuntime: CodexRuntimeRoomState = {};
const emptyFilePanel: FilePanelRoomState = {};
const emptyGitRuntime: GitWorkflowRuntimeRoomState = {};
const emptyInvite: InviteRoomState = {};
const emptyRoomSettings: RoomSettingsRoomState = {};
const emptyTerminal: TerminalRoomState = {};
const noMessages: NonNullable<AppStoreState["messagesByRoom"][string]> = [];
const noBrowserRequests: NonNullable<NonNullable<AppStoreState["browserByRoom"][string]>["requests"]> = [];
const noPreviews: NonNullable<NonNullable<AppStoreState["localPreviewByRoom"][string]>["previews"]> = [];

function selectedRoomValue<T>(roomId: string | null, values: Record<string, T>): T | undefined {
  if (!roomId) return undefined;
  return values[roomId];
}

export function selectRoomInspectorView(state: AppStoreState) {
  const selectedRoom = state.rooms.find((room) => room.id === state.selectedRoomId) ?? null;
  const roomId = selectedRoom?.id ?? null;
  const selectedTeamId = state.selectedTeam;
  const presenceState = selectedRoomValue(roomId, state.historyPresenceByRoom);
  const {
    presence,
    inspectorTab = "files",
    historyMessage = null,
    historyHydrationStatus = null
  } = presenceState ?? {};
  return {
    currentUser: state.currentUser,
    authConfig: state.authConfig,
    selectedRoom,
    hasSelectedRoom: selectedRoom != null,
    selectedTeamId,
    selectedTeam: state.teams.find((team) => team.id === selectedTeamId) ?? null,
    browser: selectedRoomValue(roomId, state.browserByRoom) ?? emptyBrowser,
    codexRuntime: selectedRoomValue(roomId, state.codexRuntimeByRoom) ?? emptyCodexRuntime,
    filePanel: selectedRoomValue(roomId, state.filePanelByRoom) ?? emptyFilePanel,
    gitRuntime: selectedRoomValue(roomId, state.gitWorkflowRuntimeByRoom) ?? emptyGitRuntime,
    invite: selectedRoomValue(roomId, state.inviteByRoom) ?? emptyInvite,
    roomSettings: selectedRoomValue(roomId, state.roomSettingsByRoom) ?? emptyRoomSettings,
    terminal: selectedRoomValue(roomId, state.terminalRuntimeByRoom) ?? emptyTerminal,
    terminals: state.terminals,
    teamRoster: state.teamRosterByTeam[selectedTeamId],
    presence,
    inspectorTab,
    historyMessage,
    historyHydrationStatus,
    teamHistoryMessage: state.teamHistoryByTeam[selectedTeamId || "__no-team"]?.message ?? null,
    sensitiveAttachmentReviewKey: state.sensitiveAttachmentReviewKey,
    deviceIdentity: state.deviceIdentity,
    deviceIdentityMessage: state.deviceIdentityMessage,
    trustedDeviceKeys: state.trustedDeviceKeys,
    forgottenRoomIds: state.forgottenRoomIds,
    revokedRoomIds: state.revokedRoomIds,
    revokedTeamIds: state.revokedTeamIds,
    historySettings: state.historySettings,
    teamHistorySettings: state.teamHistorySettings,
    teamDefaultApprovalPolicy: state.teamDefaultApprovalPolicy,
    teamDefaultCodexModel: state.teamDefaultCodexModel,
    teamDefaultBrowserProfilePersistent: state.teamDefaultBrowserProfilePersistent,
    teamDefaultInviteApprovalGate: state.teamDefaultInviteApprovalGate,
    codexProbe: state.codexProbe,
    inviteSecretInput: state.inviteSecretInput
  };
}

export function selectRoomMainColumnView(state: AppStoreState) {
  const selectedRoom = state.rooms.find((room) => room.id === state.selectedRoomId) ?? null;
  const roomId = selectedRoom?.id ?? null;
  return {
    teams: state.teams,
    selectedTeam: state.selectedTeam,
    selectedRoomId: state.selectedRoomId,
    selectedRoom,
    hasSelectedRoom: selectedRoom != null,
    messages: selectedRoomValue(roomId, state.messagesByRoom) ?? noMessages,
    chat: selectedRoomValue(roomId, state.roomChatByRoom),
    settings: selectedRoomValue(roomId, state.roomSettingsByRoom),
    codex: selectedRoomValue(roomId, state.codexRuntimeByRoom),
    previews: selectedRoomValue(roomId, state.localPreviewByRoom)?.previews ?? noPreviews,
    fallback: selectedRoomValue(roomId, state.filePanelByRoom)?.markdownCopyFallback ?? null,
    inspectorTab: selectedRoomValue(roomId, state.historyPresenceByRoom)?.inspectorTab ?? "files",
    forgotten: roomId ? state.forgottenRoomIds.has(roomId) : false,
    revoked: selectedRoom
      ? state.revokedRoomIds.has(selectedRoom.id) || state.revokedTeamIds.has(selectedRoom.teamId)
      : false,
    codexProbe: state.codexProbe,
    currentUser: state.currentUser,
    browserRequests: selectedRoomValue(roomId, state.browserByRoom)?.requests ?? noBrowserRequests
  };
}

export function selectSidebarNavigationView(state: AppStoreState) {
  return {
    currentUser: state.currentUser,
    authBusy: state.authBusy,
    authConfig: state.authConfig,
    authError: state.authError,
    deviceFlow: state.deviceFlow,
    sidebarQuery: state.sidebarQuery,
    workspaceError: state.workspaceError,
    newTeamName: state.newTeamName,
    newRoomName: state.newRoomName,
    newRoomProjectPath: state.newRoomProjectPath,
    selectedTeam: state.selectedTeam,
    selectedRoomId: state.selectedRoomId,
    teams: state.teams,
    rooms: state.rooms,
    messagesByRoom: state.messagesByRoom,
    historyPresenceByRoom: state.historyPresenceByRoom,
    codexRuntimeByRoom: state.codexRuntimeByRoom,
    terminalRuntimeByRoom: state.terminalRuntimeByRoom,
    browserByRoom: state.browserByRoom,
    forgottenRoomIds: state.forgottenRoomIds,
    revokedRoomIds: state.revokedRoomIds,
    revokedTeamIds: state.revokedTeamIds,
    historySearchBusy: state.historySearchBusy,
    activeSidebarPanel: state.activeSidebarPanel,
    setSidebarQuery: state.setSidebarQuery,
    setNewTeamName: state.setNewTeamName,
    setNewRoomName: state.setNewRoomName,
    setNewRoomProjectPath: state.setNewRoomProjectPath,
    selectTeamRoom: state.selectTeamRoom,
    selectWorkspaceRoom: state.selectWorkspaceRoom,
    setSelectedRoomId: state.setSelectedRoomId,
    setActiveSidebarPanel: state.setActiveSidebarPanel
  };
}

export function selectSidebarDrawerView(state: AppStoreState) {
  const selectedRoom = state.rooms.find((room) => room.id === state.selectedRoomId) ?? null;
  const roomId = selectedRoom?.id ?? null;
  return {
    currentUser: state.currentUser,
    authBusy: state.authBusy,
    authConfig: state.authConfig,
    authError: state.authError,
    deviceFlow: state.deviceFlow,
    selectedTeam: state.selectedTeam,
    selectedRoom,
    hasSelectedRoom: selectedRoom != null,
    activeSidebarPanel: state.activeSidebarPanel,
    appConfig: state.appConfig,
    relayHttpDraft: state.relayHttpDraft,
    relayWsDraft: state.relayWsDraft,
    appConfigMessage: state.appConfigMessage,
    relayStatus: state.relayStatus,
    codexProbe: state.codexProbe,
    deviceIdentity: state.deviceIdentity,
    deviceIdentityMessage: state.deviceIdentityMessage,
    forgottenRoomIds: state.forgottenRoomIds,
    revokedRoomIds: state.revokedRoomIds,
    revokedTeamIds: state.revokedTeamIds,
    roomSettings: selectedRoomValue(roomId, state.roomSettingsByRoom) ?? emptyRoomSettings,
    inviteApprovalGate: selectedRoomValue(roomId, state.inviteByRoom)?.approvalGate ?? true,
    historySettings: state.historySettings,
    teamHistorySettings: state.teamHistorySettings,
    teamDefaultApprovalPolicy: state.teamDefaultApprovalPolicy,
    teamDefaultCodexModel: state.teamDefaultCodexModel,
    teamDefaultBrowserProfilePersistent: state.teamDefaultBrowserProfilePersistent,
    teamDefaultInviteApprovalGate: state.teamDefaultInviteApprovalGate,
    historyMessage: selectedRoomValue(roomId, state.historyPresenceByRoom)?.historyMessage ?? null,
    teamHistoryMessage: state.teamHistoryByTeam[state.selectedTeam || "__no-team"]?.message ?? null,
    setActiveSidebarPanel: state.setActiveSidebarPanel,
    setRelayHttpDraft: state.setRelayHttpDraft,
    setRelayWsDraft: state.setRelayWsDraft,
    resetRelayConfiguration: state.resetRelayConfiguration,
    saveRelayConfiguration: state.saveRelayConfiguration,
    setRoomNotificationsMuted: state.setRoomNotificationsMuted,
    setTeamDefaultBrowserProfilePersistent: state.setTeamDefaultBrowserProfilePersistent
  };
}
