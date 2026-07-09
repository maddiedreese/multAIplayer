import { useEffect } from "react";
import { approvalPolicyLabels } from "../seedData";
import type { useAppHostHandoffActions } from "./useAppHostHandoffActions";
import type { useAppRefs } from "./useAppRefs";
import type { useAppRelaySync } from "./useAppRelaySync";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppRoomActions } from "./useAppRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useAppWorkspaceRecords } from "./useAppWorkspaceRecords";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useRoomRuntimeContext } from "./useRoomRuntimeContext";
import type { useRoomSettingsActor } from "./useRoomSettingsActor";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof useAppRoomActions>;
type RelaySync = ReturnType<typeof useAppRelaySync>;
type HostHandoffActions = ReturnType<typeof useAppHostHandoffActions>;
type WorkspaceRecords = ReturnType<typeof useAppWorkspaceRecords>;
type RoomSettingsActor = ReturnType<typeof useRoomSettingsActor>;

export function useAppRoomRuntime({
  appState,
  appRefs,
  githubAuth,
  localIdentity,
  selected,
  selectedRuntime,
  roomInteraction,
  roomActions,
  relaySync,
  hostHandoffActions,
  workspaceRecords,
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
  relaySync: RelaySync;
  hostHandoffActions: HostHandoffActions;
  workspaceRecords: WorkspaceRecords;
  roomSettingsActor: RoomSettingsActor;
}) {
  const {
    workspaceState,
    roomSettingsState,
    historyDefaultsState,
    roomRuntimeState,
    codexRoomState,
    localPreviewState,
    appRuntimeState,
    terminalPanelState,
    browserPanelState,
    githubWorkflowPanelState,
    filePanelState
  } = appState;
  const {
    selectedCodexModel,
    selectedCodexReasoningEffort,
    selectedCodexSpeed,
    selectedCodexSandboxLevel,
    hasSelectedRoom,
    selectedRoom,
    inspectorTab,
    roomTerminals,
    projectPathDraft,
    messages,
    replyToMessageId,
    draft,
    roomGoal,
    pendingAttachments,
    browserRequests,
    fileSaveRequests,
    browserUrl,
    browserReason,
    gitStatus,
    gitWorkflowDraft,
    fileQuery,
    terminalBusy,
    selectedTerminalId
  } = selected;
  const {
    setHostMessageForRoom,
    setSelectedHostMessage,
    setChatMessageForRoom,
    setSelectedChatMessage,
    setSelectedSettingsMessage,
    setSettingsMessageForRoom,
    setGitWorkflowBusyForRoom,
    setActionsBusyForRoom,
    setLocalPreviewBusyForRoom,
    setFileBusyForRoom,
    setProjectFilesForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom,
    setFileMessageForRoom,
    resetFileContextForRoom,
    setSelectedTerminalIdForRoom,
    setTerminalErrorForRoom,
    setSelectedTerminalError,
    appendTerminalLinesForRoom,
    setApprovalVisibleForRoom,
    setPendingCodexApprovalForRoom,
    resetCodexApprovalForRoom,
    setCodexRunningForRoom,
    setRoomGoalForRoom,
    setBrowserUrlForRoom,
    setBrowserMessageForRoom,
    setSelectedBrowserMessage,
    clearPendingAttachmentsForRoom,
    setDraftForRoom,
    setProjectPathDraftForRoom,
    setGitWorkflowMessageForRoom,
    setSelectedGitWorkflowMessage,
    setGitStatusForRoom,
    appendTerminalRequest,
    updateTerminalRequestStatus,
    appendBrowserRequest,
    updateBrowserRequestStatus
  } = roomActions;

  const runtime = useRoomRuntimeContext({
    codexActions: {
      turn: {
        selectedRoom,
        activeCodexApproval: selectedRuntime.activeCodexApproval,
        roomsRef: appRefs.roomsRef,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
        revokedRoomIds: roomRuntimeState.revokedRoomIds,
        revokedTeamIds: roomRuntimeState.revokedTeamIds,
        localUser: localIdentity.localUser,
        messagesByRoom: workspaceState.messagesByRoom,
        terminals: terminalPanelState.terminals,
        browserRequestsByRoom: browserPanelState.browserRequestsByRoom,
        gitStatusByRoom: githubWorkflowPanelState.gitStatusByRoom,
        codexContinuationByRoom: roomRuntimeState.codexContinuationByRoom,
        codexThreadIdsByRoom: codexRoomState.codexThreadIdsByRoom,
        queuedCodexApprovalsByRoom: codexRoomState.queuedCodexApprovalsByRoom,
        setHostMessageForRoom,
        setPendingCodexApprovalForRoom,
        setApprovalVisibleForRoom,
        removeQueuedCodexApprovalForRoom: roomActions.removeQueuedCodexApprovalForRoom,
        setCodexRunningForRoom,
        appendTerminalLinesForRoom,
        replaceRoom: workspaceRecords.replaceRoom,
        publishCodexEvent: relaySync.publishCodexEvent,
        publishChatMessage: roomInteraction.publishChatMessage,
        publishHostHandoff: hostHandoffActions.publishHostHandoff
      },
      invoke: {
        hasSelectedRoom,
        selectedRoom,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
        isSelectedRoomRevoked: roomInteraction.isSelectedRoomRevoked,
        isActiveHost: roomInteraction.isActiveHost,
        codexRunning: selectedRuntime.codexRunning,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        hostGateMessage: roomInteraction.hostGateMessage,
        localUser: localIdentity.localUser,
        draft,
        replyToMessageId,
        roomGoal,
        pendingAttachments,
        messages,
        roomTerminals,
        browserRequests,
        gitStatus,
        activeCodexApproval: selectedRuntime.activeCodexApproval,
        queuedCodexApprovals: selectedRuntime.queuedCodexApprovals,
        codexThreadId: selectedRuntime.selectedCodexThreadId,
        publishChatMessage: roomInteraction.publishChatMessage,
        handleCodexBrowserOpenCommand: relaySync.handleCodexBrowserOpenCommand,
        publishCodexQueueEvent: relaySync.publishCodexQueueEvent,
        setSelectedChatMessage,
        setChatMessageForRoom,
        setSelectedHostMessage,
        setHostMessageForRoom,
        setPendingCodexApprovalForRoom,
        enqueueCodexApprovalForRoom: roomActions.enqueueCodexApprovalForRoom,
        setApprovalVisibleForRoom,
        setDraftForRoom,
        setReplyToMessageForRoom: roomActions.setReplyToMessageForRoom,
        setRoomGoalForRoom,
        clearPendingAttachmentsForRoom
      }
    },
    toolActions: {
      settings: {
        hasSelectedRoom,
        isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
        isSelectedRoomRevoked: roomInteraction.isSelectedRoomRevoked,
        isActiveHost: roomInteraction.isActiveHost,
        selectedRoom,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        selectedCodexModel,
        selectedCodexReasoningEffort,
        selectedCodexSpeed,
        selectedCodexSandboxLevel,
        projectPathDraft,
        approvalPolicyLabels,
        roomSettingsGateMessage: roomInteraction.roomSettingsGateMessage,
        roomSettingsActor,
        reportRoomSettingsMutationInFlight: roomInteraction.reportRoomSettingsMutationInFlight,
        setSettingsBusyForRoom: roomActions.setSettingsBusyForRoom,
        setSelectedSettingsMessage,
        setSettingsMessageForRoom,
        setSelectedBrowserMessage,
        setBrowserMessageForRoom,
        replaceRoom: workspaceRecords.replaceRoom,
        clearBrowserStatusForRoom: roomActions.clearBrowserStatusForRoom,
        setProjectPathDraftForRoom,
        resetCodexApprovalForRoom,
        resetFileContextForRoom,
        publishRoomSettingsEvent: relaySync.publishRoomSettingsEvent
      },
      terminal: {
        hasSelectedRoom,
        isActiveHost: roomInteraction.isActiveHost,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        hostGateMessage: roomInteraction.hostGateMessage,
        localWorkspaceMessage: roomInteraction.localWorkspaceMessage,
        selectedRoom,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
        localUser: localIdentity.localUser,
        roomTerminals,
        selectedTerminal: selectedRuntime.selectedTerminal,
        terminalRequests: selectedRuntime.terminalRequests,
        reportRoomTerminalActionInFlight: roomInteraction.reportRoomTerminalActionInFlight,
        setTerminalBusyForRoom: roomActions.setTerminalBusyForRoom,
        setSelectedTerminalError,
        setTerminalErrorForRoom,
        appendTerminalLinesForRoom,
        setGitStatusForRoom,
        upsertTerminalSnapshot: terminalPanelState.upsertTerminalSnapshot,
        setSelectedTerminalIdForRoom,
        updateTerminalRequestStatus,
        publishRequestStatus: relaySync.publishRequestStatus,
        publishTerminalResult: relaySync.publishTerminalResult
      },
      localPreview: {
        hasSelectedRoom,
        isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
        isSelectedRoomRevoked: roomInteraction.isSelectedRoomRevoked,
        selectedRoom,
        rooms: workspaceState.rooms,
        localUser: localIdentity.localUser,
        localPreviewDialog: localPreviewState.localPreviewDialog,
        localPreviewsByRoom: localPreviewState.localPreviewsByRoom,
        openLocalPreviewDialogForRoom: localPreviewState.openLocalPreviewDialogForRoom,
        closeLocalPreviewDialog: localPreviewState.closeLocalPreviewDialog,
        setLocalPreviewDialogCandidates: localPreviewState.setLocalPreviewDialogCandidates,
        setLocalPreviewDialogSelectedUrl: localPreviewState.setLocalPreviewDialogSelectedUrl,
        setLocalPreviewDialogPhase: localPreviewState.setLocalPreviewDialogPhase,
        setLocalPreviewDialogConfirmation: localPreviewState.setLocalPreviewDialogConfirmation,
        setLocalPreviewDialogError: localPreviewState.setLocalPreviewDialogError,
        setLocalPreviewBusyForRoom,
        setSelectedChatMessage,
        setChatMessageForRoom,
        publishLocalPreviewEvent: relaySync.publishLocalPreviewEvent
      },
      account: {
        selectedRoomId: selectedRoom.id,
        deviceId: localIdentity.deviceId,
        signOutGitHub: githubAuth.signOutGitHub,
        replaceDeviceIdentity: appRuntimeState.replaceDeviceIdentity,
        setDeviceIdentityStatusMessage: appRuntimeState.setDeviceIdentityStatusMessage,
        untrustDeviceForRoom: appRuntimeState.untrustDeviceForRoom
      },
      githubActions: {
        hasSelectedRoom,
        selectedRoom,
        roomsRef: appRefs.roomsRef,
        actionsBusyRef: appRefs.actionsBusyRef,
        gitWorkflowDraftsRef: appRefs.gitWorkflowDraftsRef,
        forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
        revokedRoomIds: roomRuntimeState.revokedRoomIds,
        revokedTeamIds: roomRuntimeState.revokedTeamIds,
        localUser: localIdentity.localUser,
        authConfig: githubAuth.authConfig,
        currentUser: githubAuth.currentUser,
        setActionsBusyForRoom,
        publishGitHubActionsEvent: relaySync.publishGitHubActionsEvent
      },
      gitWorkflow: {
        hasSelectedRoom,
        isActiveHost: roomInteraction.isActiveHost,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        hostGateMessage: roomInteraction.hostGateMessage,
        localWorkspaceMessage: roomInteraction.localWorkspaceMessage,
        selectedRoom,
        gitWorkflowBusyRef: appRefs.gitWorkflowBusyRef,
        gitWorkflowDraft,
        gitApprovalPreview: roomInteraction.gitApprovalPreview,
        githubWorkflowReadiness: roomInteraction.githubWorkflowReadiness,
        messages,
        gitStatus,
        setSelectedGitWorkflowMessage,
        setGitWorkflowMessageForRoom,
        setGitWorkflowBusyForRoom,
        appendTerminalLinesForRoom,
        setGitStatusForRoom,
        publishGitWorkflowEvent: relaySync.publishGitWorkflowEvent
      },
      browser: {
        hasSelectedRoom,
        isActiveHost: roomInteraction.isActiveHost,
        canRequestBrowser: roomInteraction.canRequestBrowser,
        canHostBrowser: roomInteraction.canHostBrowser,
        browserAccessMessage: roomInteraction.browserAccessMessage,
        hostGateMessage: roomInteraction.hostGateMessage,
        selectedRoom,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        browserUrl,
        browserReason,
        browserRequests,
        localUser: localIdentity.localUser,
        deviceId: localIdentity.deviceId,
        relayStatus: appRuntimeState.relayStatus,
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        setSelectedBrowserMessage,
        setBrowserMessageForRoom,
        setBrowserUrlForRoom,
        appendBrowserRequest,
        updateBrowserRequestStatus,
        publishRequestStatus: relaySync.publishRequestStatus
      }
    },
    backgroundEffects: {
      localHistoryPersistence: {
        hasSelectedRoom,
        selectedRoomId: workspaceState.selectedRoomId,
        selectedRoomTeamId: selectedRoom.teamId,
        selectedRoom,
        forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
        revokedRoomIds: roomRuntimeState.revokedRoomIds,
        revokedTeamIds: roomRuntimeState.revokedTeamIds,
        historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
        historySettings: historyDefaultsState.historySettings,
        messages,
        chatEdits: workspaceState.chatEditsByRoom[selectedRoom.id] ?? [],
        chatDeletes: workspaceState.chatDeletesByRoom[selectedRoom.id] ?? [],
        terminalRequests: selectedRuntime.terminalRequests,
        fileSaveRequests,
        browserRequests,
        inviteRequests: selectedRuntime.inviteRequests,
        codexEvents: selectedRuntime.codexEvents,
        gitWorkflowEvents: selectedRuntime.gitWorkflowEvents,
        githubActionsEvents: selectedRuntime.githubActionsEvents,
        localPreviews: selectedRuntime.localPreviews,
        terminals: terminalPanelState.terminals,
        hostHandoffs: selectedRuntime.hostHandoffs,
        queuedCodexTurns: selectedRuntime.queuedCodexApprovals,
        roomGoal,
        selectedCodexThreadId: selectedRuntime.selectedCodexThreadId
      },
      localPreviewPolling: {
        localPreviewsByRoom: localPreviewState.localPreviewsByRoom,
        localUserId: localIdentity.localUser.id,
        roomsRef: appRefs.roomsRef,
        publishLocalPreviewEvent: relaySync.publishLocalPreviewEvent
      },
      roomGitStatusRefresh: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: selectedRoom.id,
        selectedRoomProjectPath: selectedRoom.projectPath,
        setGitStatusForRoom
      },
      gitHubRemoteInference: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: selectedRoom.id,
        selectedRoomProjectPath: selectedRoom.projectPath,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        setGitWorkflowMessageForRoom
      },
      gitHubActionsDraftReset: {
        hasSelectedRoom,
        selectedRoomId: selectedRoom.id,
        gitWorkflowDraft
      },
      projectFilesSearch: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: selectedRoom.id,
        selectedRoomProjectPath: selectedRoom.projectPath,
        fileQuery,
        localWorkspaceMessage: roomInteraction.localWorkspaceMessage,
        setProjectFilesForRoom,
        setSelectedFileForRoom,
        setSelectedDiffForRoom,
        setFileBusyForRoom,
        setFileMessageForRoom
      },
      terminalLifecycle: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: selectedRoom.id,
        selectedTerminalId,
        selectedTerminalRunning: selectedRuntime.selectedTerminal?.running,
        clearTerminalSnapshots: terminalPanelState.clearTerminalSnapshots,
        clearTerminalSnapshotsForRoom: terminalPanelState.clearTerminalSnapshotsForRoom,
        syncTerminalSnapshotsForRoom: terminalPanelState.syncTerminalSnapshotsForRoom,
        upsertTerminalSnapshot: terminalPanelState.upsertTerminalSnapshot,
        setTerminalErrorForRoom
      },
      terminalAutoOpen: {
        inspectorTab,
        hasSelectedRoom,
        isActiveHost: roomInteraction.isActiveHost,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
        terminalBusy,
        roomTerminalCount: roomTerminals.length,
        selectedRoomId: selectedRoom.id,
        terminalAutoOpenedRoomsRef: terminalPanelState.terminalAutoOpenedRoomsRef
      },
      codexProbe: { replaceCodexProbe: appRuntimeState.replaceCodexProbe },
      roomDraftCleanup: {
        hasSelectedRoom,
        selectedRoomId: selectedRoom.id,
        selectedRoomProjectPath: selectedRoom.projectPath,
        selectedCodexModel
      }
    }
  });

  useEffect(() => {
    if (!roomInteraction.isActiveHost) return;
    if (selectedRuntime.activeCodexApproval || selectedRuntime.codexRunning) return;
    if (selectedRuntime.queuedCodexApprovals.length === 0) return;
    runtime.promoteNextCodexApprovalForRoom(selectedRoom.id);
  }, [
    roomInteraction.isActiveHost,
    runtime,
    selectedRoom.id,
    selectedRuntime.activeCodexApproval,
    selectedRuntime.codexRunning,
    selectedRuntime.queuedCodexApprovals
  ]);

  return runtime;
}
