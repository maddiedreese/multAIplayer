import { useEffect, useRef } from "react";
import { approvalPolicyLabels } from "../appDefaults";
import type { useAppHostHandoffActions } from "./useAppHostHandoffActions";
import type { useAppRefs } from "./useAppRefs";
import type { useAppRelaySync } from "./useAppRelaySync";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { createRoomActions } from "../application/rooms/roomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { SelectedRoomRuntime } from "./useSelectedRoomRuntime";
import type { WorkspaceRecordActions } from "../application/workspace/workspaceRecordActions";
import type { useGitHubAuth } from "./useGitHubAuth";
import type { useLocalIdentity } from "./useLocalIdentity";
import { createCodexInvokeActions } from "../application/codex/codexInvokeActions";
import { useCodexProbe } from "./useCodexProbe";
import { useGitHubActionsDraftReset } from "./useGitHubActionsDraftReset";
import { useGitHubRemoteInference } from "./useGitHubRemoteInference";
import { useLocalHistoryPersistence } from "./useLocalHistoryPersistence";
import { useLocalPreviewPolling } from "./useLocalPreviewPolling";
import { useProjectFilesSearch } from "./useProjectFilesSearch";
import { useRoomDraftCleanup } from "./useRoomDraftCleanup";
import { useRoomGitStatusRefresh } from "./useRoomGitStatusRefresh";
import { useTerminalAutoOpen } from "./useTerminalAutoOpen";
import { useTerminalLifecycle } from "./useTerminalLifecycle";
import { useRoomToolActions } from "./useRoomToolActions";
import { useCodexTurnActions } from "./useCodexTurnActions";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";
import type { ClientRoomRecord } from "@multaiplayer/protocol";

type AppRefs = ReturnType<typeof useAppRefs>;
type GitHubAuth = ReturnType<typeof useGitHubAuth>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof createRoomActions>;
type RelaySync = ReturnType<typeof useAppRelaySync>;
type HostHandoffActions = ReturnType<typeof useAppHostHandoffActions>;

function selectedRoomRuntimeKey(room: ClientRoomRecord | null) {
  if (!room) return { roomId: null, teamId: "", projectPath: "" };
  return { roomId: room.id, teamId: room.teamId, projectPath: room.projectPath };
}

function roomRuntimeSlices(state: ReturnType<typeof useAppStore.getState>, roomId: string | null) {
  if (!roomId) return { chatEdits: undefined, chatDeletes: undefined, selectedLocalPreviews: undefined };
  return {
    chatEdits: state.chatEditsByRoom[roomId],
    chatDeletes: state.chatDeletesByRoom[roomId],
    selectedLocalPreviews: state.localPreviewByRoom[roomId]?.previews
  };
}

function activeRoomMap<T>(roomId: string | null, value: T | undefined): Record<string, T> {
  if (!roomId || value === undefined) return {};
  return { [roomId]: value };
}

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
  maxTerminalActivityLines: number;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
}) {
  const {
    selectedCodexModel,
    hasSelectedRoom,
    selectedRoom,
    inspectorTab,
    roomTerminals,
    messages,
    roomGoal,
    browserRequests,
    fileSaveRequests,
    gitWorkflowDraft,
    fileQuery,
    terminalBusy,
    selectedTerminalId
  } = selected;
  const roomSelection = selectedRoomRuntimeKey(selectedRoom);
  const { roomId } = roomSelection;
  const {
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    selectedRoomId,
    terminals,
    historySettings,
    chatEdits,
    chatDeletes,
    selectedLocalPreviews
  } = useAppStore(
    useShallow((state) => ({
      forgottenRoomIds: state.forgottenRoomIds,
      revokedRoomIds: state.revokedRoomIds,
      revokedTeamIds: state.revokedTeamIds,
      selectedRoomId: state.selectedRoomId,
      terminals: state.terminals,
      historySettings: state.historySettings,
      ...roomRuntimeSlices(state, roomId)
    }))
  );
  const terminalAutoOpenedRoomsRef = useRef<Set<string>>(new Set());
  const { setActionsBusyForRoom } = roomActions;

  const runtimeOptions = {
    codexActions: {
      turn: {
        localUser: localIdentity.localUser,
        deviceId: localIdentity.deviceId,
        maxTerminalActivityLines,
        replaceRoom: workspaceRecords.replaceRoom,
        publishCodexEvent: relaySync.publishCodexEvent,
        publishChatMessage: roomInteraction.publishChatMessage,
        publishHostHandoff: hostHandoffActions.publishHostHandoff
      },
      invoke: {
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        publishChatMessage: roomInteraction.publishChatMessage,
        handleCodexBrowserOpenCommand: relaySync.handleCodexBrowserOpenCommand,
        publishCodexQueueEvent: relaySync.publishCodexQueueEvent,
        publishCodexEvent: relaySync.publishCodexEvent
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
        signOutGitHub: githubAuth.signOutGitHub
      },
      githubActions: {
        selectedRoom,
        roomsRef: appRefs.roomsRef,
        actionsBusyRef: appRefs.actionsBusyRef,
        gitWorkflowDraftsRef: appRefs.gitWorkflowDraftsRef,
        forgottenRoomIds,
        revokedRoomIds,
        revokedTeamIds,
        localUser: localIdentity.localUser,
        deviceId: localIdentity.deviceId,
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
        selectedRoomTeamId: roomSelection.teamId,
        forgottenRoomIds,
        revokedRoomIds,
        revokedTeamIds,
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
        codexThreadGraph: selectedRuntime.codexThreadGraph
      },
      localPreviewPolling: {
        localPreviewsByRoom: activeRoomMap(roomId, selectedLocalPreviews),
        localUserId: localIdentity.localUser.id,
        roomsRef: appRefs.roomsRef,
        publishLocalPreviewEvent: relaySync.publishLocalPreviewEvent
      },
      roomGitStatusRefresh: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: roomId,
        selectedRoomProjectPath: roomSelection.projectPath
      },
      gitHubRemoteInference: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: roomId,
        selectedRoomProjectPath: roomSelection.projectPath,
        selectedRoomIdRef: appRefs.selectedRoomIdRef
      },
      gitHubActionsDraftReset: {
        hasSelectedRoom,
        selectedRoomId: roomId,
        gitWorkflowDraft
      },
      projectFilesSearch: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: roomId,
        selectedRoomProjectPath: roomSelection.projectPath,
        fileQuery,
        localWorkspaceMessage: roomInteraction.localWorkspaceMessage
      },
      terminalLifecycle: {
        hasSelectedRoom,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        selectedRoomId: roomId,
        selectedTerminalId,
        selectedTerminalRunning: selectedRuntime.selectedTerminal?.running
      },
      terminalAutoOpen: {
        inspectorTab,
        hasSelectedRoom,
        isActiveHost: roomInteraction.isActiveHost,
        canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
        isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
        terminalBusy,
        roomTerminalCount: roomTerminals.length,
        selectedRoomId: roomId,
        terminalAutoOpenedRoomsRef
      },
      roomDraftCleanup: {
        hasSelectedRoom,
        selectedRoomId: roomId,
        selectedRoomProjectPath: roomSelection.projectPath,
        selectedCodexModel
      }
    }
  };
  const { approveCodexTurn, promoteNextCodexApprovalForRoom } = useCodexTurnActions(runtimeOptions.codexActions.turn);
  const codexInvokeActions = createCodexInvokeActions(runtimeOptions.codexActions.invoke);
  const tools = useRoomToolActions(runtimeOptions.toolActions);
  useLocalHistoryPersistence(runtimeOptions.backgroundEffects.localHistoryPersistence);
  useLocalPreviewPolling(runtimeOptions.backgroundEffects.localPreviewPolling);
  useRoomGitStatusRefresh(runtimeOptions.backgroundEffects.roomGitStatusRefresh);
  useGitHubRemoteInference(runtimeOptions.backgroundEffects.gitHubRemoteInference);
  useGitHubActionsDraftReset(runtimeOptions.backgroundEffects.gitHubActionsDraftReset);
  useProjectFilesSearch(runtimeOptions.backgroundEffects.projectFilesSearch);
  useTerminalLifecycle(runtimeOptions.backgroundEffects.terminalLifecycle);
  useTerminalAutoOpen({
    ...runtimeOptions.backgroundEffects.terminalAutoOpen,
    openInteractiveTerminal: tools.openInteractiveTerminal
  });
  useCodexProbe();
  useRoomDraftCleanup(runtimeOptions.backgroundEffects.roomDraftCleanup);
  const runtime = {
    approveCodexTurn,
    promoteNextCodexApprovalForRoom,
    ...codexInvokeActions,
    ...tools
  };

  useEffect(() => {
    if (!selectedRoom) return;
    if (!roomInteraction.isActiveHost) return;
    if (selectedRuntime.activeCodexApproval || selectedRuntime.codexRunning) return;
    if (selectedRuntime.queuedCodexApprovals.length === 0) return;
    promoteNextCodexApprovalForRoom(selectedRoom.id);
  }, [
    roomInteraction.isActiveHost,
    promoteNextCodexApprovalForRoom,
    selectedRoom,
    selectedRuntime.activeCodexApproval,
    selectedRuntime.codexRunning,
    selectedRuntime.queuedCodexApprovals
  ]);

  return runtime;
}
