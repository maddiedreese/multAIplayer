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
    roomSettingsState,
    historyDefaultsState,
    roomRuntimeState,
    codexRoomState,
    localPreviewState,
    appRuntimeState,
    terminalPanelState,
    browserPanelState,
    githubWorkflowPanelState,
    filePanelState,
    invitePanelState
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
    setPendingAttachmentsForRoom
  } = roomActions;

  return useWorkspaceFlowContext({
    bootstrap: {
      workspace: {
        relayHttpUrl: appConfigState.appConfig.relayHttpUrl,
        setTeams: workspaceState.setTeams,
        setRooms: workspaceState.setRooms,
        setSelectedTeam: workspaceState.setSelectedTeam,
        setSelectedRoomId: workspaceState.setSelectedRoomId,
        setWorkspaceError: workspaceState.setWorkspaceError
      },
      selectedRoomReadReceipt: {
        selectedRoomId: workspaceState.selectedRoomId,
        setRooms: workspaceState.setRooms
      },
      deviceIdentity: {
        relayHttpUrl: appConfigState.appConfig.relayHttpUrl,
        deviceId: localIdentity.deviceId,
        userId: localIdentity.localUser.id,
        displayName: localIdentity.localUser.name,
        deviceIdentity: appRuntimeState.deviceIdentity,
        setDeviceIdentity: appRuntimeState.setDeviceIdentity,
        setDeviceIdentityMessage: appRuntimeState.setDeviceIdentityMessage
      },
      selectedTeamDefaults: {
        selectedTeam: workspaceState.selectedTeam,
        setTeamHistorySettings: historyDefaultsState.setTeamHistorySettings,
        setTeamDefaultApprovalPolicy: historyDefaultsState.setTeamDefaultApprovalPolicy,
        setTeamDefaultCodexModel: historyDefaultsState.setTeamDefaultCodexModel,
        setTeamDefaultBrowserProfilePersistent: historyDefaultsState.setTeamDefaultBrowserProfilePersistent,
        setTeamDefaultInviteApprovalGate: historyDefaultsState.setTeamDefaultInviteApprovalGate
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
        setDeviceIdentityMessage: appRuntimeState.setDeviceIdentityMessage,
        setTrustedDeviceKeys: appRuntimeState.setTrustedDeviceKeys,
        setTeams: workspaceState.setTeams
      },
      workspaceCreation: {
        selectedTeam: workspaceState.selectedTeam,
        newTeamName: workspaceState.newTeamName,
        newRoomName: workspaceState.newRoomName,
        newRoomProjectPath: workspaceState.newRoomProjectPath,
        setWorkspaceError: workspaceState.setWorkspaceError,
        setSelectedTeam: workspaceState.setSelectedTeam,
        setSelectedRoomId: workspaceState.setSelectedRoomId,
        setNewTeamName: workspaceState.setNewTeamName,
        setNewRoomName: workspaceState.setNewRoomName,
        setNewRoomProjectPath: workspaceState.setNewRoomProjectPath,
        setRevokedRoomIds: roomRuntimeState.setRevokedRoomIds,
        setRevokedTeamIds: roomRuntimeState.setRevokedTeamIds,
        setForgottenRoomIds: roomRuntimeState.setForgottenRoomIds,
        setMessagesByRoom: workspaceState.setMessagesByRoom,
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
        selectedCodexThreadId: selectedRuntime.selectedCodexThreadId,
        reportRoomSettingsMutationInFlight: roomInteraction.reportRoomSettingsMutationInFlight,
        roomSettingsActor,
        setSelectedHistoryMessage,
        setHistoryMessageForRoom,
        setInviteApprovalGateForRoom,
        setSettingsBusyForRoom,
        setSecretWarningVisibleForRoom,
        setHistorySettings: historyDefaultsState.setHistorySettings,
        setMessagesByRoom: workspaceState.setMessagesByRoom,
        setTerminalRequestsByRoom: terminalPanelState.setTerminalRequestsByRoom,
        setBrowserRequestsByRoom: browserPanelState.setBrowserRequestsByRoom,
        setInviteRequestsByRoom: invitePanelState.setInviteRequestsByRoom,
        setCodexEventsByRoom: codexRoomState.setCodexEventsByRoom,
        setGitWorkflowEventsByRoom: roomRuntimeState.setGitWorkflowEventsByRoom,
        setGitHubActionsEventsByRoom: roomRuntimeState.setGitHubActionsEventsByRoom,
        setLocalPreviewsByRoom: localPreviewState.setLocalPreviewsByRoom,
        setTerminals: terminalPanelState.setTerminals,
        setHostHandoffsByRoom: roomRuntimeState.setHostHandoffsByRoom,
        setRooms: workspaceState.setRooms,
        setBrowserStatusByRoom: browserPanelState.setBrowserStatusByRoom,
        setActiveBrowserUrlsByRoom: browserPanelState.setActiveBrowserUrlsByRoom,
        setForgottenRoomIds: roomRuntimeState.setForgottenRoomIds,
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
        setPendingAttachmentsForRoom,
        setInspectorTabsByRoom: roomRuntimeState.setInspectorTabsByRoom
      }
    },
    historyEffects: {
      hydration: {
        hasSelectedRoom,
        selectedRoomId: workspaceState.selectedRoomId,
        selectedRoomTeamId: selectedRoom.teamId,
        forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
        historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
        setHistorySettings: historyDefaultsState.setHistorySettings,
        setMessagesByRoom: workspaceState.setMessagesByRoom,
        setTerminalRequestsByRoom: terminalPanelState.setTerminalRequestsByRoom,
        setBrowserRequestsByRoom: browserPanelState.setBrowserRequestsByRoom,
        setInviteRequestsByRoom: invitePanelState.setInviteRequestsByRoom,
        setCodexEventsByRoom: codexRoomState.setCodexEventsByRoom,
        setGitWorkflowEventsByRoom: roomRuntimeState.setGitWorkflowEventsByRoom,
        setGitHubActionsEventsByRoom: roomRuntimeState.setGitHubActionsEventsByRoom,
        setLocalPreviewsByRoom: localPreviewState.setLocalPreviewsByRoom,
        setGitWorkflowMessageForRoom,
        setActionRunsByRoom: githubWorkflowPanelState.setActionRunsByRoom,
        setActionsLastCheckedByRoom: githubWorkflowPanelState.setActionsLastCheckedByRoom,
        setActionsMessagesByRoom: githubWorkflowPanelState.setActionsMessagesByRoom,
        setTerminals: terminalPanelState.setTerminals,
        setSelectedTerminalIdsByRoom: terminalPanelState.setSelectedTerminalIdsByRoom,
        setHostHandoffsByRoom: roomRuntimeState.setHostHandoffsByRoom,
        setCodexThreadIdsByRoom: codexRoomState.setCodexThreadIdsByRoom
      },
      search: {
        searchActive: roomDisplay.searchActive,
        rooms: workspaceState.rooms,
        forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
        revokedRoomIds: roomRuntimeState.revokedRoomIds,
        revokedTeamIds: roomRuntimeState.revokedTeamIds,
        setHistorySearchBusy: appRuntimeState.setHistorySearchBusy
      }
    }
  });
}
