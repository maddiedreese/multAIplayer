import {
  approvalPolicyLabels
} from "../seedData";
import type { useAppInviteActions } from "./useAppInviteActions";
import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomDisplayContext } from "./useAppRoomDisplayContext";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppRoomActions } from "./useAppRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useAppWorkspaceRecords } from "./useAppWorkspaceRecords";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";
import type { useRoomSettingsActor } from "./useRoomSettingsActor";
import { useWorkspaceFlowContext } from "./useWorkspaceFlowContext";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof useAppRoomActions>;
type WorkspaceRecords = ReturnType<typeof useAppWorkspaceRecords>;
type InviteActions = ReturnType<typeof useAppInviteActions>;
type RoomDisplay = ReturnType<typeof useAppRoomDisplayContext>;
type RoomSettingsActor = ReturnType<typeof useRoomSettingsActor>;

export function useAppWorkspaceFlow({
  appState,
  appRefs,
  githubAuth,
  localIdentity,
  selected,
  selectedRuntime,
  roomInteraction,
  roomActions,
  workspaceRecords,
  inviteActions,
  roomDisplay,
  roomSettingsActor
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  githubAuth: GitHubAuth;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  roomInteraction: RoomInteraction;
  roomActions: RoomActions;
  workspaceRecords: WorkspaceRecords;
  inviteActions: InviteActions;
  roomDisplay: RoomDisplay;
  roomSettingsActor: RoomSettingsActor;
}) {
  const {
    workspaceState,
    appConfigState,
    roomChatState,
    historyDefaultsState,
    roomRuntimeState,
    appRuntimeState,
    terminalPanelState,
    filePanelState
  } = appState;
  const {
    hasSelectedRoom,
    selectedRoom,
    selectedTeamName,
    selectedTeamMembersBusy,
    messages,
    selectedMessages,
    browserRequests,
    gitStatus,
    selectedFile,
    selectedDiff,
    terminalLines
  } = selected;
  const {
    setSelectedInviteMessage,
    setMarkdownCopyFallbackForRoom,
    setSelectedChatMessage,
    setChatMessageForRoom,
    setSelectedFileMessage,
    setFileMessageForRoom,
    setSelectedTerminalError,
    setTerminalErrorForRoom,
    setSelectedGitWorkflowMessage,
    setGitWorkflowMessageForRoom,
    setInviteApprovalGateForRoom,
    setSelectedTeamHistoryMessage,
    setTeamHistoryMessageForTeam,
    setSelectedHistoryMessage,
    setHistoryMessageForRoom,
    setSettingsBusyForRoom,
    setSecretWarningVisibleForRoom,
    setFileBusyForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom,
    setFilePreviewTabForRoom,
    appendPendingAttachmentForRoom,
    removePendingAttachmentForRoom,
    hydrateLocalRoomHistoryForRoom,
    clearBrowserStatusForRoom
  } = roomActions;

  return useWorkspaceFlowContext({
    bootstrap: {
      workspace: {
        relayHttpUrl: appConfigState.appConfig.relayHttpUrl,
        replaceTeams: workspaceState.replaceTeams,
        replaceRooms: workspaceState.replaceRooms,
        selectExistingTeamOrFirst: workspaceState.selectExistingTeamOrFirst,
        selectExistingRoomOrFirst: workspaceState.selectExistingRoomOrFirst,
        setWorkspaceStatusError: workspaceState.setWorkspaceStatusError
      },
      selectedRoomReadReceipt: {
        selectedRoomId: workspaceState.selectedRoomId,
        markRoomRead: workspaceRecords.markRoomRead
      },
      deviceIdentity: {
        relayHttpUrl: appConfigState.appConfig.relayHttpUrl,
        deviceId: localIdentity.deviceId,
        userId: localIdentity.localUser.id,
        displayName: localIdentity.localUser.name,
        deviceIdentity: appRuntimeState.deviceIdentity,
        replaceDeviceIdentity: appRuntimeState.replaceDeviceIdentity,
        setDeviceIdentityStatusMessage: appRuntimeState.setDeviceIdentityStatusMessage
      },
      selectedTeamDefaults: {
        selectedTeam: workspaceState.selectedTeam,
        replaceTeamHistorySettings: historyDefaultsState.replaceTeamHistorySettings,
        replaceTeamDefaultApprovalPolicy: historyDefaultsState.replaceTeamDefaultApprovalPolicy,
        replaceTeamDefaultCodexModel: historyDefaultsState.replaceTeamDefaultCodexModel,
        replaceTeamDefaultBrowserProfilePersistent: historyDefaultsState.replaceTeamDefaultBrowserProfilePersistent,
        replaceTeamDefaultInviteApprovalGate: historyDefaultsState.replaceTeamDefaultInviteApprovalGate
      },
      inviteUrl: {
        requestNoSecretInviteAccess: inviteActions.requestNoSecretInviteAccess,
        acceptInvite: inviteActions.acceptInvite,
        setSelectedInviteMessage
      }
    },
    markdownCopy: {
      hasSelectedRoom,
      canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
      localWorkspaceMessage: roomInteraction.localWorkspaceMessage,
      selectedRoom,
      teams: workspaceState.teams,
      messages,
      selectedMessages,
      gitStatus,
      selectedFile,
      selectedDiff,
      selectedFileRisks: roomDisplay.selectedFileRisks,
      selectedTerminal: selectedRuntime.selectedTerminal,
      terminalLines,
      terminalRisks: roomDisplay.terminalRisks,
      setMarkdownCopyFallbackForRoom,
      setSelectedChatMessage,
      setChatMessageForRoom,
      setSelectedFileMessage,
      setFileMessageForRoom,
      setSelectedTerminalError,
      setTerminalErrorForRoom,
      setSelectedGitWorkflowMessage,
      setGitWorkflowMessageForRoom
    },
    workspaceRoomActions: {
      members: {
        selectedTeam: workspaceState.selectedTeam,
        selectedTeamName,
        selectedTeamMembersBusy,
        selectedRoom,
        localUser: localIdentity.localUser,
        currentUser: githubAuth.currentUser,
        setDeviceIdentityMessage: appRuntimeState.setDeviceIdentityStatusMessage,
        trustDeviceForRoom: appRuntimeState.trustDeviceForRoom,
        untrustDeviceForRoom: appRuntimeState.untrustDeviceForRoom,
        updateTeamRoleForTeam: workspaceState.updateTeamRoleForTeam,
        updateTeamMemberCountForTeam: workspaceState.updateTeamMemberCountForTeam
      },
      workspaceCreation: {
        selectedTeam: workspaceState.selectedTeam,
        newTeamName: workspaceState.newTeamName,
        newRoomName: workspaceState.newRoomName,
        newRoomProjectPath: workspaceState.newRoomProjectPath,
        setWorkspaceStatusError: workspaceState.setWorkspaceStatusError,
        setSelectedTeam: workspaceState.setSelectedTeam,
        setSelectedRoomId: workspaceState.setSelectedRoomId,
        setNewTeamName: workspaceState.setNewTeamName,
        setNewRoomName: workspaceState.setNewRoomName,
        setNewRoomProjectPath: workspaceState.setNewRoomProjectPath,
        restoreRoomAccess: roomRuntimeState.restoreRoomAccess,
        restoreTeamAccess: roomRuntimeState.restoreTeamAccess,
        restoreForgottenRoom: roomRuntimeState.restoreForgottenRoom,
        setInviteApprovalGateForRoom,
        upsertTeam: workspaceRecords.upsertTeam,
        upsertRoom: workspaceRecords.upsertRoom
      },
      teamDefaults: {
        selectedTeam: workspaceState.selectedTeam,
        approvalPolicyLabels,
        setSelectedTeamHistoryMessage,
        setTeamHistoryMessageForTeam,
        setTeamHistorySettings: historyDefaultsState.setTeamHistorySettings,
        setTeamDefaultApprovalPolicy: historyDefaultsState.setTeamDefaultApprovalPolicy,
        setTeamDefaultCodexModel: historyDefaultsState.setTeamDefaultCodexModel,
        setTeamDefaultBrowserProfilePersistent: historyDefaultsState.setTeamDefaultBrowserProfilePersistent,
        setTeamDefaultInviteApprovalGate: historyDefaultsState.setTeamDefaultInviteApprovalGate
      },
      localHistory: {
        hasSelectedRoom,
        selectedRoom,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
        isSelectedRoomRevoked: roomInteraction.isSelectedRoomRevoked,
        isActiveHost: roomInteraction.isActiveHost,
        messages,
        terminalRequests: selectedRuntime.terminalRequests,
        browserRequests,
        inviteRequests: selectedRuntime.inviteRequests,
        codexEvents: selectedRuntime.codexEvents,
        gitWorkflowEvents: selectedRuntime.gitWorkflowEvents,
        githubActionsEvents: selectedRuntime.githubActionsEvents,
        localPreviews: selectedRuntime.localPreviews,
        terminals: terminalPanelState.terminals,
        hostHandoffs: selectedRuntime.hostHandoffs,
        roomGoal: selected.roomGoal,
        selectedCodexThreadId: selectedRuntime.selectedCodexThreadId,
        reportRoomSettingsMutationInFlight: roomInteraction.reportRoomSettingsMutationInFlight,
        roomSettingsActor,
        setSelectedHistoryMessage,
        setHistoryMessageForRoom,
        setInviteApprovalGateForRoom,
        setSettingsBusyForRoom,
        setSecretWarningVisibleForRoom,
        replaceHistorySettings: historyDefaultsState.replaceHistorySettings,
        hydrateLocalRoomHistoryForRoom,
        replaceRoom: workspaceRecords.replaceRoom,
        clearBrowserStatusForRoom,
        rememberForgottenRoom: roomRuntimeState.rememberForgottenRoom,
        historyLoadedRoomIds: appRefs.historyLoadedRoomIds
      },
      files: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        localWorkspaceMessage: roomInteraction.localWorkspaceMessage,
        selectedRoom,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
        isSelectedRoomRevoked: roomInteraction.isSelectedRoomRevoked,
        selectedFile,
        pendingAttachmentsByRoom: roomChatState.pendingAttachmentsByRoom,
        sensitiveAttachmentReviewKey: roomChatState.sensitiveAttachmentReviewKey,
        setSensitiveAttachmentReviewKey: roomChatState.setSensitiveAttachmentReviewKey,
        reportRoomFileActionInFlight: roomInteraction.reportRoomFileActionInFlight,
        setFileBusyForRoom,
        setSelectedFileForRoom,
        setSelectedDiffForRoom,
        setFilePreviewTabForRoom,
        setSelectedFileMessage,
        setFileMessageForRoom,
        appendPendingAttachmentForRoom,
        removePendingAttachmentForRoom
      }
    },
    historyEffects: {
      hydration: {
        hasSelectedRoom,
        selectedRoomId: workspaceState.selectedRoomId,
        selectedRoomTeamId: selectedRoom.teamId,
        forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
        historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
        replaceHistorySettings: historyDefaultsState.replaceHistorySettings,
        hydrateLocalRoomHistoryForRoom,
        hydrateRoomReadState: workspaceState.hydrateRoomReadState
      },
      search: {
        searchActive: roomDisplay.searchActive,
        rooms: workspaceState.rooms,
        forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
        revokedRoomIds: roomRuntimeState.revokedRoomIds,
        revokedTeamIds: roomRuntimeState.revokedTeamIds,
        startHistorySearch: appRuntimeState.startHistorySearch,
        finishHistorySearch: appRuntimeState.finishHistorySearch
      }
    }
  });
}
