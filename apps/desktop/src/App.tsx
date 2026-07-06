import type {
  LocalPreviewPlaintextPayload
} from "@multaiplayer/protocol";
import {
  codexModelOptions,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
} from "@multaiplayer/protocol";
import { decryptJson } from "@multaiplayer/crypto";
import { loadHistorySettings } from "./lib/localHistory";
import {
  defaultProjectPath,
  type GitWorkflowResult,
} from "./lib/localBackend";
import type { GitHubActionRun } from "./lib/authClient";
import {
  normalizeRoomName
} from "./lib/workspaceCreation";
import { attachmentReviewScopeKey } from "./lib/attachmentPolicy";
import { roomChatGateMessage } from "./lib/chatPolicy";
import type { GitHubActionsTarget } from "./lib/githubWorkflowReadiness";
import type { GitWorkflowDraft } from "./lib/gitWorkflowDraft";
import {
  embeddedAttachmentBytes,
  encodedBytes,
  attachmentTypeFromName,
  formatTimestamp
} from "./lib/appFormatters";
import { useAppStateSlices } from "./hooks/useAppStateSlices";
import { useGitHubAuth } from "./hooks/useGitHubAuth";
import { useLocalIdentity } from "./hooks/useLocalIdentity";
import { useRoomChatMutations } from "./hooks/useRoomChatMutations";
import { useAppRoomInteractionContext } from "./hooks/useAppRoomInteractionContext";
import { useAppRoomScopedSetters } from "./hooks/useAppRoomScopedSetters";
import { useAppSelectedRoomRuntime } from "./hooks/useAppSelectedRoomRuntime";
import { useAppRoomDisplayContext } from "./hooks/useAppRoomDisplayContext";
import { useThemeMode } from "./hooks/useThemeMode";
import { useAppWorkspaceRecords } from "./hooks/useAppWorkspaceRecords";
import { useAppHostHandoffActions } from "./hooks/useAppHostHandoffActions";
import { useAppInviteActions } from "./hooks/useAppInviteActions";
import { useRoomSettingsActor } from "./hooks/useRoomSettingsActor";
import { useAppRefs } from "./hooks/useAppRefs";
import { useAppSelectedRoomContext } from "./hooks/useAppSelectedRoomContext";
import { useAppViewModel } from "./hooks/useAppViewModel";
import { useAppWorkspaceFlow } from "./hooks/useAppWorkspaceFlow";
import { useRelaySyncContext } from "./hooks/useRelaySyncContext";
import { useRoomRuntimeContext } from "./hooks/useRoomRuntimeContext";
import { useAppRoomPanelActions } from "./hooks/useAppRoomPanelActions";
import { InlineSecretWarning } from "./components/common";
import { AppShellView } from "./components/AppShellView";
import type { InspectorTab } from "./components/RoomInspectorPanel";
import type {
  BrowserAccessRequest,
  ChatAttachment,
  ChatReaction,
  LocalPreviewRecord,
  NoSecretRoomInvite,
  SidebarPanel,
  TerminalCommandRequest
} from "./types";
import {
  approvalPolicyLabels,
  defaultBrowserReason,
  defaultBrowserStatus,
  defaultBrowserUrl,
  emptyRoom,
  initialMessagesByRoom,
  initialTerminalLinesByRoom,
  maxTerminalActivityLines,
  roomModeLabels,
  seededRooms,
  seededTeamMembers,
  seededTeams
} from "./seedData";

export function App() {
  const theme = useThemeMode();
  const appState = useAppStateSlices({
    workspace: {
      initialTeams: seededTeams,
      initialRooms: seededRooms,
      initialTeamMembersByTeam: seededTeamMembers,
      initialProjectPath: defaultProjectPath,
      initialRoomId: "room-desktop",
      initialMessagesByRoom
    },
    historyDefaults: { initialTeamId: seededTeams[0].id },
    terminals: { initialTerminalLinesByRoom }
  });
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
    invitePanelState,
    shellLayout
  } = appState;
  const appRefs = useAppRefs({
    rooms: workspaceState.rooms,
    selectedRoomId: workspaceState.selectedRoomId,
    gitWorkflowDraftsByRoom: githubWorkflowPanelState.gitWorkflowDraftsByRoom,
    hostBusyByRoom: roomSettingsState.hostBusyByRoom,
    settingsBusyByRoom: roomSettingsState.settingsBusyByRoom,
    keyRotationBusyByRoom: invitePanelState.keyRotationBusyByRoom,
    gitWorkflowBusyByRoom: githubWorkflowPanelState.gitWorkflowBusyByRoom,
    actionsBusyByRoom: githubWorkflowPanelState.actionsBusyByRoom,
    localPreviewBusyByRoom: localPreviewState.localPreviewBusyByRoom,
    fileBusyByRoom: filePanelState.fileBusyByRoom,
    terminalBusyByRoom: terminalPanelState.terminalBusyByRoom,
    browserRequestsByRoom: browserPanelState.browserRequestsByRoom
  });
  const githubAuth = useGitHubAuth(appConfigState.appConfig.relayHttpUrl);
  const localIdentity = useLocalIdentity(githubAuth.currentUser);
  const roomSettingsActor = useRoomSettingsActor(localIdentity.localUser);

  const selectedContext = useAppSelectedRoomContext({
    appState,
    githubAuth,
    localIdentity,
    fallbackRoom: emptyRoom,
    defaultBrowserUrl,
    defaultBrowserReason
  });
  const {
    selectedCodexModel,
    hasSelectedRoom,
    selectedRoom,
    inspectorTab,
    secretWarningVisible,
    roomTerminals,
    markdownSelectionMode,
    selectedMessageIds,
    clearSelectedMessages,
    toggleMarkdownSelectionMode,
    toggleMessageSelection,
    selectedTeamName,
    selectedTeamMembersMessage,
    selectedTeamMembersBusy,
    selectedTeamMemberRows,
    customCodexModel,
    projectPathDraft,
    messages,
    draft,
    selectedMessages,
    pendingAttachments,
    pendingAttachmentBytes,
    browserRequests,
    browserUrl,
    browserReason,
    activeBrowserUrl,
    gitStatus,
    gitWorkflowDraft,
    gitWorkflowBusy,
    gitWorkflowMessage,
    actionRuns,
    actionsBusy,
    actionsLastChecked,
    actionsMessage,
    terminalLines,
    terminalBusy,
    selectedTerminalId,
    terminalName,
    terminalCommand,
    terminalInput,
    terminalError,
    fileQuery,
    projectFiles,
    selectedFile,
    selectedDiff,
    filePreviewTab,
    fileBusy,
    fileMessage,
    inviteLink,
    inviteApprovalGate,
    inviteMessage,
    hostMessage,
    chatMessage,
    settingsMessage,
    visibleHistoryMessage,
    markdownCopyFallback
  } = selectedContext;
  const roomSetters = useAppRoomScopedSetters({
    appState,
    appRefs,
    selectedRoom,
    hasSelectedRoom,
    maxTerminalActivityLines,
    defaultBrowserUrl,
    defaultBrowserReason,
    defaultCodexModel,
    defaultProjectPath
  });
  const {
    setHostMessageForRoom,
    setSelectedHostMessage,
    setChatMessageForRoom,
    setSelectedChatMessage,
    setMarkdownCopyFallbackForRoom,
    setSecretWarningVisibleForRoom,
    setHistoryMessageForRoom,
    setSelectedHistoryMessage,
    setTeamHistoryMessageForTeam,
    setSelectedTeamHistoryMessage,
    setSettingsMessageForRoom,
    setSelectedSettingsMessage,
    setGitWorkflowBusyForRoom,
    setActionsBusyForRoom,
    setLocalPreviewBusyForRoom,
    setHostBusyForRoom,
    setSettingsBusyForRoom,
    setKeyRotationBusyForRoom,
    setFileBusyForRoom,
    setTerminalBusyForRoom,
    setFileQueryForRoom,
    setProjectFilesForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom,
    setFilePreviewTabForRoom,
    setFileMessageForRoom,
    setSelectedFileMessage,
    resetFileContextForRoom,
    setSelectedTerminalIdForRoom,
    setTerminalNameForRoom,
    setTerminalCommandForRoom,
    setTerminalInputForRoom,
    setTerminalErrorForRoom,
    setSelectedTerminalError,
    appendTerminalLinesForRoom,
    setApprovalVisibleForRoom,
    setPendingCodexApprovalForRoom,
    resetCodexApprovalForRoom,
    setCodexRunningForRoom,
    setBrowserUrlForRoom,
    setBrowserReasonForRoom,
    setBrowserMessageForRoom,
    setSelectedBrowserMessage,
    setInviteLinkForRoom,
    setInviteApprovalGateForRoom,
    setInviteMessageForRoom,
    setSelectedInviteMessage,
    setPendingAttachmentsForRoom,
    setDraftForRoom,
    setCustomCodexModelForRoom,
    setProjectPathDraftForRoom,
    setGitWorkflowMessageForRoom,
    setSelectedGitWorkflowMessage,
    setGitStatusForRoom,
    updateSelectedGitWorkflowDraft,
    appendGitWorkflowEvent,
    appendGitHubActionsEvent,
    appendLocalPreviewEvent,
    appendHostHandoff,
    appendInviteRequest,
    appendCodexEvent,
    updateInviteRequestStatus,
    appendTerminalRequest,
    updateTerminalRequestStatus,
    appendBrowserRequest,
    updateBrowserRequestStatus
  } = roomSetters;
  const roomChatMutations = useRoomChatMutations({
    setMessagesByRoom: workspaceState.setMessagesByRoom
  });
  const workspaceRecords = useAppWorkspaceRecords({
    appState,
    appRefs,
    localIdentity,
    selected: selectedContext,
    roomSetters
  });
  const roomInteraction = useAppRoomInteractionContext({
    appState,
    appRefs,
    githubAuth,
    localIdentity,
    selected: selectedContext,
    roomChatMutations,
    roomSetters
  });
  const selectedRuntime = useAppSelectedRoomRuntime({
    appState,
    localIdentity,
    selected: selectedContext,
    roomInteraction
  });
  const hostHandoffActions = useAppHostHandoffActions({
    appState,
    appRefs,
    localIdentity,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomSetters,
    roomSettingsActor
  });
  const inviteActions = useAppInviteActions({
    appState,
    appRefs,
    localIdentity,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomSetters,
    roomChatMutations,
    workspaceRecords
  });

  const roomDisplay = useAppRoomDisplayContext({
    appState,
    selected: selectedContext,
    selectedRuntime,
    approvalPolicyLabels
  });
  const workspaceFlow = useAppWorkspaceFlow({
    appState,
    appRefs,
    githubAuth,
    localIdentity,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomSetters,
    workspaceRecords,
    inviteActions,
    roomDisplay,
    roomSettingsActor
  });

  const relaySync = useRelaySyncContext({
    browserOpenCommand: {
      localUser: localIdentity.localUser,
      selectedRoomIdRef: appRefs.selectedRoomIdRef,
      forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
      revokedRoomIds: roomRuntimeState.revokedRoomIds,
      revokedTeamIds: roomRuntimeState.revokedTeamIds,
      appendBrowserRequest,
      setBrowserMessageForRoom,
      setBrowserUrlForRoom,
      setActiveBrowserUrlsByRoom: browserPanelState.setActiveBrowserUrlsByRoom,
      setBrowserStatusByRoom: browserPanelState.setBrowserStatusByRoom,
      setInspectorTabsByRoom: roomRuntimeState.setInspectorTabsByRoom
    },
    relayRoomSync: {
      subscription: {
        relayWsUrl: appConfigState.appConfig.relayWsUrl,
        deviceId: localIdentity.deviceId,
        localUser: localIdentity.localUser,
        devicePublicKeyFingerprint: appRuntimeState.deviceIdentity?.publicKeyFingerprint,
        selectedTeam: workspaceState.selectedTeam,
        selectedRoom,
        hasSelectedRoom,
        isActiveHost: roomInteraction.isActiveHost,
        inviteAdmissionsByRoom: invitePanelState.inviteAdmissionsByRoom,
        revokedRoomIds: roomRuntimeState.revokedRoomIds,
        revokedTeamIds: roomRuntimeState.revokedTeamIds,
        approvalPolicyLabels,
        roomModeLabels,
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        roomsRef: appRefs.roomsRef,
        selectedRoomIdRef: appRefs.selectedRoomIdRef,
        historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
        setRelayStatus: appRuntimeState.setRelayStatus,
        setPresenceByRoom: roomRuntimeState.setPresenceByRoom,
        setRooms: workspaceState.setRooms,
        setMessagesByRoom: workspaceState.setMessagesByRoom,
        setTerminalRequestsByRoom: terminalPanelState.setTerminalRequestsByRoom,
        setBrowserRequestsByRoom: browserPanelState.setBrowserRequestsByRoom,
        setActionRunsByRoom: githubWorkflowPanelState.setActionRunsByRoom,
        setActionsLastCheckedByRoom: githubWorkflowPanelState.setActionsLastCheckedByRoom,
        setActionsMessagesByRoom: githubWorkflowPanelState.setActionsMessagesByRoom,
        setForgottenRoomIds: roomRuntimeState.setForgottenRoomIds,
        handleRelayError: workspaceRecords.handleRelayError,
        upsertRoom: workspaceRecords.upsertRoom,
        upsertTeam: workspaceRecords.upsertTeam,
        refreshTeamMembers: roomDisplay.refreshTeamMembers,
        decryptInviteEnvelope: inviteActions.decryptInviteEnvelope,
        handleInviteEnvelopePlaintext: inviteActions.handleInviteEnvelopePlaintext,
        applyMessageReaction: roomChatMutations.applyMessageReaction,
        updateTerminalRequestStatus,
        appendTerminalLinesForRoom,
        appendGitWorkflowEvent,
        setGitWorkflowMessageForRoom,
        appendGitHubActionsEvent,
        appendCodexEvent,
        updateBrowserRequestStatus,
        appendLocalPreviewEvent,
        setChatMessageForRoom,
        markHostHandoffAccepted: hostHandoffActions.markHostHandoffAccepted,
        setHostMessageForRoom,
        appendHostHandoff,
        appendRoomMessage: roomChatMutations.appendRoomMessage,
        setInviteMessageForRoom
      },
      publishers: {
        relayRef: appRefs.relayRef,
        seenEnvelopeIds: appRefs.seenEnvelopeIds,
        relayStatus: appRuntimeState.relayStatus,
        selectedRoom,
        deviceId: localIdentity.deviceId,
        localUser: localIdentity.localUser,
        approvalPolicyLabels,
        roomModeLabels,
        appendLocalPreviewEvent,
        appendGitWorkflowEvent,
        appendCodexEvent,
        appendTerminalLinesForRoom,
        appendRoomMessage: roomChatMutations.appendRoomMessage,
        appendGitHubActionsEvent
      }
    }
  });
  const roomRuntime = useRoomRuntimeContext({
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
      setHostMessageForRoom,
      setPendingCodexApprovalForRoom,
      setApprovalVisibleForRoom,
      setCodexRunningForRoom,
      appendTerminalLinesForRoom,
      setCodexThreadIdsByRoom: codexRoomState.setCodexThreadIdsByRoom,
      setCodexContinuationByRoom: roomRuntimeState.setCodexContinuationByRoom,
      setRooms: workspaceState.setRooms,
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
      canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
      hostGateMessage: roomInteraction.hostGateMessage,
      localUser: localIdentity.localUser,
      draft,
      pendingAttachments,
      messages,
      roomTerminals,
      browserRequests,
      gitStatus,
      publishChatMessage: roomInteraction.publishChatMessage,
      handleCodexBrowserOpenCommand: relaySync.handleCodexBrowserOpenCommand,
      setSelectedChatMessage,
      setChatMessageForRoom,
      setSelectedHostMessage,
      setHostMessageForRoom,
      setPendingCodexApprovalForRoom,
      setApprovalVisibleForRoom,
      setDraftForRoom,
      setPendingAttachmentsForRoom
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
      projectPathDraft,
      approvalPolicyLabels,
      roomModeLabels,
      roomSettingsGateMessage: roomInteraction.roomSettingsGateMessage,
      roomSettingsActor,
      reportRoomSettingsMutationInFlight: roomInteraction.reportRoomSettingsMutationInFlight,
      setSettingsBusyForRoom,
      setSelectedSettingsMessage,
      setSettingsMessageForRoom,
      setSelectedBrowserMessage,
      setBrowserMessageForRoom,
      setRooms: workspaceState.setRooms,
      setBrowserStatusByRoom: browserPanelState.setBrowserStatusByRoom,
      setProjectPathDraftForRoom,
      resetCodexApprovalForRoom,
      resetFileContextForRoom,
      publishRoomSettingsEvent: relaySync.publishRoomSettingsEvent
    },
    terminal: {
      hasSelectedRoom,
      isActiveHost: roomInteraction.isActiveHost,
      canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
      canRequestWorkspace: roomInteraction.canRequestWorkspace,
      hostGateMessage: roomInteraction.hostGateMessage,
      localWorkspaceMessage: roomInteraction.localWorkspaceMessage,
      workspaceRequestMessage: roomInteraction.workspaceRequestMessage,
      selectedRoom,
      selectedRoomIdRef: appRefs.selectedRoomIdRef,
      isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
      localUser: localIdentity.localUser,
      deviceId: localIdentity.deviceId,
      relayStatus: appRuntimeState.relayStatus,
      relayRef: appRefs.relayRef,
      seenEnvelopeIds: appRefs.seenEnvelopeIds,
      roomTerminals,
      selectedTerminal: selectedRuntime.selectedTerminal,
      terminalName,
      terminalCommand,
      terminalInput,
      terminalRequests: selectedRuntime.terminalRequests,
      reportRoomTerminalActionInFlight: roomInteraction.reportRoomTerminalActionInFlight,
      setTerminalBusyForRoom,
      setSelectedTerminalError,
      setTerminalErrorForRoom,
      appendTerminalLinesForRoom,
      setGitStatusForRoom,
      setTerminals: terminalPanelState.setTerminals,
      setSelectedTerminalIdForRoom,
      setTerminalNameForRoom,
      setTerminalCommandForRoom,
      setTerminalInputForRoom,
      appendTerminalRequest,
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
      setLocalPreviewDialog: localPreviewState.setLocalPreviewDialog,
      setLocalPreviewBusyForRoom,
      setSelectedChatMessage,
      setChatMessageForRoom,
      publishLocalPreviewEvent: relaySync.publishLocalPreviewEvent
    },
    account: {
      selectedRoomId: selectedRoom.id,
      deviceId: localIdentity.deviceId,
      signOutGitHub: githubAuth.signOutGitHub,
      setDeviceIdentity: appRuntimeState.setDeviceIdentity,
      setDeviceIdentityMessage: appRuntimeState.setDeviceIdentityMessage,
      setTrustedDeviceKeys: appRuntimeState.setTrustedDeviceKeys
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
      setActionsMessagesByRoom: githubWorkflowPanelState.setActionsMessagesByRoom,
      setActionRunsByRoom: githubWorkflowPanelState.setActionRunsByRoom,
      setActionsLastCheckedByRoom: githubWorkflowPanelState.setActionsLastCheckedByRoom,
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
      defaultBrowserStatus,
      setSelectedBrowserMessage,
      setBrowserMessageForRoom,
      setBrowserUrlForRoom,
      appendBrowserRequest,
      updateBrowserRequestStatus,
      publishRequestStatus: relaySync.publishRequestStatus,
      setActiveBrowserUrlsByRoom: browserPanelState.setActiveBrowserUrlsByRoom,
      setBrowserStatusByRoom: browserPanelState.setBrowserStatusByRoom,
      setInspectorTabsByRoom: roomRuntimeState.setInspectorTabsByRoom
      }
    },
    backgroundEffects: {
      localHistoryPersistence: {
      hasSelectedRoom,
      selectedRoomId: workspaceState.selectedRoomId,
      selectedRoomTeamId: selectedRoom.teamId,
      forgottenRoomIds: roomRuntimeState.forgottenRoomIds,
      revokedRoomIds: roomRuntimeState.revokedRoomIds,
      revokedTeamIds: roomRuntimeState.revokedTeamIds,
      historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
      historySettings: historyDefaultsState.historySettings,
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
      gitWorkflowDraftsRef: appRefs.gitWorkflowDraftsRef,
      setGitWorkflowDraftsByRoom: githubWorkflowPanelState.setGitWorkflowDraftsByRoom,
      setGitWorkflowMessageForRoom
    },
    gitHubActionsDraftReset: {
      hasSelectedRoom,
      selectedRoomId: selectedRoom.id,
      gitWorkflowDraft,
      setActionRunsByRoom: githubWorkflowPanelState.setActionRunsByRoom,
      setActionsLastCheckedByRoom: githubWorkflowPanelState.setActionsLastCheckedByRoom,
      setActionsMessagesByRoom: githubWorkflowPanelState.setActionsMessagesByRoom,
      setActionsBusyByRoom: githubWorkflowPanelState.setActionsBusyByRoom
    },
    projectFilesSearch: {
      hasSelectedRoom,
      canReadLocalWorkspace: roomInteraction.canReadLocalWorkspace,
      selectedRoomId: selectedRoom.id,
      selectedRoomProjectPath: selectedRoom.projectPath,
      fileQueriesByRoom: filePanelState.fileQueriesByRoom,
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
      setTerminals: terminalPanelState.setTerminals,
      setSelectedTerminalIdsByRoom: terminalPanelState.setSelectedTerminalIdsByRoom,
      setSelectedTerminalIdForRoom,
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
    codexProbe: { setCodexProbe: appRuntimeState.setCodexProbe },
    roomDraftCleanup: {
      hasSelectedRoom,
      selectedRoomId: selectedRoom.id,
      selectedRoomProjectPath: selectedRoom.projectPath,
      selectedCodexModel,
      setCustomCodexModelsByRoom: roomSettingsState.setCustomCodexModelsByRoom,
      setProjectPathDraftsByRoom: roomSettingsState.setProjectPathDraftsByRoom
      }
    }
  });

  const roomPanels = useAppRoomPanelActions({
    appState,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomSetters,
    roomRuntime,
    workspaceFlow
  });
  const appView = useAppViewModel({
    appState,
    githubAuth,
    localIdentity,
    theme,
    selected: selectedContext,
    selectedRuntime,
    roomInteraction,
    roomSetters,
    roomDisplay,
    roomPanels,
    roomRuntime,
    workspaceFlow,
    hostHandoffActions,
    inviteActions
  });

  return <AppShellView {...appView.appShellViewProps} />;
}
