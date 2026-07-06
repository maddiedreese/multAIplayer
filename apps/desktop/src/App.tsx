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
import { useHistorySearch } from "./hooks/useHistorySearch";
import { useLocalHistoryHydration } from "./hooks/useLocalHistoryHydration";
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
import { useAppConfigState } from "./hooks/useAppConfigState";
import { useFileTerminalDisplay } from "./hooks/useFileTerminalDisplay";
import { useGitHubWorkflowState } from "./hooks/useGitHubWorkflowState";
import { useGitHubAuth } from "./hooks/useGitHubAuth";
import { useLocalIdentity } from "./hooks/useLocalIdentity";
import { useMarkdownSelection } from "./hooks/useMarkdownSelection";
import { useRoomAccess } from "./hooks/useRoomAccess";
import { useRoomBrowserSetters } from "./hooks/useRoomBrowserSetters";
import { useRoomBusySetters } from "./hooks/useRoomBusySetters";
import { useRoomChatMutations } from "./hooks/useRoomChatMutations";
import { useRoomCodexApprovalSetters } from "./hooks/useRoomCodexApprovalSetters";
import { useRoomDraftSetters } from "./hooks/useRoomDraftSetters";
import { useRoomEventAppenders } from "./hooks/useRoomEventAppenders";
import { useRoomFileSetters } from "./hooks/useRoomFileSetters";
import { useRoomGitSetters } from "./hooks/useRoomGitSetters";
import { useRoomInviteSetters } from "./hooks/useRoomInviteSetters";
import { useRoomInFlightReporters } from "./hooks/useRoomInFlightReporters";
import { useRoomMemberRows } from "./hooks/useRoomMemberRows";
import { useRoomMessageSetters } from "./hooks/useRoomMessageSetters";
import { useRoomNotices } from "./hooks/useRoomNotices";
import { useRoomProjectSetters } from "./hooks/useRoomProjectSetters";
import { useRoomRequestSetters } from "./hooks/useRoomRequestSetters";
import { useShellLayout } from "./hooks/useShellLayout";
import { useSelectedTeamData } from "./hooks/useSelectedTeamData";
import { useSelectedRoomValues } from "./hooks/useSelectedRoomValues";
import { useSelectedRoomRuntime } from "./hooks/useSelectedRoomRuntime";
import { useSidebarNavigation } from "./hooks/useSidebarNavigation";
import { useRoomTerminalSetters } from "./hooks/useRoomTerminalSetters";
import { useTeamMembersRefresh } from "./hooks/useTeamMembersRefresh";
import { useThemeMode } from "./hooks/useThemeMode";
import { useRelaySubscription } from "./hooks/useRelaySubscription";
import { useRelayPublishers } from "./hooks/useRelayPublishers";
import { useLocalPreviewActions } from "./hooks/useLocalPreviewActions";
import { useMarkdownCopyActions } from "./hooks/useMarkdownCopyActions";
import { useGitHubActionsRefresh } from "./hooks/useGitHubActionsRefresh";
import { useBrowserActions } from "./hooks/useBrowserActions";
import { useFileActions } from "./hooks/useFileActions";
import { useTerminalActions } from "./hooks/useTerminalActions";
import { useMemberActions } from "./hooks/useMemberActions";
import { useWorkspaceCreationActions } from "./hooks/useWorkspaceCreationActions";
import { useRoomSettingsActions } from "./hooks/useRoomSettingsActions";
import { useTeamDefaultActions } from "./hooks/useTeamDefaultActions";
import { useLocalHistoryActions } from "./hooks/useLocalHistoryActions";
import { useWorkspaceRecordActions } from "./hooks/useWorkspaceRecordActions";
import { useAccountActions } from "./hooks/useAccountActions";
import { useHostHandoffActions } from "./hooks/useHostHandoffActions";
import { useInviteActions } from "./hooks/useInviteActions";
import { useGitWorkflowActions } from "./hooks/useGitWorkflowActions";
import { useChatActions } from "./hooks/useChatActions";
import { useCodexInvokeActions } from "./hooks/useCodexInvokeActions";
import { useCodexTurnActions } from "./hooks/useCodexTurnActions";
import { useRoomVisibilityWarningActions } from "./hooks/useRoomVisibilityWarningActions";
import { useWorkspaceUiState } from "./hooks/useWorkspaceUiState";
import { useHistoryDefaultsState } from "./hooks/useHistoryDefaultsState";
import { useBrowserPanelState } from "./hooks/useBrowserPanelState";
import { useTerminalPanelState } from "./hooks/useTerminalPanelState";
import { useFilePanelState } from "./hooks/useFilePanelState";
import { useGitHubWorkflowPanelState } from "./hooks/useGitHubWorkflowPanelState";
import { useLocalPreviewState } from "./hooks/useLocalPreviewState";
import { useInvitePanelState } from "./hooks/useInvitePanelState";
import { useRoomSettingsState } from "./hooks/useRoomSettingsState";
import { useRoomChatState } from "./hooks/useRoomChatState";
import { useCodexRoomState } from "./hooks/useCodexRoomState";
import { useRoomRuntimeState } from "./hooks/useRoomRuntimeState";
import { useAppRuntimeState } from "./hooks/useAppRuntimeState";
import { useCodexBrowserOpenCommand } from "./hooks/useCodexBrowserOpenCommand";
import { useRoomSettingsActor } from "./hooks/useRoomSettingsActor";
import { useAppRefs } from "./hooks/useAppRefs";
import { useRoomMainColumnProps } from "./hooks/useRoomMainColumnProps";
import { useRoomInspectorPanelProps } from "./hooks/useRoomInspectorPanelProps";
import { useSelectedRoomContext } from "./hooks/useSelectedRoomContext";
import { useAppSidebarProps } from "./hooks/useAppSidebarProps";
import { useLocalPreviewDialogProps } from "./hooks/useLocalPreviewDialogProps";
import { useAppBootstrapEffects } from "./hooks/useAppBootstrapEffects";
import { useRoomBackgroundEffects } from "./hooks/useRoomBackgroundEffects";
import { useRoomPanelActions } from "./hooks/useRoomPanelActions";
import { InlineSecretWarning } from "./components/common";
import { AppWorkspaceShell } from "./components/AppWorkspaceShell";
import { AppSidebarDrawer } from "./components/AppSidebarDrawer";
import { DesktopSidebar } from "./components/DesktopSidebar";
import { RoomMainColumn } from "./components/RoomMainColumn";
import { RoomInspectorPanel, type InspectorTab } from "./components/RoomInspectorPanel";
import { LocalPreviewDialog } from "./components/LocalPreviewDialog";
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
  const { themeMode, toggleThemeMode } = useThemeMode();
  const {
    teams,
    setTeams,
    rooms,
    setRooms,
    teamMembersByTeam,
    setTeamMembersByTeam,
    teamMembersMessageByTeam,
    setTeamMembersMessageByTeam,
    teamMembersBusyByTeam,
    setTeamMembersBusyByTeam,
    workspaceError,
    setWorkspaceError,
    activeSidebarPanel,
    setActiveSidebarPanel,
    newTeamName,
    setNewTeamName,
    newRoomName,
    setNewRoomName,
    newRoomProjectPath,
    setNewRoomProjectPath,
    selectedTeam,
    setSelectedTeam,
    selectedRoomId,
    setSelectedRoomId,
    sidebarQuery,
    setSidebarQuery,
    messagesByRoom,
    setMessagesByRoom
  } = useWorkspaceUiState({
    initialTeams: seededTeams,
    initialRooms: seededRooms,
    initialTeamMembersByTeam: seededTeamMembers,
    initialProjectPath: defaultProjectPath,
    initialRoomId: "room-desktop",
    initialMessagesByRoom
  });
  const {
    appConfig,
    relayHttpDraft,
    relayWsDraft,
    appConfigMessage,
    setRelayHttpDraft,
    setRelayWsDraft,
    saveRelayConfiguration,
    resetRelayConfiguration
  } = useAppConfigState();
  const {
    chatMessagesByRoom,
    setChatMessagesByRoom,
    draftsByRoom,
    setDraftsByRoom,
    pendingAttachmentsByRoom,
    setPendingAttachmentsByRoom,
    sensitiveAttachmentReviewKey,
    setSensitiveAttachmentReviewKey
  } = useRoomChatState();
  const {
    hostBusyByRoom,
    setHostBusyByRoom,
    hostMessagesByRoom,
    setHostMessagesByRoom,
    settingsBusyByRoom,
    setSettingsBusyByRoom,
    settingsMessagesByRoom,
    setSettingsMessagesByRoom,
    customCodexModelsByRoom,
    setCustomCodexModelsByRoom,
    projectPathDraftsByRoom,
    setProjectPathDraftsByRoom
  } = useRoomSettingsState();
  const {
    historySettings,
    setHistorySettings,
    teamHistorySettings,
    setTeamHistorySettings,
    teamDefaultApprovalPolicy,
    setTeamDefaultApprovalPolicy,
    teamDefaultCodexModel,
    setTeamDefaultCodexModel,
    teamDefaultBrowserProfilePersistent,
    setTeamDefaultBrowserProfilePersistent,
    teamDefaultInviteApprovalGate,
    setTeamDefaultInviteApprovalGate,
    historyMessagesByRoom,
    setHistoryMessagesByRoom,
    teamHistoryMessagesByTeam,
    setTeamHistoryMessagesByTeam
  } = useHistoryDefaultsState({ initialTeamId: seededTeams[0].id });
  const {
    inspectorTabsByRoom,
    setInspectorTabsByRoom,
    forgottenRoomIds,
    setForgottenRoomIds,
    revokedRoomIds,
    setRevokedRoomIds,
    revokedTeamIds,
    setRevokedTeamIds,
    presenceByRoom,
    setPresenceByRoom,
    hostHandoffsByRoom,
    setHostHandoffsByRoom,
    codexContinuationByRoom,
    setCodexContinuationByRoom,
    gitWorkflowEventsByRoom,
    setGitWorkflowEventsByRoom,
    githubActionsEventsByRoom,
    setGitHubActionsEventsByRoom
  } = useRoomRuntimeState();
  const {
    codexEventsByRoom,
    setCodexEventsByRoom,
    approvalVisibleByRoom,
    setApprovalVisibleByRoom,
    pendingCodexApprovalsByRoom,
    setPendingCodexApprovalsByRoom,
    codexRunningByRoom,
    setCodexRunningByRoom,
    secretWarningsVisibleByRoom,
    setSecretWarningsVisibleByRoom,
    codexThreadIdsByRoom,
    setCodexThreadIdsByRoom
  } = useCodexRoomState();
  const {
    localPreviewsByRoom,
    setLocalPreviewsByRoom,
    localPreviewDialog,
    setLocalPreviewDialog,
    localPreviewBusyByRoom,
    setLocalPreviewBusyByRoom
  } = useLocalPreviewState();
  const {
    codexProbe,
    setCodexProbe,
    relayStatus,
    setRelayStatus,
    deviceIdentity,
    setDeviceIdentity,
    deviceIdentityMessage,
    setDeviceIdentityMessage,
    trustedDeviceKeys,
    setTrustedDeviceKeys,
    historySearchMessagesByRoom,
    setHistorySearchMessagesByRoom,
    historySearchBusy,
    setHistorySearchBusy
  } = useAppRuntimeState();
  const {
    terminalLinesByRoom,
    setTerminalLinesByRoom,
    terminalBusyByRoom,
    setTerminalBusyByRoom,
    terminals,
    setTerminals,
    terminalRequestsByRoom,
    setTerminalRequestsByRoom,
    selectedTerminalIdsByRoom,
    setSelectedTerminalIdsByRoom,
    terminalNamesByRoom,
    setTerminalNamesByRoom,
    terminalCommandsByRoom,
    setTerminalCommandsByRoom,
    terminalInputsByRoom,
    setTerminalInputsByRoom,
    terminalErrorsByRoom,
    setTerminalErrorsByRoom,
    terminalAutoOpenedRoomsRef
  } = useTerminalPanelState({ initialTerminalLinesByRoom });
  const {
    browserRequestsByRoom,
    setBrowserRequestsByRoom,
    browserUrlsByRoom,
    setBrowserUrlsByRoom,
    browserReasonsByRoom,
    setBrowserReasonsByRoom,
    browserMessagesByRoom,
    setBrowserMessagesByRoom,
    browserStatusByRoom,
    setBrowserStatusByRoom,
    activeBrowserUrlsByRoom,
    setActiveBrowserUrlsByRoom
  } = useBrowserPanelState();
  const {
    gitStatusByRoom,
    setGitStatusByRoom,
    gitWorkflowBusyByRoom,
    setGitWorkflowBusyByRoom,
    gitWorkflowMessagesByRoom,
    setGitWorkflowMessagesByRoom,
    actionsBusyByRoom,
    setActionsBusyByRoom,
    actionsMessagesByRoom,
    setActionsMessagesByRoom,
    actionRunsByRoom,
    setActionRunsByRoom,
    actionsLastCheckedByRoom,
    setActionsLastCheckedByRoom,
    gitWorkflowDraftsByRoom,
    setGitWorkflowDraftsByRoom
  } = useGitHubWorkflowPanelState();
  const {
    fileQueriesByRoom,
    setFileQueriesByRoom,
    projectFilesByRoom,
    setProjectFilesByRoom,
    selectedFilesByRoom,
    setSelectedFilesByRoom,
    selectedDiffsByRoom,
    setSelectedDiffsByRoom,
    filePreviewTabsByRoom,
    setFilePreviewTabsByRoom,
    fileBusyByRoom,
    setFileBusyByRoom,
    fileMessagesByRoom,
    setFileMessagesByRoom,
    markdownCopyFallbacksByRoom,
    setMarkdownCopyFallbacksByRoom
  } = useFilePanelState();
  const {
    inviteRequestsByRoom,
    setInviteRequestsByRoom,
    inviteSecretInput,
    setInviteSecretInput,
    inviteLinksByRoom,
    setInviteLinksByRoom,
    inviteApprovalGatesByRoom,
    setInviteApprovalGatesByRoom,
    inviteMessagesByRoom,
    setInviteMessagesByRoom,
    keyRotationBusyByRoom,
    setKeyRotationBusyByRoom,
    inviteAdmissionsByRoom,
    setInviteAdmissionsByRoom
  } = useInvitePanelState();
  const {
    sidebarCollapsed,
    inspectorCollapsed,
    shellStyle,
    beginShellResize,
    toggleSidebarCollapsed,
    toggleInspectorCollapsed
  } = useShellLayout();
  const {
    relayRef,
    seenEnvelopeIds,
    historyLoadedRoomIds,
    roomsRef,
    selectedRoomIdRef,
    gitWorkflowDraftsRef,
    hostBusyRef,
    settingsBusyRef,
    keyRotationBusyRef,
    gitWorkflowBusyRef,
    actionsBusyRef,
    terminalBusyRef,
    localPreviewBusyRef,
    fileBusyRef,
    browserRequestsRef
  } = useAppRefs({
    rooms,
    selectedRoomId,
    gitWorkflowDraftsByRoom,
    hostBusyByRoom,
    settingsBusyByRoom,
    keyRotationBusyByRoom,
    gitWorkflowBusyByRoom,
    actionsBusyByRoom,
    localPreviewBusyByRoom,
    fileBusyByRoom,
    terminalBusyByRoom,
    browserRequestsByRoom
  });
  const {
    authConfig,
    currentUser,
    deviceFlow,
    authError,
    authBusy,
    beginGitHubSignIn,
    signOutGitHub
  } = useGitHubAuth(appConfig.relayHttpUrl);
  const { deviceId, localUser } = useLocalIdentity(currentUser);
  const roomSettingsActor = useRoomSettingsActor(localUser);

  const {
    hasSelectedRoom,
    selectedRoom,
    inspectorTab,
    secretWarningVisible,
    roomTerminals
  } = useSelectedRoomContext({
    rooms,
    selectedRoomId,
    fallbackRoom: emptyRoom,
    inspectorTabsByRoom,
    secretWarningsVisibleByRoom,
    terminals
  });
  const {
    markdownSelectionMode,
    selectedMessageIds,
    clearSelectedMessages,
    toggleMarkdownSelectionMode,
    toggleMessageSelection
  } = useMarkdownSelection({
    activeRoomId: selectedRoom.id,
    enabled: hasSelectedRoom,
    resetKey: selectedRoomId
  });
  const {
    selectedTeamRecord,
    selectedTeamName,
    selectedTeamMembers,
    selectedTeamMembersMessage,
    selectedTeamMembersBusy,
    selectedTeamMemberRows
  } = useSelectedTeamData({
    teams,
    selectedTeam,
    teamMembersByTeam,
    teamMembersMessageByTeam,
    teamMembersBusyByTeam,
    currentUser,
    localUserId: localUser.id
  });
  const {
    selectedCodexModel,
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
  } = useSelectedRoomValues({
    selectedRoom,
    selectedRoomId,
    selectedTeam,
    selectedMessageIds,
    markdownSelectionMode,
    customCodexModelsByRoom,
    projectPathDraftsByRoom,
    messagesByRoom,
    draftsByRoom,
    pendingAttachmentsByRoom,
    browserRequestsByRoom,
    browserUrlsByRoom,
    browserReasonsByRoom,
    activeBrowserUrlsByRoom,
    gitStatusByRoom,
    gitWorkflowDraftsByRoom,
    gitWorkflowBusyByRoom,
    gitWorkflowMessagesByRoom,
    actionRunsByRoom,
    actionsBusyByRoom,
    actionsLastCheckedByRoom,
    actionsMessagesByRoom,
    terminalLinesByRoom,
    terminalBusyByRoom,
    selectedTerminalIdsByRoom,
    terminalNamesByRoom,
    terminalCommandsByRoom,
    terminalInputsByRoom,
    terminalErrorsByRoom,
    fileQueriesByRoom,
    projectFilesByRoom,
    selectedFilesByRoom,
    selectedDiffsByRoom,
    filePreviewTabsByRoom,
    fileBusyByRoom,
    fileMessagesByRoom,
    inviteLinksByRoom,
    inviteApprovalGatesByRoom,
    inviteMessagesByRoom,
    hostMessagesByRoom,
    chatMessagesByRoom,
    settingsMessagesByRoom,
    historyMessagesByRoom,
    teamHistoryMessagesByTeam,
    markdownCopyFallbacksByRoom,
    defaultBrowserUrl,
    defaultBrowserReason
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
    setSelectedSettingsMessage
  } = useRoomMessageSetters({
    selectedRoomId: selectedRoom.id,
    selectedTeamId: selectedTeam,
    setHostMessagesByRoom,
    setChatMessagesByRoom,
    setMarkdownCopyFallbacksByRoom,
    setSecretWarningsVisibleByRoom,
    setHistoryMessagesByRoom,
    setTeamHistoryMessagesByTeam,
    setSettingsMessagesByRoom
  });
  const {
    setGitWorkflowBusyForRoom,
    setActionsBusyForRoom,
    setLocalPreviewBusyForRoom,
    setHostBusyForRoom,
    setSettingsBusyForRoom,
    setKeyRotationBusyForRoom,
    setFileBusyForRoom,
    setTerminalBusyForRoom
  } = useRoomBusySetters({
    gitWorkflowBusyRef,
    actionsBusyRef,
    localPreviewBusyRef,
    hostBusyRef,
    settingsBusyRef,
    keyRotationBusyRef,
    fileBusyRef,
    terminalBusyRef,
    setGitWorkflowBusyByRoom,
    setActionsBusyByRoom,
    setLocalPreviewBusyByRoom,
    setHostBusyByRoom,
    setSettingsBusyByRoom,
    setKeyRotationBusyByRoom,
    setFileBusyByRoom,
    setTerminalBusyByRoom
  });
  const {
    setFileQueryForRoom,
    setProjectFilesForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom,
    setFilePreviewTabForRoom,
    setFileMessageForRoom,
    setSelectedFileMessage,
    resetFileContextForRoom
  } = useRoomFileSetters({
    selectedRoomId: selectedRoom.id,
    setFileQueriesByRoom,
    setProjectFilesByRoom,
    setSelectedFilesByRoom,
    setSelectedDiffsByRoom,
    setFilePreviewTabsByRoom,
    setFileBusyByRoom,
    setFileMessagesByRoom
  });
  const {
    setSelectedTerminalIdForRoom,
    setTerminalNameForRoom,
    setTerminalCommandForRoom,
    setTerminalInputForRoom,
    setTerminalErrorForRoom,
    setSelectedTerminalError,
    appendTerminalLinesForRoom
  } = useRoomTerminalSetters({
    selectedRoomId: selectedRoom.id,
    maxTerminalActivityLines,
    setSelectedTerminalIdsByRoom,
    setTerminalNamesByRoom,
    setTerminalCommandsByRoom,
    setTerminalInputsByRoom,
    setTerminalErrorsByRoom,
    setTerminalLinesByRoom
  });
  const {
    setApprovalVisibleForRoom,
    setPendingCodexApprovalForRoom,
    resetCodexApprovalForRoom,
    setCodexRunningForRoom
  } = useRoomCodexApprovalSetters({
    setApprovalVisibleByRoom,
    setPendingCodexApprovalsByRoom,
    setCodexRunningByRoom
  });
  const {
    setBrowserUrlForRoom,
    setBrowserReasonForRoom,
    setBrowserMessageForRoom,
    setSelectedBrowserMessage
  } = useRoomBrowserSetters({
    selectedRoomId: selectedRoom.id,
    defaultBrowserUrl,
    defaultBrowserReason,
    setBrowserUrlsByRoom,
    setBrowserReasonsByRoom,
    setBrowserMessagesByRoom
  });
  const {
    setInviteLinkForRoom,
    setInviteApprovalGateForRoom,
    setInviteMessageForRoom,
    setSelectedInviteMessage
  } = useRoomInviteSetters({
    selectedRoomId: selectedRoom.id,
    setInviteLinksByRoom,
    setInviteApprovalGatesByRoom,
    setInviteMessagesByRoom
  });
  const {
    setPendingAttachmentsForRoom,
    setDraftForRoom
  } = useRoomDraftSetters({
    setPendingAttachmentsByRoom,
    setDraftsByRoom
  });
  const {
    setCustomCodexModelForRoom,
    setProjectPathDraftForRoom
  } = useRoomProjectSetters({
    roomsRef,
    defaultCodexModel,
    defaultProjectPath,
    setCustomCodexModelsByRoom,
    setProjectPathDraftsByRoom
  });
  const {
    setGitWorkflowMessageForRoom,
    setSelectedGitWorkflowMessage,
    setGitStatusForRoom,
    updateSelectedGitWorkflowDraft
  } = useRoomGitSetters({
    selectedRoomId: selectedRoom.id,
    hasSelectedRoom,
    setGitWorkflowMessagesByRoom,
    setGitWorkflowDraftsByRoom,
    setGitStatusByRoom
  });
  const {
    appendGitWorkflowEvent,
    appendGitHubActionsEvent,
    appendLocalPreviewEvent,
    appendHostHandoff,
    appendInviteRequest,
    appendCodexEvent
  } = useRoomEventAppenders({
    setGitWorkflowEventsByRoom,
    setGitHubActionsEventsByRoom,
    setLocalPreviewsByRoom,
    setHostHandoffsByRoom,
    setInviteRequestsByRoom,
    setCodexEventsByRoom
  });
  const {
    updateInviteRequestStatus,
    appendTerminalRequest,
    updateTerminalRequestStatus,
    appendBrowserRequest,
    updateBrowserRequestStatus
  } = useRoomRequestSetters({
    setInviteRequestsByRoom,
    setTerminalRequestsByRoom,
    setBrowserRequestsByRoom
  });
  const {
    appendRoomMessage,
    applyMessageReaction
  } = useRoomChatMutations({
    setMessagesByRoom
  });
  const {
    upsertTeam,
    upsertRoom,
    handleRelayError
  } = useWorkspaceRecordActions({
    hasSelectedRoom,
    selectedRoom,
    localUser,
    roomsRef,
    setTeams,
    setTeamMembersByTeam,
    setRooms,
    resetCodexApprovalForRoom,
    setRevokedRoomIds,
    setRevokedTeamIds,
    setForgottenRoomIds,
    setInviteAdmissionsByRoom,
    setPresenceByRoom,
    setInviteLinkForRoom,
    setInviteMessageForRoom,
    setChatMessageForRoom,
    setHostMessageForRoom,
    setWorkspaceError
  });
  const {
    reportRoomHostMutationInFlight,
    reportRoomSettingsMutationInFlight,
    reportRoomKeyRotationInFlight,
    reportRoomFileActionInFlight,
    reportRoomTerminalActionInFlight
  } = useRoomInFlightReporters({
    hostBusyRef,
    settingsBusyRef,
    keyRotationBusyRef,
    fileBusyRef,
    terminalBusyRef,
    setHostMessageForRoom,
    setSettingsMessageForRoom,
    setInviteMessageForRoom,
    setFileMessageForRoom,
    setTerminalErrorForRoom
  });
  const roomNotices = useRoomNotices({
    roomId: selectedRoom.id,
    hostMessage,
    chatMessage,
    setHostMessageForRoom,
    setChatMessageForRoom
  });
  const { acknowledgeRoomVisibilityWarning } = useRoomVisibilityWarningActions({
    hasSelectedRoom,
    selectedRoomId: selectedRoom.id,
    setSecretWarningVisibleForRoom
  });
  const {
    isActiveHost,
    isSelectedRoomForgotten,
    isSelectedRoomRevoked,
    isSelectedRoomLocked,
    canReadLocalWorkspace,
    canRequestWorkspace,
    canRequestBrowser,
    canHostBrowser,
    canCopyRoomInvite,
    localWorkspaceMessage,
    roomPosture,
    browserAccessMessage,
    workspaceRequestMessage,
    hostGateMessage,
    roomSettingsGateMessage
  } = useRoomAccess({
    hasSelectedRoom,
    selectedRoom,
    localUser,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    historySettings,
    inviteApprovalGate
  });
  const {
    publishChatMessage,
    toggleMessageReaction
  } = useChatActions({
    hasSelectedRoom,
    selectedRoom,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    localUser,
    deviceId,
    relayStatus,
    relayRef,
    seenEnvelopeIds,
    appendRoomMessage,
    applyMessageReaction,
    setChatMessageForRoom,
    setSelectedChatMessage
  });
  const {
    actionsSummary,
    githubWorkflowReadiness,
    githubActionsReadiness,
    gitApprovalPreview
  } = useGitHubWorkflowState({
    actionRuns,
    authConfig,
    currentUser,
    gitWorkflowDraft,
    projectPath: selectedRoom.projectPath
  });
  const roomMemberRows = useRoomMemberRows({
    presenceByRoom,
    selectedRoom,
    selectedRoomId,
    localUser,
    localDeviceId: deviceId,
    localPublicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
    trustedDeviceKeys
  });
  const {
    activeCodexApproval,
    approvalVisible,
    selectedTerminal,
    selectedTerminalCanRestart,
    hostHandoffs,
    terminalRequests,
    localPreviews,
    localPreviewBusy,
    selectedTerminalCanControl,
    inspectorAttention,
    inviteRequests,
    codexEvents,
    gitWorkflowEvents,
    githubActionsEvents,
    selectedCodexThreadId,
    codexRunning,
    approvalTranscriptMessages,
    codexApprovalSummaryDisplay,
    chatMessageRows,
    pendingAttachmentRows,
    localPreviewCards,
    pendingAttachmentSummary,
    hostBusy,
    settingsBusy,
    keyRotationBusy,
    hostStatusLabel,
    roomCanUseChat
  } = useSelectedRoomRuntime({
    selectedRoom,
    selectedRoomId,
    markdownSelectionMode,
    selectedMessageIds,
    localUser,
    isSelectedRoomLocked,
    messages,
    pendingAttachments,
    pendingAttachmentBytes,
    browserRequests,
    roomTerminals,
    selectedTerminalId,
    pendingCodexApprovalsByRoom,
    approvalVisibleByRoom,
    hostHandoffsByRoom,
    terminalRequestsByRoom,
    localPreviewsByRoom,
    localPreviewBusyByRoom,
    inviteRequestsByRoom,
    codexEventsByRoom,
    gitWorkflowEventsByRoom,
    githubActionsEventsByRoom,
    codexThreadIdsByRoom,
    codexRunningByRoom,
    hostBusyByRoom,
    settingsBusyByRoom,
    keyRotationBusyByRoom
  });
  const {
    setRoomHost,
    acceptHostHandoff,
    publishHostHandoff,
    markHostHandoffAccepted
  } = useHostHandoffActions({
    hasSelectedRoom,
    selectedRoom,
    selectedRoomIdRef,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    isActiveHost,
    hostGateMessage,
    hostHandoffs,
    localUser,
    deviceId,
    relayStatus,
    relayRef,
    seenEnvelopeIds,
    messages,
    terminals,
    browserRequestsByRoom,
    gitStatus,
    gitStatusByRoom,
    reportRoomHostMutationInFlight,
    roomSettingsActor,
    setRooms,
    setCodexContinuationByRoom,
    setHostHandoffsByRoom,
    setHostBusyForRoom,
    setHostMessageForRoom,
    setSelectedHostMessage,
    setSettingsMessageForRoom,
    setProjectPathDraftForRoom,
    setCustomCodexModelForRoom,
    resetFileContextForRoom,
    resetCodexApprovalForRoom,
    appendHostHandoff
  });
  const {
    acceptInvite,
    copyInviteLink,
    decryptInviteEnvelope,
    decideInviteJoinRequest,
    handleInviteEnvelopePlaintext,
    joinInviteSecret,
    requestNoSecretInviteAccess,
    rotateSelectedRoomKey
  } = useInviteActions({
    hasSelectedRoom,
    selectedRoom,
    selectedRoomIdRef,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    isActiveHost,
    hostGateMessage,
    inviteApprovalGate,
    inviteRequests,
    inviteSecretInput,
    localUser,
    deviceId,
    deviceIdentity,
    relayStatus,
    relayRef,
    seenEnvelopeIds,
    historyLoadedRoomIds,
    reportRoomKeyRotationInFlight,
    upsertTeam,
    upsertRoom,
    appendInviteRequest,
    updateInviteRequestStatus,
    appendRoomMessage,
    setSelectedInviteMessage,
    setInviteMessageForRoom,
    setInviteLinkForRoom,
    setInviteSecretInput,
    setSelectedTeam,
    setSelectedRoomId,
    setForgottenRoomIds,
    setRevokedRoomIds,
    setRevokedTeamIds,
    setInviteAdmissionsByRoom,
    setMessagesByRoom,
    setKeyRotationBusyForRoom
  });

  const {
    selectedAttachmentReview,
    selectedFileRisks,
    selectedFileNeedsAttachmentReview,
    selectedSensitiveFileReviewed,
    terminalRisks,
    terminalCommandRisks,
    terminalOutputLines,
    terminalRequestRows,
    codexEventRows
  } = useFileTerminalDisplay({
    selectedFile,
    selectedRoomId: selectedRoom.id,
    selectedRoomProjectPath: selectedRoom.projectPath,
    sensitiveAttachmentReviewKey,
    selectedTerminal,
    terminalLines,
    terminalCommand,
    terminalRequests,
    codexEvents
  });
  const {
    searchActive,
    sidebarTeamRows,
    sidebarRoomRows,
    sidebarMessageHitRows
  } = useSidebarNavigation({
    sidebarQuery,
    rooms,
    teams,
    selectedTeam,
    selectedRoomId,
    messagesByRoom,
    historySearchMessagesByRoom,
    approvalVisibleByRoom,
    terminalRequestsByRoom,
    browserRequestsByRoom,
    approvalPolicyLabels
  });
  const { refreshTeamMembers } = useTeamMembersRefresh({
    selectedTeam,
    relayHttpUrl: appConfig.relayHttpUrl,
    setTeamMembersByTeam,
    setTeamMembersMessageByTeam
  });
  useAppBootstrapEffects({
    workspace: {
      relayHttpUrl: appConfig.relayHttpUrl,
      setTeams,
      setRooms,
      setSelectedTeam,
      setSelectedRoomId,
      setWorkspaceError
    },
    selectedRoomReadReceipt: {
      selectedRoomId,
      setRooms
    },
    deviceIdentity: {
      relayHttpUrl: appConfig.relayHttpUrl,
      deviceId,
      userId: localUser.id,
      displayName: localUser.name,
      deviceIdentity,
      setDeviceIdentity,
      setDeviceIdentityMessage
    },
    selectedTeamDefaults: {
      selectedTeam,
      setTeamHistorySettings,
      setTeamDefaultApprovalPolicy,
      setTeamDefaultCodexModel,
      setTeamDefaultBrowserProfilePersistent,
      setTeamDefaultInviteApprovalGate
    },
    inviteUrl: {
      requestNoSecretInviteAccess,
      acceptInvite,
      setSelectedInviteMessage
    }
  });
  const {
    copyMarkdownWithFallback,
    copyProjectMarkdown,
    copyRoomMarkdown,
    copySelectedMessagesMarkdown,
    copyMessageMarkdown,
    copyCodexOutputMarkdown,
    copyTerminalMarkdown,
    copyDiffSummaryMarkdown,
    copyPullRequestDraftMarkdown
  } = useMarkdownCopyActions({
    hasSelectedRoom,
    canReadLocalWorkspace,
    localWorkspaceMessage,
    selectedRoom,
    teams,
    messages,
    selectedMessages,
    gitStatus,
    selectedFile,
    selectedDiff,
    selectedFileRisks,
    selectedTerminal,
    terminalLines,
    terminalRisks,
    setMarkdownCopyFallbackForRoom,
    setSelectedChatMessage,
    setChatMessageForRoom,
    setSelectedFileMessage,
    setFileMessageForRoom,
    setSelectedTerminalError,
    setTerminalErrorForRoom,
    setSelectedGitWorkflowMessage,
    setGitWorkflowMessageForRoom
  });
  const {
    trustRoomMemberDevice,
    untrustRoomMemberDevice,
    copyRoomMemberDeviceFingerprint,
    changeTeamMemberRole,
    transferOwnershipToTeamMember,
    removeMemberFromTeam
  } = useMemberActions({
    selectedTeam,
    selectedTeamName,
    selectedTeamMembersBusy,
    selectedRoom,
    localUser,
    currentUser,
    setDeviceIdentityMessage,
    setTrustedDeviceKeys,
    setTeamMembersBusyByTeam,
    setTeamMembersMessageByTeam,
    setTeamMembersByTeam,
    setTeams,
    copyMarkdownWithFallback
  });
  const {
    addTeam,
    addRoom,
    chooseNewRoomProjectPath
  } = useWorkspaceCreationActions({
    selectedTeam,
    newTeamName,
    newRoomName,
    newRoomProjectPath,
    setWorkspaceError,
    setSelectedTeam,
    setSelectedRoomId,
    setNewTeamName,
    setNewRoomName,
    setNewRoomProjectPath,
    setRevokedRoomIds,
    setRevokedTeamIds,
    setForgottenRoomIds,
    setMessagesByRoom,
    setInviteApprovalGateForRoom,
    upsertTeam,
    upsertRoom
  });
  const {
    updateTeamHistoryDefaults,
    updateTeamDefaultApprovalPolicy,
    updateTeamDefaultCodexModel,
    updateTeamDefaultInviteApprovalGate
  } = useTeamDefaultActions({
    selectedTeam,
    approvalPolicyLabels,
    setSelectedTeamHistoryMessage,
    setTeamHistoryMessageForTeam,
    setTeamHistorySettings,
    setTeamDefaultApprovalPolicy,
    setTeamDefaultCodexModel,
    setTeamDefaultBrowserProfilePersistent,
    setTeamDefaultInviteApprovalGate
  });
  const {
    updateLocalHistorySettings,
    applyTeamDefaultsToRoom,
    clearRoomHistory,
    forgetSelectedRoomLocalData
  } = useLocalHistoryActions({
    hasSelectedRoom,
    selectedRoom,
    selectedRoomIdRef,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    isActiveHost,
    messages,
    terminalRequests,
    browserRequests,
    inviteRequests,
    codexEvents,
    gitWorkflowEvents,
    githubActionsEvents,
    localPreviews,
    terminals,
    hostHandoffs,
    selectedCodexThreadId,
    reportRoomSettingsMutationInFlight,
    roomSettingsActor,
    setSelectedHistoryMessage,
    setHistoryMessageForRoom,
    setInviteApprovalGateForRoom,
    setSettingsBusyForRoom,
    setSecretWarningVisibleForRoom,
    setHistorySettings,
    setMessagesByRoom,
    setTerminalRequestsByRoom,
    setBrowserRequestsByRoom,
    setInviteRequestsByRoom,
    setCodexEventsByRoom,
    setGitWorkflowEventsByRoom,
    setGitHubActionsEventsByRoom,
    setLocalPreviewsByRoom,
    setTerminals,
    setHostHandoffsByRoom,
    setRooms,
    setBrowserStatusByRoom,
    setActiveBrowserUrlsByRoom,
    setCodexThreadIdsByRoom,
    setActionRunsByRoom,
    setActionsLastCheckedByRoom,
    setActionsMessagesByRoom,
    setActionsBusyByRoom,
    setGitWorkflowBusyByRoom,
    setHostBusyByRoom,
    setHostMessagesByRoom,
    setChatMessagesByRoom,
    setMarkdownCopyFallbacksByRoom,
    setSecretWarningsVisibleByRoom,
    setHistoryMessagesByRoom,
    setSettingsBusyByRoom,
    setSettingsMessagesByRoom,
    setCustomCodexModelsByRoom,
    setProjectPathDraftsByRoom,
    setKeyRotationBusyByRoom,
    setApprovalVisibleByRoom,
    setPendingCodexApprovalsByRoom,
    setCodexRunningByRoom,
    setGitStatusByRoom,
    setFileQueriesByRoom,
    setProjectFilesByRoom,
    setSelectedFilesByRoom,
    setSelectedDiffsByRoom,
    setFileBusyByRoom,
    setFileMessagesByRoom,
    setPendingAttachmentsByRoom,
    setTerminalLinesByRoom,
    setTerminalBusyByRoom,
    setSelectedTerminalIdsByRoom,
    setTerminalNamesByRoom,
    setTerminalCommandsByRoom,
    setTerminalInputsByRoom,
    setTerminalErrorsByRoom,
    setBrowserUrlsByRoom,
    setBrowserReasonsByRoom,
    setBrowserMessagesByRoom,
    setInviteLinksByRoom,
    setInviteApprovalGatesByRoom,
    setInviteMessagesByRoom,
    setDraftsByRoom,
    setForgottenRoomIds,
    historyLoadedRoomIds
  });
  const {
    openProjectFile,
    attachSelectedFileToMessage,
    removePendingAttachment,
    openEncryptedAttachmentBlob
  } = useFileActions({
    hasSelectedRoom,
    canReadLocalWorkspace,
    localWorkspaceMessage,
    selectedRoom,
    selectedRoomIdRef,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    selectedFile,
    pendingAttachmentsByRoom,
    sensitiveAttachmentReviewKey,
    setSensitiveAttachmentReviewKey,
    reportRoomFileActionInFlight,
    setFileBusyForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom,
    setFilePreviewTabForRoom,
    setSelectedFileMessage,
    setFileMessageForRoom,
    setPendingAttachmentsForRoom,
    setInspectorTabsByRoom
  });
  useLocalHistoryHydration({
    hasSelectedRoom,
    selectedRoomId,
    selectedRoomTeamId: selectedRoom.teamId,
    forgottenRoomIds,
    historyLoadedRoomIds,
    setHistorySettings,
    setMessagesByRoom,
    setTerminalRequestsByRoom,
    setBrowserRequestsByRoom,
    setInviteRequestsByRoom,
    setCodexEventsByRoom,
    setGitWorkflowEventsByRoom,
    setGitHubActionsEventsByRoom,
    setLocalPreviewsByRoom,
    setGitWorkflowMessageForRoom,
    setActionRunsByRoom,
    setActionsLastCheckedByRoom,
    setActionsMessagesByRoom,
    setTerminals,
    setSelectedTerminalIdsByRoom,
    setHostHandoffsByRoom,
    setCodexThreadIdsByRoom
  });

  useHistorySearch({
    searchActive,
    rooms,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    setHistorySearchMessagesByRoom,
    setHistorySearchBusy
  });

  const { handleCodexBrowserOpenCommand } = useCodexBrowserOpenCommand({
    localUser,
    selectedRoomIdRef,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    appendBrowserRequest,
    setBrowserMessageForRoom,
    setBrowserUrlForRoom,
    setActiveBrowserUrlsByRoom,
    setBrowserStatusByRoom,
    setInspectorTabsByRoom
  });

  useRelaySubscription({
    relayWsUrl: appConfig.relayWsUrl,
    deviceId,
    localUser,
    devicePublicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
    selectedTeam,
    selectedRoom,
    hasSelectedRoom,
    isActiveHost,
    inviteAdmissionsByRoom,
    revokedRoomIds,
    revokedTeamIds,
    approvalPolicyLabels,
    roomModeLabels,
    relayRef,
    seenEnvelopeIds,
    roomsRef,
    selectedRoomIdRef,
    historyLoadedRoomIds,
    setRelayStatus,
    setPresenceByRoom,
    setRooms,
    setMessagesByRoom,
    setTerminalRequestsByRoom,
    setBrowserRequestsByRoom,
    setActionRunsByRoom,
    setActionsLastCheckedByRoom,
    setActionsMessagesByRoom,
    setForgottenRoomIds,
    handleRelayError,
    upsertRoom,
    upsertTeam,
    refreshTeamMembers,
    decryptInviteEnvelope,
    handleInviteEnvelopePlaintext,
    handleCodexBrowserOpenCommand,
    applyMessageReaction,
    updateTerminalRequestStatus,
    appendTerminalLinesForRoom,
    appendGitWorkflowEvent,
    setGitWorkflowMessageForRoom,
    appendGitHubActionsEvent,
    appendCodexEvent,
    updateBrowserRequestStatus,
    appendLocalPreviewEvent,
    setChatMessageForRoom,
    markHostHandoffAccepted,
    setHostMessageForRoom,
    appendHostHandoff,
    appendRoomMessage,
    setInviteMessageForRoom
  });
  const {
    publishRequestStatus,
    publishLocalPreviewEvent,
    publishTerminalResult,
    publishGitWorkflowEvent,
    publishCodexEvent,
    publishRoomSettingsEvent,
    publishGitHubActionsEvent
  } = useRelayPublishers({
    relayRef,
    seenEnvelopeIds,
    relayStatus,
    selectedRoom,
    deviceId,
    localUser,
    approvalPolicyLabels,
    roomModeLabels,
    appendLocalPreviewEvent,
    appendGitWorkflowEvent,
    appendCodexEvent,
    appendTerminalLinesForRoom,
    appendRoomMessage,
    appendGitHubActionsEvent
  });
  const { approveCodexTurn } = useCodexTurnActions({
    selectedRoom,
    activeCodexApproval,
    roomsRef,
    selectedRoomIdRef,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    localUser,
    messagesByRoom,
    terminals,
    browserRequestsByRoom,
    gitStatusByRoom,
    codexContinuationByRoom,
    codexThreadIdsByRoom,
    setHostMessageForRoom,
    setPendingCodexApprovalForRoom,
    setApprovalVisibleForRoom,
    setCodexRunningForRoom,
    appendTerminalLinesForRoom,
    setCodexThreadIdsByRoom,
    setCodexContinuationByRoom,
    setRooms,
    publishCodexEvent,
    publishChatMessage,
    publishHostHandoff
  });
  const {
    handleCodexInvoke,
    sendMessage
  } = useCodexInvokeActions({
    hasSelectedRoom,
    selectedRoom,
    selectedRoomIdRef,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    isActiveHost,
    canReadLocalWorkspace,
    hostGateMessage,
    localUser,
    draft,
    pendingAttachments,
    messages,
    roomTerminals,
    browserRequests,
    gitStatus,
    publishChatMessage,
    handleCodexBrowserOpenCommand,
    approveCodexTurn,
    setSelectedChatMessage,
    setChatMessageForRoom,
    setSelectedHostMessage,
    setHostMessageForRoom,
    setPendingCodexApprovalForRoom,
    setApprovalVisibleForRoom,
    setDraftForRoom,
    setPendingAttachmentsForRoom
  });
  const {
    setApprovalPolicy,
    toggleRoomMode,
    setCodexModel,
    renameRoom,
    setBrowserProfilePersistence,
    updateProjectPath,
    chooseProjectPath
  } = useRoomSettingsActions({
    hasSelectedRoom,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    isActiveHost,
    selectedRoom,
    selectedRoomIdRef,
    selectedCodexModel,
    projectPathDraft,
    approvalPolicyLabels,
    roomModeLabels,
    roomSettingsGateMessage,
    roomSettingsActor,
    reportRoomSettingsMutationInFlight,
    setSettingsBusyForRoom,
    setSelectedSettingsMessage,
    setSettingsMessageForRoom,
    setSelectedBrowserMessage,
    setBrowserMessageForRoom,
    setRooms,
    setBrowserStatusByRoom,
    setProjectPathDraftForRoom,
    resetCodexApprovalForRoom,
    resetFileContextForRoom,
    publishRoomSettingsEvent
  });
  const {
    runApprovedTerminalCheck,
    startNamedTerminal,
    openInteractiveTerminal,
    restartSelectedTerminal,
    stopSelectedTerminal,
    sendTerminalInput,
    requestTerminalCommand,
    approveTerminalRequest,
    denyTerminalRequest
  } = useTerminalActions({
    hasSelectedRoom,
    isActiveHost,
    canReadLocalWorkspace,
    canRequestWorkspace,
    hostGateMessage,
    localWorkspaceMessage,
    workspaceRequestMessage,
    selectedRoom,
    selectedRoomIdRef,
    isSelectedRoomLocked,
    localUser,
    deviceId,
    relayStatus,
    relayRef,
    seenEnvelopeIds,
    roomTerminals,
    selectedTerminal,
    terminalName,
    terminalCommand,
    terminalInput,
    terminalRequests,
    reportRoomTerminalActionInFlight,
    setTerminalBusyForRoom,
    setSelectedTerminalError,
    setTerminalErrorForRoom,
    appendTerminalLinesForRoom,
    setGitStatusForRoom,
    setTerminals,
    setSelectedTerminalIdForRoom,
    setTerminalNameForRoom,
    setTerminalCommandForRoom,
    setTerminalInputForRoom,
    appendTerminalRequest,
    updateTerminalRequestStatus,
    publishRequestStatus,
    publishTerminalResult
  });
  const {
    openLocalPreviewDialog,
    prepareLocalPreviewConfirmation,
    confirmLocalPreviewShare,
    stopLocalPreview,
    stopOwnedLocalPreviews
  } = useLocalPreviewActions({
    hasSelectedRoom,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    selectedRoom,
    rooms,
    localUser,
    localPreviewDialog,
    localPreviewsByRoom,
    setLocalPreviewDialog,
    setLocalPreviewBusyForRoom,
    setSelectedChatMessage,
    setChatMessageForRoom,
    publishLocalPreviewEvent
  });
  const { signOut, rotateDeviceIdentity } = useAccountActions({
    selectedRoomId: selectedRoom.id,
    deviceId,
    stopOwnedLocalPreviews,
    signOutGitHub,
    setDeviceIdentity,
    setDeviceIdentityMessage,
    setTrustedDeviceKeys
  });
  const { refreshGitHubActions } = useGitHubActionsRefresh({
    hasSelectedRoom,
    selectedRoom,
    roomsRef,
    actionsBusyRef,
    gitWorkflowDraftsRef,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    localUser,
    authConfig,
    currentUser,
    setActionsBusyForRoom,
    setActionsMessagesByRoom,
    setActionRunsByRoom,
    setActionsLastCheckedByRoom,
    publishGitHubActionsEvent
  });
  const { approveGitWorkflow } = useGitWorkflowActions({
    hasSelectedRoom,
    isActiveHost,
    canReadLocalWorkspace,
    hostGateMessage,
    localWorkspaceMessage,
    selectedRoom,
    gitWorkflowBusyRef,
    gitWorkflowDraft,
    gitApprovalPreview,
    githubWorkflowReadiness,
    messages,
    gitStatus,
    setSelectedGitWorkflowMessage,
    setGitWorkflowMessageForRoom,
    setGitWorkflowBusyForRoom,
    appendTerminalLinesForRoom,
    setGitStatusForRoom,
    publishGitWorkflowEvent,
    refreshGitHubActions
  });
  const {
    requestBrowserAccess,
    approveBrowserRequest,
    denyBrowserRequest,
    openApprovedBrowserRequest,
    openRoomBrowserNow,
    resetRoomBrowserProfile
  } = useBrowserActions({
    hasSelectedRoom,
    isActiveHost,
    canRequestBrowser,
    canHostBrowser,
    browserAccessMessage,
    hostGateMessage,
    selectedRoom,
    selectedRoomIdRef,
    browserUrl,
    browserReason,
    browserRequests,
    localUser,
    deviceId,
    relayStatus,
    relayRef,
    seenEnvelopeIds,
    defaultBrowserStatus,
    setSelectedBrowserMessage,
    setBrowserMessageForRoom,
    setBrowserUrlForRoom,
    appendBrowserRequest,
    updateBrowserRequestStatus,
    publishRequestStatus,
    setActiveBrowserUrlsByRoom,
    setBrowserStatusByRoom,
    setInspectorTabsByRoom
  });

  useRoomBackgroundEffects({
    localHistoryPersistence: {
      hasSelectedRoom,
      selectedRoomId,
      selectedRoomTeamId: selectedRoom.teamId,
      forgottenRoomIds,
      revokedRoomIds,
      revokedTeamIds,
      historyLoadedRoomIds,
      historySettings,
      messages,
      terminalRequests,
      browserRequests,
      inviteRequests,
      codexEvents,
      gitWorkflowEvents,
      githubActionsEvents,
      localPreviews,
      terminals,
      hostHandoffs,
      selectedCodexThreadId
    },
    localPreviewPolling: {
      localPreviewsByRoom,
      localUserId: localUser.id,
      roomsRef,
      publishLocalPreviewEvent
    },
    roomGitStatusRefresh: {
      hasSelectedRoom,
      canReadLocalWorkspace,
      selectedRoomId: selectedRoom.id,
      selectedRoomProjectPath: selectedRoom.projectPath,
      setGitStatusForRoom
    },
    gitHubRemoteInference: {
      hasSelectedRoom,
      canReadLocalWorkspace,
      selectedRoomId: selectedRoom.id,
      selectedRoomProjectPath: selectedRoom.projectPath,
      selectedRoomIdRef,
      gitWorkflowDraftsRef,
      setGitWorkflowDraftsByRoom,
      setGitWorkflowMessageForRoom
    },
    gitHubActionsDraftReset: {
      hasSelectedRoom,
      selectedRoomId: selectedRoom.id,
      gitWorkflowDraft,
      setActionRunsByRoom,
      setActionsLastCheckedByRoom,
      setActionsMessagesByRoom,
      setActionsBusyByRoom
    },
    projectFilesSearch: {
      hasSelectedRoom,
      canReadLocalWorkspace,
      selectedRoomId: selectedRoom.id,
      selectedRoomProjectPath: selectedRoom.projectPath,
      fileQueriesByRoom,
      localWorkspaceMessage,
      setProjectFilesForRoom,
      setSelectedFileForRoom,
      setSelectedDiffForRoom,
      setFileBusyForRoom,
      setFileMessageForRoom
    },
    terminalLifecycle: {
      hasSelectedRoom,
      canReadLocalWorkspace,
      selectedRoomId: selectedRoom.id,
      selectedTerminalId,
      selectedTerminalRunning: selectedTerminal?.running,
      setTerminals,
      setSelectedTerminalIdsByRoom,
      setSelectedTerminalIdForRoom,
      setTerminalErrorForRoom
    },
    terminalAutoOpen: {
      inspectorTab,
      hasSelectedRoom,
      isActiveHost,
      canReadLocalWorkspace,
      isSelectedRoomLocked,
      terminalBusy,
      roomTerminalCount: roomTerminals.length,
      selectedRoomId: selectedRoom.id,
      terminalAutoOpenedRoomsRef,
      openInteractiveTerminal
    },
    codexProbe: { setCodexProbe },
    roomDraftCleanup: {
      hasSelectedRoom,
      selectedRoomId: selectedRoom.id,
      selectedRoomProjectPath: selectedRoom.projectPath,
      selectedCodexModel,
      setCustomCodexModelsByRoom,
      setProjectPathDraftsByRoom
    }
  });

  const {
    roomChatPanelActions,
    roomHeaderActions,
    terminalPanelActions,
    workspaceFilesPanelActions
  } = useRoomPanelActions({
    chat: {
      selectedRoomId: selectedRoom.id,
      messages,
      localPreviews,
      copyMessageMarkdown,
      copyCodexOutputMarkdown,
      openEncryptedAttachmentBlob,
      toggleMessageReaction,
      setPendingCodexApprovalForRoom,
      setApprovalVisibleForRoom,
      approveCodexTurn,
      handleCodexInvoke,
      copyMarkdownWithFallback,
      setChatMessageForRoom,
      stopLocalPreview,
      setDraftForRoom
    },
    header: {
      rooms,
      selectedRoomId,
      selectedRoomIdForTabs: selectedRoom.id,
      activeBrowserUrl,
      setSelectedTeam,
      setSelectedRoomId,
      setInspectorTabsByRoom,
      openRoomBrowserNow
    },
    terminal: {
      selectedRoomId: selectedRoom.id,
      terminalRequests,
      copyTerminalMarkdown,
      runApprovedTerminalCheck,
      openInteractiveTerminal,
      setTerminalNameForRoom,
      setTerminalCommandForRoom,
      startNamedTerminal,
      requestTerminalCommand,
      approveTerminalRequest,
      denyTerminalRequest,
      setSelectedTerminalIdForRoom,
      setTerminalInputForRoom,
      sendTerminalInput,
      restartSelectedTerminal,
      stopSelectedTerminal
    },
    workspaceFiles: {
      selectedRoomId: selectedRoom.id,
      copyProjectMarkdown,
      setFileQueryForRoom,
      openProjectFile,
      copyDiffSummaryMarkdown,
      attachSelectedFileToMessage,
      setFilePreviewTabForRoom,
      setSelectedFileForRoom,
      setSelectedDiffForRoom,
      setSensitiveAttachmentReviewKey
    }
  });
  const roomMainColumnProps = useRoomMainColumnProps({
    teams: teams.map((team) => ({ id: team.id, name: team.name })),
    selectedTeam,
    selectedRoom,
    localUser,
    hostBusy,
    isActiveHost,
    isSelectedRoomLocked,
    isSelectedRoomRevoked,
    hasSelectedRoom,
    selectedCodexModel,
    modelOptions: codexModelOptions,
    settingsBusy,
    selectedMessageCount: selectedMessages.length,
    markdownSelectionMode,
    inspectorTab,
    roomHeaderActions,
    onSetHost: setRoomHost,
    onRenameRoom: renameRoom,
    onSelectModel: setCodexModel,
    onCopyRoomMarkdown: copyRoomMarkdown,
    onCopySelectedMarkdown: copySelectedMessagesMarkdown,
    onToggleMarkdownSelection: toggleMarkdownSelectionMode,
    onClearSelectedMessages: clearSelectedMessages,
    onShareLocalPreview: openLocalPreviewDialog,
    notices: roomNotices,
    secretWarningVisible,
    onAcknowledgeSecretWarning: acknowledgeRoomVisibilityWarning,
    markdownCopyFallback,
    onRetryMarkdownCopy: (title, markdown) => copyMarkdownWithFallback(
      title,
      markdown,
      (message) => setChatMessageForRoom(selectedRoom.id, message),
      selectedRoom.id
    ),
    onDismissMarkdownFallback: () => setMarkdownCopyFallbackForRoom(selectedRoom.id, null),
    messages: chatMessageRows,
    approvalVisible,
    approvalSummary: codexApprovalSummaryDisplay,
    codexRunning,
    roomCanUseChat,
    draft,
    pendingAttachmentCount: pendingAttachments.length,
    pendingAttachments: pendingAttachmentRows,
    localPreviewCards,
    pendingAttachmentSummary,
    onToggleMessageSelection: toggleMessageSelection,
    onRemovePendingAttachment: removePendingAttachment,
    onSendMessage: sendMessage,
    roomChatPanelActions
  });
  const roomInspectorPanelProps = useRoomInspectorPanelProps({
    activeTab: inspectorTab,
    activeBrowserUrl,
    browserUrl,
    canHostBrowser,
    onBrowserUrlChange: (url) => setBrowserUrlForRoom(selectedRoom.id, url),
    onOpenBrowserNow: openRoomBrowserNow,
    selectedRoom,
    projectPathDraft,
    gitStatus,
    hasSelectedRoom,
    isSelectedRoomLocked,
    settingsBusy,
    isActiveHost,
    defaultProjectPath,
    onProjectPathDraftChange: (path) => setProjectPathDraftForRoom(selectedRoom.id, path),
    onChooseProjectPath: chooseProjectPath,
    onUpdateProjectPath: updateProjectPath,
    teamRoster: {
      members: selectedTeamMemberRows,
      hasSelectedTeam: Boolean(selectedTeam),
      busy: selectedTeamMembersBusy,
      message: selectedTeamMembersMessage,
      onPromote: (member) => changeTeamMemberRole(member, "admin"),
      onDemote: (member) => changeTeamMemberRole(member, "member"),
      onTransferOwnership: transferOwnershipToTeamMember,
      onRemove: removeMemberFromTeam
    },
    roomMembers: {
      members: roomMemberRows,
      localDeviceId: deviceId,
      message: deviceIdentityMessage,
      onCopyFingerprint: (member) => copyRoomMemberDeviceFingerprint(member, member.trusted),
      onTrust: trustRoomMemberDevice,
      onUntrust: untrustRoomMemberDevice
    },
    hostHandoffs,
    hostBusy,
    onAcceptHandoff: acceptHostHandoff,
    encryptedInvite: {
      inviteApprovalGate,
      copyDisabled: !canCopyRoomInvite,
      inviteSecretInput,
      inviteRequests,
      localDeviceId: deviceId,
      gateDisabled: !hasSelectedRoom || isSelectedRoomLocked,
      importDisabled: !inviteSecretInput.trim(),
      rotateDisabled: !hasSelectedRoom || isSelectedRoomLocked || !isActiveHost || keyRotationBusy,
      approvalDisabled: !hasSelectedRoom || isSelectedRoomLocked || !isActiveHost,
      keyRotationBusy,
      inviteLink,
      inviteMessage,
      onCopyInvite: copyInviteLink,
      onInviteApprovalGateChange: (enabled) => setInviteApprovalGateForRoom(selectedRoom.id, enabled),
      onInviteSecretInputChange: setInviteSecretInput,
      onImportInvite: joinInviteSecret,
      onRotateRoomKey: rotateSelectedRoomKey,
      onDecideInviteRequest: decideInviteJoinRequest
    },
    approvalPolicy: {
      labels: approvalPolicyLabels,
      message: settingsMessage,
      onSelectPolicy: setApprovalPolicy
    },
    roomMode: {
      labels: roomModeLabels,
      onToggleMode: toggleRoomMode
    },
    selectedCodexModel,
    customCodexModel,
    model: {
      customModel: customCodexModel,
      modelOptions: codexModelOptions,
      onSelectModel: setCodexModel,
      onCustomModelChange: (model) => setCustomCodexModelForRoom(selectedRoom.id, model),
      onApplyCustomModel: () => setCodexModel(customCodexModel)
    },
    localHistory: {
      historySettings,
      teamHistorySettings,
      selectedTeam: Boolean(selectedTeam),
      hasSelectedRoom,
      settingsBusy,
      teamDefaultApprovalPolicy,
      approvalPolicyLabels,
      teamDefaultCodexModel,
      defaultCodexModel,
      codexModelOptions,
      teamDefaultBrowserProfilePersistent,
      teamDefaultInviteApprovalGate,
      message: visibleHistoryMessage,
      onHistoryEnabledChange: (enabled) =>
        updateLocalHistorySettings({
          ...historySettings,
          enabled
        }),
      onHistoryRetentionDaysChange: (retentionDays) =>
        updateLocalHistorySettings({
          ...historySettings,
          retentionDays
        }),
      onClearRoomHistory: clearRoomHistory,
      onForgetRoomLocalData: forgetSelectedRoomLocalData,
      onApplyTeamDefaultsToRoom: applyTeamDefaultsToRoom,
      onTeamHistoryEnabledChange: (enabled) =>
        updateTeamHistoryDefaults({
          ...teamHistorySettings,
          enabled
        }),
      onTeamHistoryRetentionDaysChange: (retentionDays) =>
        updateTeamHistoryDefaults({
          ...teamHistorySettings,
          retentionDays
        }),
      onTeamDefaultApprovalPolicyChange: updateTeamDefaultApprovalPolicy,
      onTeamDefaultCodexModelChange: updateTeamDefaultCodexModel,
      onTeamDefaultBrowserProfilePersistentChange: setTeamDefaultBrowserProfilePersistent,
      onTeamDefaultInviteApprovalGateChange: updateTeamDefaultInviteApprovalGate
    },
    workspaceFiles: {
      fileQuery,
      projectFiles,
      selectedFile,
      selectedDiff,
      fileBusy,
      fileMessage,
      canReadLocalWorkspace,
      selectedFileRisks,
      selectedFileNeedsAttachmentReview,
      selectedSensitiveFileReviewed,
      selectedAttachmentActionLabel: selectedAttachmentReview?.actionLabel ?? "Attach",
      selectedAttachmentWarningDetail: selectedAttachmentReview?.warningDetail ?? undefined,
      filePreviewTab,
      ...workspaceFilesPanelActions
    },
    gitHandoff: {
      draft: gitWorkflowDraft,
      preview: gitApprovalPreview,
      readiness: githubWorkflowReadiness,
      canReadLocalWorkspace,
      gitWorkflowBusy,
      isActiveHost,
      message: gitWorkflowMessage,
      onDraftChange: updateSelectedGitWorkflowDraft,
      onCopyPullRequestDraftMarkdown: copyPullRequestDraftMarkdown,
      onApproveGitWorkflow: approveGitWorkflow
    },
    githubActions: {
      summary: actionsSummary,
      readiness: githubActionsReadiness,
      runs: actionRuns,
      owner: gitWorkflowDraft.prOwner,
      repo: gitWorkflowDraft.prRepo,
      branch: gitWorkflowDraft.branchName,
      lastChecked: actionsLastChecked,
      busy: actionsBusy,
      refreshDisabled: !canReadLocalWorkspace || actionsBusy || !isActiveHost || !githubActionsReadiness.ready,
      currentUserSignedIn: Boolean(currentUser),
      message: actionsMessage,
      onRefresh: () => refreshGitHubActions()
    },
    terminal: {
      terminalName,
      terminalCommand,
      terminalInput,
      terminalBusy,
      terminalError,
      terminalCommandRisks,
      terminalRisks,
      codexEvents: codexEventRows,
      commandRequests: terminalRequestRows,
      roomTerminals,
      selectedTerminal,
      selectedTerminalId,
      selectedTerminalCanControl,
      selectedTerminalCanRestart,
      terminalOutputLines,
      codexRunning,
      canReadLocalWorkspace,
      canRequestWorkspace,
      ...terminalPanelActions
    }
  });
  const { sidebarProps, drawerProps } = useAppSidebarProps({
    currentUser,
    authBusy,
    authConfig,
    authError,
    deviceFlow,
    sidebarQuery,
    searchActive,
    workspaceError,
    newTeamName,
    newRoomName,
    newRoomProjectPath,
    selectedTeam: Boolean(selectedTeam),
    teams: sidebarTeamRows,
    rooms: sidebarRoomRows,
    messageHits: sidebarMessageHitRows,
    historySearchBusy,
    activeSidebarPanel,
    themeMode,
    localUserName: localUser.name,
    selectedRoomName: selectedRoom.name,
    deviceId,
    deviceIdentity,
    deviceIdentityMessage,
    relayStatus,
    relayWsUrl: appConfig.relayWsUrl,
    relayHttpUrl: appConfig.relayHttpUrl,
    codexProbe,
    projectPath: selectedRoom.projectPath,
    selectedCodexModel,
    selectedRoomApprovalPolicy: selectedRoom.approvalPolicy,
    roomPosture,
    hasSelectedRoom,
    isSelectedRoomLocked,
    settingsBusy,
    isActiveHost,
    relayHttpDraft,
    relayWsDraft,
    selectedRoomMode: selectedRoom.mode,
    roomSettingsGateMessage,
    historySettings,
    teamHistorySettings,
    teamDefaultApprovalPolicy,
    teamDefaultCodexModel,
    teamDefaultBrowserProfilePersistent,
    teamDefaultInviteApprovalGate,
    settingsMessage: appConfigMessage ?? settingsMessage ?? visibleHistoryMessage,
    onSignIn: beginGitHubSignIn,
    onSignOut: signOut,
    onSidebarQueryChange: setSidebarQuery,
    onNewTeamNameChange: setNewTeamName,
    onCreateTeam: addTeam,
    onSelectTeam: setSelectedTeam,
    onNewRoomNameChange: setNewRoomName,
    onNewRoomProjectPathChange: setNewRoomProjectPath,
    onChooseNewRoomProjectPath: chooseNewRoomProjectPath,
    onCreateRoom: addRoom,
    onSelectRoom: setSelectedRoomId,
    onSelectSidebarPanel: setActiveSidebarPanel,
    onToggleTheme: toggleThemeMode,
    onRotateDeviceIdentity: rotateDeviceIdentity,
    onChooseProject: chooseProjectPath,
    onRelayHttpDraftChange: setRelayHttpDraft,
    onRelayWsDraftChange: setRelayWsDraft,
    onResetRelay: resetRelayConfiguration,
    onSaveRelay: saveRelayConfiguration,
    onToggleRoomMode: toggleRoomMode,
    onHistorySettingsChange: updateLocalHistorySettings,
    onClearRoomHistory: clearRoomHistory,
    onForgetRoomLocalData: forgetSelectedRoomLocalData,
    onTeamHistoryDefaultsChange: updateTeamHistoryDefaults,
    onTeamDefaultApprovalPolicyChange: updateTeamDefaultApprovalPolicy,
    onTeamDefaultCodexModelChange: updateTeamDefaultCodexModel,
    onTeamDefaultBrowserProfilePersistentChange: setTeamDefaultBrowserProfilePersistent,
    onTeamDefaultInviteApprovalGateChange: updateTeamDefaultInviteApprovalGate,
    onApplyTeamDefaultsToRoom: applyTeamDefaultsToRoom,
    roomSources: rooms
  });
  const { localPreviewDialogOpen, localPreviewDialogProps } = useLocalPreviewDialogProps({
    localPreviewDialog,
    setLocalPreviewDialog,
    localPreviewBusy,
    prepareLocalPreviewConfirmation,
    confirmLocalPreviewShare
  });

  return (
    <AppWorkspaceShell
      sidebarCollapsed={sidebarCollapsed}
      inspectorCollapsed={inspectorCollapsed}
      shellStyle={shellStyle}
      onBeginSidebarResize={(event) => beginShellResize("sidebar", event)}
      onBeginInspectorResize={(event) => beginShellResize("inspector", event)}
      onToggleSidebarCollapsed={toggleSidebarCollapsed}
      onToggleInspectorCollapsed={toggleInspectorCollapsed}
      sidebar={<DesktopSidebar {...sidebarProps} />}
      drawer={<AppSidebarDrawer {...drawerProps} />}
      main={(
        <RoomMainColumn {...roomMainColumnProps} />
      )}
      inspector={(
        <RoomInspectorPanel {...roomInspectorPanelProps} />
      )}
      dialog={localPreviewDialogOpen ? <LocalPreviewDialog {...localPreviewDialogProps} /> : null}
    />
  );
}
