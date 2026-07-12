import { emptyRoom } from "../appDefaults";
import type { AppStoreState } from "../store/appStore";
import type { BrowserRoomState } from "../store/slices/browserSlice";
import type { CodexRuntimeRoomState } from "../store/slices/codexHostHandoffSlice";
import type { FilePanelRoomState } from "../store/slices/filePanelSlice";
import type { GitWorkflowRuntimeRoomState } from "../store/slices/gitWorkflowSlice";
import type { InviteRoomState } from "../store/slices/inviteSlice";
import type { RoomSettingsRoomState } from "../store/slices/roomSettingsSlice";
import type { TerminalRoomState } from "../store/slices/terminalSlice";

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

export function selectRoomInspectorView(state: AppStoreState) {
  const selectedRoom = state.rooms.find((room) => room.id === state.selectedRoomId) ?? state.rooms[0] ?? emptyRoom;
  const selectedTeamId = state.selectedTeam;
  const presenceState = state.historyPresenceByRoom[selectedRoom.id];
  return {
    currentUser: state.currentUser,
    authConfig: state.authConfig,
    selectedRoom,
    hasSelectedRoom: state.rooms.some((room) => room.id === state.selectedRoomId),
    selectedTeamId,
    selectedTeam: state.teams.find((team) => team.id === selectedTeamId) ?? null,
    browser: state.browserByRoom[selectedRoom.id] ?? emptyBrowser,
    codexRuntime: state.codexRuntimeByRoom[selectedRoom.id] ?? emptyCodexRuntime,
    filePanel: state.filePanelByRoom[selectedRoom.id] ?? emptyFilePanel,
    gitRuntime: state.gitWorkflowRuntimeByRoom[selectedRoom.id] ?? emptyGitRuntime,
    invite: state.inviteByRoom[selectedRoom.id] ?? emptyInvite,
    roomSettings: state.roomSettingsByRoom[selectedRoom.id] ?? emptyRoomSettings,
    terminal: state.terminalRuntimeByRoom[selectedRoom.id] ?? emptyTerminal,
    terminals: state.terminals,
    teamRoster: state.teamRosterByTeam[selectedTeamId],
    presence: presenceState?.presence,
    inspectorTab: presenceState?.inspectorTab ?? "files",
    historyMessage: presenceState?.historyMessage ?? null,
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
  const selectedRoom = state.rooms.find((room) => room.id === state.selectedRoomId) ?? state.rooms[0] ?? emptyRoom;
  const roomId = selectedRoom.id;
  return {
    teams: state.teams,
    selectedTeam: state.selectedTeam,
    selectedRoomId: state.selectedRoomId,
    selectedRoom,
    hasSelectedRoom: state.rooms.some((room) => room.id === state.selectedRoomId),
    messages: state.messagesByRoom[roomId] ?? noMessages,
    chat: state.roomChatByRoom[roomId],
    settings: state.roomSettingsByRoom[roomId],
    codex: state.codexRuntimeByRoom[roomId],
    previews: state.localPreviewByRoom[roomId]?.previews ?? noPreviews,
    fallback: state.filePanelByRoom[roomId]?.markdownCopyFallback ?? null,
    inspectorTab: state.historyPresenceByRoom[roomId]?.inspectorTab ?? "files",
    forgotten: state.forgottenRoomIds.has(roomId),
    revoked: state.revokedRoomIds.has(roomId) || state.revokedTeamIds.has(selectedRoom.teamId),
    codexProbe: state.codexProbe,
    currentUser: state.currentUser,
    browserRequests: state.browserByRoom[roomId]?.requests ?? noBrowserRequests
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
  const selectedRoom = state.rooms.find((room) => room.id === state.selectedRoomId) ?? state.rooms[0] ?? emptyRoom;
  return {
    currentUser: state.currentUser,
    authBusy: state.authBusy,
    authConfig: state.authConfig,
    authError: state.authError,
    deviceFlow: state.deviceFlow,
    selectedTeam: state.selectedTeam,
    selectedRoom,
    hasSelectedRoom: state.rooms.some((room) => room.id === state.selectedRoomId),
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
    roomSettings: state.roomSettingsByRoom[selectedRoom.id] ?? emptyRoomSettings,
    inviteApprovalGate: state.inviteByRoom[selectedRoom.id]?.approvalGate ?? true,
    historySettings: state.historySettings,
    teamHistorySettings: state.teamHistorySettings,
    teamDefaultApprovalPolicy: state.teamDefaultApprovalPolicy,
    teamDefaultCodexModel: state.teamDefaultCodexModel,
    teamDefaultBrowserProfilePersistent: state.teamDefaultBrowserProfilePersistent,
    teamDefaultInviteApprovalGate: state.teamDefaultInviteApprovalGate,
    historyMessage: state.historyPresenceByRoom[selectedRoom.id]?.historyMessage ?? null,
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
