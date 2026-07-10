import { useEffect, useRef } from "react";
import { approvalPolicyLabels } from "../seedData";
import type { useAppHostHandoffActions } from "./useAppHostHandoffActions";
import type { useAppRefs } from "./useAppRefs";
import type { useAppRelaySync } from "./useAppRelaySync";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { createAppRoomActions } from "../lib/appRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { WorkspaceRecordActions } from "../lib/workspaceRecordActions";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useRoomRuntimeContext } from "./useRoomRuntimeContext";
import type { useRoomSettingsActor } from "./useRoomSettingsActor";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";

type AppRefs = ReturnType<typeof useAppRefs>;
type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof createAppRoomActions>;
type RelaySync = ReturnType<typeof useAppRelaySync>;
type HostHandoffActions = ReturnType<typeof useAppHostHandoffActions>;
type RoomSettingsActor = ReturnType<typeof useRoomSettingsActor>;

export function useAppRoomRuntime({
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
  roomSettingsActor,
  maxTerminalActivityLines,
  defaultBrowserUrl,
  defaultBrowserReason
}: {
  appRefs: AppRefs;
  githubAuth: GitHubAuth;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  roomInteraction: RoomInteraction;
  roomActions: RoomActions;
  relaySync: RelaySync;
  hostHandoffActions: HostHandoffActions;
  workspaceRecords: WorkspaceRecordActions;
  roomSettingsActor: RoomSettingsActor;
  maxTerminalActivityLines: number;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
}) {
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
    gitStatus,
    gitWorkflowDraft,
    fileQuery,
    terminalBusy,
    selectedTerminalId
  } = selected;
  const roomId = selectedRoom.id;
  const {
    codexProbe, forgottenRoomIds, revokedRoomIds, revokedTeamIds, selectedRoomId,
    roomMessages, terminals, selectedBrowserRequests, selectedGitStatus, selectedCodexRuntime,
    historySettings, chatEdits, chatDeletes, selectedLocalPreviews
  } = useAppStore(useShallow((state) => ({
    codexProbe: state.codexProbe,
    forgottenRoomIds: state.forgottenRoomIds,
    revokedRoomIds: state.revokedRoomIds,
    revokedTeamIds: state.revokedTeamIds,
    selectedRoomId: state.selectedRoomId,
    roomMessages: state.messagesByRoom[roomId],
    terminals: state.terminals,
    selectedBrowserRequests: state.browserByRoom[roomId]?.requests,
    selectedGitStatus: state.gitWorkflowRuntimeByRoom[roomId]?.workflow?.status,
    selectedCodexRuntime: state.codexRuntimeByRoom[roomId],
    historySettings: state.historySettings,
    chatEdits: state.chatEditsByRoom[roomId],
    chatDeletes: state.chatDeletesByRoom[roomId],
    selectedLocalPreviews: state.localPreviewByRoom[roomId]?.previews
  })));
  const terminalAutoOpenedRoomsRef = useRef<Set<string>>(new Set());
  const {
    setHostMessageForRoom,
    setSelectedHostMessage,
    setChatMessageForRoom,
    setSelectedChatMessage,
    setSelectedSettingsMessage,
    setSettingsMessageForRoom,
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
    clearPendingAttachmentsForRoom,
    setDraftForRoom,
    setProjectPathDraftForRoom,
    setGitStatusForRoom,
    appendTerminalRequest,
    updateTerminalRequestStatus
  } = roomActions;

  const runtime = useRoomRuntimeContext({
    codexActions: {
      turn: {
        selectedRoom,
        localUser: localIdentity.localUser,
        codexProbe,
        activeCodexApproval: selectedRuntime.activeCodexApproval,
        roomsRef: appRefs.roomsRef,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        forgottenRoomIds,
        revokedRoomIds,
        revokedTeamIds,
        messagesByRoom: roomMessages ? { [roomId]: roomMessages } : {},
        terminals,
        browserRequestsByRoom: selectedBrowserRequests ? { [roomId]: selectedBrowserRequests } : {},
        gitStatusByRoom: selectedGitStatus ? { [roomId]: selectedGitStatus } : {},
        codexContinuationByRoom: selectedCodexRuntime?.continuation ? { [roomId]: selectedCodexRuntime.continuation } : {},
        codexThreadIdsByRoom: selectedCodexRuntime?.threadGraph?.activeThreadId
          ? { [roomId]: selectedCodexRuntime.threadGraph.activeThreadId }
          : selectedCodexRuntime?.threadId ? { [roomId]: selectedCodexRuntime.threadId } : {},
        queuedCodexApprovalsByRoom: selectedCodexRuntime?.queuedApprovals
          ? { [roomId]: selectedCodexRuntime.queuedApprovals }
          : {},
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
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        publishChatMessage: roomInteraction.publishChatMessage,
        handleCodexBrowserOpenCommand: relaySync.handleCodexBrowserOpenCommand,
        publishCodexQueueEvent: relaySync.publishCodexQueueEvent
      }
    },
    toolActions: {
      settings: {
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        settingsBusyRef: appRefs.settingsBusyRef,
        approvalPolicyLabels,
        reportRoomSettingsMutationInFlight: roomInteraction.reportRoomSettingsMutationInFlight,
        replaceRoom: workspaceRecords.replaceRoom,
        publishRoomSettingsEvent: relaySync.publishRoomSettingsEvent
      },
      terminal: {
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        terminalBusyRef: appRefs.terminalBusyRef,
        reportRoomTerminalActionInFlight: roomInteraction.reportRoomTerminalActionInFlight,
        maxTerminalActivityLines,
        publishRequestStatus: relaySync.publishRequestStatus,
        publishTerminalResult: relaySync.publishTerminalResult
      },
      localPreview: {
        publishLocalPreviewEvent: relaySync.publishLocalPreviewEvent
      },
      account: {
        signOutGitHub: githubAuth.signOutGitHub,
        replaceDeviceIdentity: (identity) => useAppStore.getState().replaceDeviceIdentity(identity),
        setDeviceIdentityStatusMessage: (message) => useAppStore.getState().setDeviceIdentityStatusMessage(message),
        untrustDeviceForRoom: (targetRoomId, deviceId) => useAppStore.getState().untrustDeviceForRoom(targetRoomId, deviceId)
      },
      githubActions: {
        hasSelectedRoom,
        selectedRoom,
        roomsRef: appRefs.roomsRef,
        actionsBusyRef: appRefs.actionsBusyRef,
        gitWorkflowDraftsRef: appRefs.gitWorkflowDraftsRef,
        forgottenRoomIds,
        revokedRoomIds,
        revokedTeamIds,
        localUser: localIdentity.localUser,
        authConfig: githubAuth.authConfig,
        currentUser: githubAuth.currentUser,
        setActionsBusyForRoom,
        publishGitHubActionsEvent: relaySync.publishGitHubActionsEvent
      },
      gitWorkflow: {
        gitWorkflowBusyRef: appRefs.gitWorkflowBusyRef,
        maxTerminalActivityLines,
        publishGitWorkflowEvent: relaySync.publishGitWorkflowEvent
      },
      browser: {
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        defaultBrowserUrl,
        defaultBrowserReason,
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        publishRequestStatus: relaySync.publishRequestStatus
      }
    },
    backgroundEffects: {
      localHistoryPersistence: {
        hasSelectedRoom,
        selectedRoomId,
        selectedRoomTeamId: selectedRoom.teamId,
        selectedRoom,
        forgottenRoomIds,
        revokedRoomIds,
        revokedTeamIds,
        historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
        historySettings,
        messages,
        chatEdits: chatEdits ?? [],
        chatDeletes: chatDeletes ?? [],
        terminalRequests: selectedRuntime.terminalRequests,
        fileSaveRequests,
        browserRequests,
        inviteRequests: selectedRuntime.inviteRequests,
        codexEvents: selectedRuntime.codexEvents,
        codexActivities: selectedRuntime.codexActivities,
        gitWorkflowEvents: selectedRuntime.gitWorkflowEvents,
        githubActionsEvents: selectedRuntime.githubActionsEvents,
        localPreviews: selectedRuntime.localPreviews,
        terminals,
        hostHandoffs: selectedRuntime.hostHandoffs,
        queuedCodexTurns: selectedRuntime.queuedCodexApprovals,
        roomGoal,
        selectedCodexThreadId: selectedRuntime.selectedCodexThreadId,
        codexThreadGraph: selectedRuntime.codexThreadGraph
      },
      localPreviewPolling: {
        localPreviewsByRoom: selectedLocalPreviews ? { [roomId]: selectedLocalPreviews } : {},
        localUserId: localIdentity.localUser.id,
        roomsRef: appRefs.roomsRef,
        publishLocalPreviewEvent: relaySync.publishLocalPreviewEvent
      },
      roomGitStatusRefresh: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: selectedRoom.id,
        selectedRoomProjectPath: selectedRoom.projectPath
      },
      gitHubRemoteInference: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: selectedRoom.id,
        selectedRoomProjectPath: selectedRoom.projectPath,
        selectedRoomIdRef: appRefs.selectedRoomIdRef
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
        localWorkspaceMessage: roomInteraction.localWorkspaceMessage
      },
      terminalLifecycle: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: selectedRoom.id,
        selectedTerminalId,
        selectedTerminalRunning: selectedRuntime.selectedTerminal?.running,

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
        terminalAutoOpenedRoomsRef
      },
      codexProbe: {},
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
