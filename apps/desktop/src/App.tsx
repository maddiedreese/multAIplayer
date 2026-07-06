import { useMemo, useRef, useState } from "react";
import type {
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  LocalPreviewPlaintextPayload,
  RoomRecord
} from "@multaiplayer/protocol";
import {
  codexModelOptions,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
} from "@multaiplayer/protocol";
import { decryptJson } from "@multaiplayer/crypto";
import { loadHistorySettings } from "./lib/localHistory";
import type { DeviceIdentity } from "./lib/deviceIdentity";
import {
  loadTrustedDeviceKeys,
  type TrustedDeviceKey
} from "./lib/deviceTrust";
import {
  defaultProjectPath,
  type CodexProbe,
  type GitWorkflowResult,
} from "./lib/localBackend";
import type { GitHubActionRun } from "./lib/authClient";
import type { RelayClient } from "./lib/relayClient";
import { defaultRelayHttpUrl, defaultRelayWsUrl } from "./lib/appConfig";
import { useDeviceIdentityLifecycle } from "./hooks/useDeviceIdentityLifecycle";
import { useSelectedTeamDefaults } from "./hooks/useSelectedTeamDefaults";
import { useCodexProbe } from "./hooks/useCodexProbe";
import { useRoomDraftCleanup } from "./hooks/useRoomDraftCleanup";
import { useHistorySearch } from "./hooks/useHistorySearch";
import { useRoomGitStatusRefresh } from "./hooks/useRoomGitStatusRefresh";
import { useGitHubRemoteInference } from "./hooks/useGitHubRemoteInference";
import { useGitHubActionsDraftReset } from "./hooks/useGitHubActionsDraftReset";
import { useProjectFilesSearch } from "./hooks/useProjectFilesSearch";
import { useTerminalLifecycle } from "./hooks/useTerminalLifecycle";
import { useLocalHistoryPersistence } from "./hooks/useLocalHistoryPersistence";
import { useTerminalAutoOpen } from "./hooks/useTerminalAutoOpen";
import { useLocalHistoryHydration } from "./hooks/useLocalHistoryHydration";
import { canApproveCodexTurn } from "./lib/codexApproval";
import {
  normalizeRoomName
} from "./lib/workspaceCreation";
import { canControlRoomTerminal } from "./lib/terminalAccess";
import { canHostBrowserAction } from "./lib/browserPolicy";
import { attachmentReviewScopeKey } from "./lib/attachmentPolicy";
import { shouldApplyRoomScopedUiUpdate } from "./lib/roomScopedUi";
import { canStageRoomChatAttachment, canUseRoomChat, roomChatGateMessage } from "./lib/chatPolicy";
import { extractCodexBrowserOpenUrl } from "./lib/codexInvoke";
import type { GitHubActionsTarget } from "./lib/githubWorkflowReadiness";
import type { GitWorkflowDraft } from "./lib/gitWorkflowDraft";
import { roomLockMessage, roomSecretStorageLabel } from "./lib/appRuntime";
import {
  embeddedAttachmentBytes,
  encodedBytes,
  attachmentTypeFromName,
  formatBytes,
  formatCodexModel,
  formatSessionPersistence,
  formatTimestamp
} from "./lib/appFormatters";
import {
  quickTunnelDisclaimer,
  quickTunnelSafetyText
} from "./lib/localPreview";
import { useAppConfigState } from "./hooks/useAppConfigState";
import { useFileTerminalDisplay } from "./hooks/useFileTerminalDisplay";
import { useLatestRef } from "./hooks/useLatestRef";
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
import { useSelectedRoomReadReceipt } from "./hooks/useSelectedRoomReadReceipt";
import { useSidebarNavigation } from "./hooks/useSidebarNavigation";
import { useRoomTerminalSetters } from "./hooks/useRoomTerminalSetters";
import { useTeamMembersRefresh } from "./hooks/useTeamMembersRefresh";
import { useThemeMode } from "./hooks/useThemeMode";
import { useWorkspaceBootstrap } from "./hooks/useWorkspaceBootstrap";
import { useLocalPreviewPolling } from "./hooks/useLocalPreviewPolling";
import { useInviteUrlBootstrap } from "./hooks/useInviteUrlBootstrap";
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
import { useRoomChatPanelActions } from "./hooks/useRoomChatPanelActions";
import { useRoomHeaderActions } from "./hooks/useRoomHeaderActions";
import { useTerminalPanelActions } from "./hooks/useTerminalPanelActions";
import { useWorkspaceFilesPanelActions } from "./hooks/useWorkspaceFilesPanelActions";
import { useWorkspaceUiState } from "./hooks/useWorkspaceUiState";
import { useHistoryDefaultsState } from "./hooks/useHistoryDefaultsState";
import { useBrowserPanelState } from "./hooks/useBrowserPanelState";
import { useTerminalPanelState } from "./hooks/useTerminalPanelState";
import { useFilePanelState } from "./hooks/useFilePanelState";
import { useGitHubWorkflowPanelState } from "./hooks/useGitHubWorkflowPanelState";
import { useLocalPreviewState } from "./hooks/useLocalPreviewState";
import { useInvitePanelState } from "./hooks/useInvitePanelState";
import { useRoomSettingsState } from "./hooks/useRoomSettingsState";
import {
  hasAcknowledgedRoomVisibilityWarning
} from "./lib/roomVisibilityWarning";
import { InlineSecretWarning } from "./components/common";
import { ShellResizer } from "./components/AppShellLayout";
import { BrowserAccessPanel } from "./components/BrowserAccessPanel";
import { AppSidebarDrawer } from "./components/AppSidebarDrawer";
import { DesktopSidebar } from "./components/DesktopSidebar";
import { RoomMainColumn } from "./components/RoomMainColumn";
import { RoomInspectorPanel, type InspectorTab } from "./components/RoomInspectorPanel";
import { RoomInspectorWorkPanel } from "./components/RoomInspectorWorkPanel";
import { LocalPreviewDialog } from "./components/LocalPreviewDialog";
import type {
  BrowserAccessRequest,
  ChatAttachment,
  ChatMessage,
  ChatReaction,
  CodexRoomEvent,
  HostHandoffRecord,
  LocalPreviewRecord,
  NoSecretRoomInvite,
  PendingCodexApproval,
  RelayStatus,
  RoomPresence,
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
  const [chatMessagesByRoom, setChatMessagesByRoom] = useState<Record<string, string | null>>({});
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
  const [inspectorTabsByRoom, setInspectorTabsByRoom] = useState<Record<string, InspectorTab>>({});
  const [forgottenRoomIds, setForgottenRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedRoomIds, setRevokedRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedTeamIds, setRevokedTeamIds] = useState<Set<string>>(() => new Set());
  const [presenceByRoom, setPresenceByRoom] = useState<Record<string, Record<string, RoomPresence>>>({});
  const [hostHandoffsByRoom, setHostHandoffsByRoom] = useState<Record<string, HostHandoffRecord[]>>({});
  const [codexContinuationByRoom, setCodexContinuationByRoom] = useState<Record<string, HostHandoffRecord>>({});
  const [codexEventsByRoom, setCodexEventsByRoom] = useState<Record<string, CodexRoomEvent[]>>({});
  const [gitWorkflowEventsByRoom, setGitWorkflowEventsByRoom] = useState<Record<string, GitWorkflowEventPlaintextPayload[]>>({});
  const [githubActionsEventsByRoom, setGitHubActionsEventsByRoom] = useState<Record<string, GitHubActionsEventPlaintextPayload[]>>({});
  const {
    localPreviewsByRoom,
    setLocalPreviewsByRoom,
    localPreviewDialog,
    setLocalPreviewDialog,
    localPreviewBusyByRoom,
    setLocalPreviewBusyByRoom
  } = useLocalPreviewState();
  const [draftsByRoom, setDraftsByRoom] = useState<Record<string, string>>({});
  const [pendingAttachmentsByRoom, setPendingAttachmentsByRoom] = useState<Record<string, ChatAttachment[]>>({});
  const [approvalVisibleByRoom, setApprovalVisibleByRoom] = useState<Record<string, boolean>>({});
  const [pendingCodexApprovalsByRoom, setPendingCodexApprovalsByRoom] = useState<Record<string, PendingCodexApproval>>({});
  const [codexRunningByRoom, setCodexRunningByRoom] = useState<Record<string, boolean>>({});
  const [secretWarningsVisibleByRoom, setSecretWarningsVisibleByRoom] = useState<Record<string, boolean>>({});
  const [codexProbe, setCodexProbe] = useState<CodexProbe | null>(null);
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
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("closed");
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceIdentityMessage, setDeviceIdentityMessage] = useState<string | null>(null);
  const [trustedDeviceKeys, setTrustedDeviceKeys] = useState<TrustedDeviceKey[]>(() => loadTrustedDeviceKeys());
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
  const [historySearchMessagesByRoom, setHistorySearchMessagesByRoom] = useState<Record<string, ChatMessage[]>>({});
  const [historySearchBusy, setHistorySearchBusy] = useState(false);
  const [sensitiveAttachmentReviewKey, setSensitiveAttachmentReviewKey] = useState<string | null>(null);
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
  const [codexThreadIdsByRoom, setCodexThreadIdsByRoom] = useState<Record<string, string>>({});
  const {
    sidebarCollapsed,
    inspectorCollapsed,
    shellStyle,
    beginShellResize,
    toggleSidebarCollapsed,
    toggleInspectorCollapsed
  } = useShellLayout();
  const relayRef = useRef<RelayClient | null>(null);
  const seenEnvelopeIds = useRef(new Set<string>());
  const historyLoadedRoomIds = useRef(new Set<string>());
  const roomsRef = useLatestRef(rooms);
  const selectedRoomIdRef = useLatestRef(selectedRoomId);
  const gitWorkflowDraftsRef = useLatestRef(gitWorkflowDraftsByRoom);
  const hostBusyRef = useLatestRef(hostBusyByRoom);
  const settingsBusyRef = useLatestRef(settingsBusyByRoom);
  const keyRotationBusyRef = useLatestRef(keyRotationBusyByRoom);
  const gitWorkflowBusyRef = useLatestRef(gitWorkflowBusyByRoom);
  const actionsBusyRef = useLatestRef(actionsBusyByRoom);
  const terminalBusyRef = useLatestRef(terminalBusyByRoom);
  const localPreviewBusyRef = useRef(localPreviewBusyByRoom);
  const fileBusyRef = useLatestRef(fileBusyByRoom);
  const browserRequestsRef = useLatestRef(browserRequestsByRoom);
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

  const hasSelectedRoom = rooms.some((room) => room.id === selectedRoomId);
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? emptyRoom;
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
  const inspectorTab = inspectorTabsByRoom[selectedRoom.id] === "diff"
    ? "files"
    : inspectorTabsByRoom[selectedRoom.id] ?? "files";
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
  const secretWarningVisible = hasSelectedRoom && (
    secretWarningsVisibleByRoom[selectedRoom?.id ?? selectedRoomId] ??
    !hasAcknowledgedRoomVisibilityWarning(selectedRoom?.id ?? selectedRoomId)
  );
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
  const roomTerminals = useMemo(
    () => terminals.filter((terminal) => terminal.roomId === selectedRoom.id),
    [terminals, selectedRoom.id]
  );
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
    hostStatusLabel
  } = useSelectedRoomRuntime({
    selectedRoom,
    selectedRoomId,
    markdownSelectionMode,
    selectedMessageIds,
    localUserId: localUser.id,
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
  const roomCanUseChat = canUseRoomChat(selectedRoom, isSelectedRoomLocked);
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

  const selectedTerminalCanControl = canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked);
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
  useWorkspaceBootstrap({
    relayHttpUrl: appConfig.relayHttpUrl,
    setTeams,
    setRooms,
    setSelectedTeam,
    setSelectedRoomId,
    setWorkspaceError
  });
  useSelectedRoomReadReceipt({
    selectedRoomId,
    setRooms
  });
  useDeviceIdentityLifecycle({
    relayHttpUrl: appConfig.relayHttpUrl,
    deviceId,
    userId: localUser.id,
    displayName: localUser.name,
    deviceIdentity,
    setDeviceIdentity,
    setDeviceIdentityMessage
  });

  useSelectedTeamDefaults({
    selectedTeam,
    setTeamHistorySettings,
    setTeamDefaultApprovalPolicy,
    setTeamDefaultCodexModel,
    setTeamDefaultBrowserProfilePersistent,
    setTeamDefaultInviteApprovalGate
  });

  useInviteUrlBootstrap({
    requestNoSecretInviteAccess,
    acceptInvite,
    setSelectedInviteMessage
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
    openRoomBrowserForUrl,
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

  useLocalHistoryPersistence({
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
  });

  useLocalPreviewPolling({
    localPreviewsByRoom,
    localUserId: localUser.id,
    roomsRef,
    publishLocalPreviewEvent
  });

  useRoomGitStatusRefresh({
    hasSelectedRoom,
    canReadLocalWorkspace,
    selectedRoomId: selectedRoom.id,
    selectedRoomProjectPath: selectedRoom.projectPath,
    setGitStatusForRoom
  });

  useGitHubRemoteInference({
    hasSelectedRoom,
    canReadLocalWorkspace,
    selectedRoomId: selectedRoom.id,
    selectedRoomProjectPath: selectedRoom.projectPath,
    selectedRoomIdRef,
    gitWorkflowDraftsRef,
    setGitWorkflowDraftsByRoom,
    setGitWorkflowMessageForRoom
  });

  useGitHubActionsDraftReset({
    hasSelectedRoom,
    selectedRoomId: selectedRoom.id,
    gitWorkflowDraft,
    setActionRunsByRoom,
    setActionsLastCheckedByRoom,
    setActionsMessagesByRoom,
    setActionsBusyByRoom
  });

  useProjectFilesSearch({
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
  });

  useTerminalLifecycle({
    hasSelectedRoom,
    canReadLocalWorkspace,
    selectedRoomId: selectedRoom.id,
    selectedTerminalId,
    selectedTerminalRunning: selectedTerminal?.running,
    setTerminals,
    setSelectedTerminalIdsByRoom,
    setSelectedTerminalIdForRoom,
    setTerminalErrorForRoom
  });

  useTerminalAutoOpen({
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
  });

  useCodexProbe({ setCodexProbe });

  useRoomDraftCleanup({
    hasSelectedRoom,
    selectedRoomId: selectedRoom.id,
    selectedRoomProjectPath: selectedRoom.projectPath,
    selectedCodexModel,
    setCustomCodexModelsByRoom,
    setProjectPathDraftsByRoom
  });

  const roomChatPanelActions = useRoomChatPanelActions({
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
  });
  const roomHeaderActions = useRoomHeaderActions({
    rooms,
    selectedRoomId,
    selectedRoomIdForTabs: selectedRoom.id,
    activeBrowserUrl,
    setSelectedTeam,
    setSelectedRoomId,
    setInspectorTabsByRoom,
    openRoomBrowserNow
  });
  const terminalPanelActions = useTerminalPanelActions({
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
  });
  const workspaceFilesPanelActions = useWorkspaceFilesPanelActions({
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
  });

  function handleCodexBrowserOpenCommand(message: ChatMessage, room: RoomRecord): boolean {
    const url = extractCodexBrowserOpenUrl(message.body);
    if (!url) return false;
    const roomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const roomLocked = forgottenRoomIds.has(room.id) || roomRevoked;
    if (!canHostBrowserAction(room, localUser, roomLocked)) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        setBrowserMessageForRoom(room.id, "Only the active host can open the in-room browser.");
      }
      return true;
    }
    openRoomBrowserForUrl(room, url, `Opened by ${message.author} through Codex.`);
    return true;
  }

  function roomSettingsActor() {
    return {
      requesterName: localUser.name,
      requesterUserId: localUser.id
    };
  }
  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${inspectorCollapsed ? "inspector-collapsed" : ""}`}
      style={shellStyle}
    >
      <DesktopSidebar
        currentUser={currentUser}
        authBusy={authBusy}
        authConfig={authConfig}
        authError={authError}
        deviceFlow={deviceFlow}
        sidebarQuery={sidebarQuery}
        searchActive={searchActive}
        workspaceError={workspaceError}
        newTeamName={newTeamName}
        newRoomName={newRoomName}
        newRoomProjectPath={newRoomProjectPath}
        defaultProjectPath={defaultProjectPath}
        selectedTeam={Boolean(selectedTeam)}
        teams={sidebarTeamRows}
        rooms={sidebarRoomRows}
        messageHits={sidebarMessageHitRows}
        historySearchBusy={historySearchBusy}
        activeSidebarPanel={activeSidebarPanel}
        themeMode={themeMode}
        onSignIn={beginGitHubSignIn}
        onSignOut={signOut}
        onSidebarQueryChange={setSidebarQuery}
        onClearSidebarQuery={() => setSidebarQuery("")}
        onNewTeamNameChange={setNewTeamName}
        onCreateTeam={addTeam}
        onSelectTeam={(teamId) => {
          setSelectedTeam(teamId);
          setSelectedRoomId(rooms.find((room) => room.teamId === teamId)?.id ?? rooms[0]?.id ?? "");
        }}
        onNewRoomNameChange={setNewRoomName}
        onNewRoomProjectPathChange={setNewRoomProjectPath}
        onChooseNewRoomProjectPath={chooseNewRoomProjectPath}
        onCreateRoom={addRoom}
        onSelectRoom={(roomId, teamId) => {
          if (teamId) setSelectedTeam(teamId);
          setSelectedRoomId(roomId);
        }}
        onSelectSidebarPanel={setActiveSidebarPanel}
        onToggleTheme={toggleThemeMode}
      />

      <ShellResizer
        side="left"
        collapsed={sidebarCollapsed}
        expandLabel="Expand sidebar"
        collapseLabel="Collapse sidebar"
        onBeginResize={(event) => beginShellResize("sidebar", event)}
        onToggleCollapsed={toggleSidebarCollapsed}
      />

      <AppSidebarDrawer
        activePanel={activeSidebarPanel}
        profileTitle={localUser.name}
        settingsTitle={selectedRoom.name}
        profile={{
          currentUser,
          authConfig,
          authBusy,
          authError,
          deviceFlow,
          deviceId,
          deviceIdentity,
          deviceIdentityMessage,
          relaySessionPersistence: formatSessionPersistence(authConfig?.sessionPersistence),
          onRotateDeviceIdentity: rotateDeviceIdentity,
          onSignIn: beginGitHubSignIn,
          onSignOut: signOut
        }}
        settings={{
          relaySummary: `${relayStatus} · ${appConfig.relayWsUrl}`,
          relayApi: appConfig.relayHttpUrl,
          codexSummary: codexProbe?.available ? codexProbe.version ?? "Available" : codexProbe?.error ?? "Not connected",
          projectPath: selectedRoom.projectPath,
          modelLabel: formatCodexModel(selectedCodexModel),
          approvalLabel: approvalPolicyLabels[selectedRoom.approvalPolicy],
          roomKeysLabel: roomSecretStorageLabel(),
          posture: roomPosture,
          chooseProjectDisabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost,
          relayHttpDraft,
          relayWsDraft,
          defaultRelayHttpUrl,
          defaultRelayWsUrl,
          saveRelayDisabled: !relayHttpDraft.trim() || !relayWsDraft.trim(),
          roomMode: selectedRoom.mode,
          roomModeLabels,
          roomModesDisabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost,
          showRoomSettingsGate: !isActiveHost && hasSelectedRoom,
          roomSettingsGateMessage,
          historySettings,
          teamHistorySettings,
          hasSelectedRoom,
          selectedTeam: Boolean(selectedTeam),
          settingsBusy,
          teamDefaultApprovalPolicy,
          approvalPolicyLabels,
          teamDefaultCodexModel,
          defaultCodexModel,
          codexModelOptions,
          teamDefaultBrowserProfilePersistent,
          teamDefaultInviteApprovalGate,
          message: appConfigMessage ?? settingsMessage ?? visibleHistoryMessage,
          onChooseProject: chooseProjectPath,
          onRelayHttpDraftChange: setRelayHttpDraft,
          onRelayWsDraftChange: setRelayWsDraft,
          onResetRelay: resetRelayConfiguration,
          onSaveRelay: saveRelayConfiguration,
          onToggleRoomMode: toggleRoomMode,
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
          onTeamDefaultInviteApprovalGateChange: updateTeamDefaultInviteApprovalGate,
          onApplyTeamDefaultsToRoom: applyTeamDefaultsToRoom
        }}
        onClose={() => setActiveSidebarPanel(null)}
      />

      <RoomMainColumn
        headerProps={{
          teams: teams.map((team) => ({ id: team.id, name: team.name })),
          selectedTeamId: selectedTeam,
          roomName: selectedRoom.name,
          hostStatus: selectedRoom.hostStatus,
          hostBusy,
          isActiveHost,
          roomLocked: isSelectedRoomLocked,
          hasRoom: hasSelectedRoom,
          selectedModel: selectedCodexModel,
          modelLabel: formatCodexModel(selectedCodexModel),
          modelOptions: codexModelOptions,
          settingsBusy,
          selectedCount: selectedMessages.length,
          markdownSelectionMode,
          activeInspectorTab: inspectorTab,
          onSetHost: setRoomHost,
          onRenameRoom: renameRoom,
          onSelectModel: setCodexModel,
          onCopyRoomMarkdown: copyRoomMarkdown,
          onCopySelectedMarkdown: copySelectedMessagesMarkdown,
          onToggleMarkdownSelection: toggleMarkdownSelectionMode,
          onClearSelectedMessages: clearSelectedMessages,
          onShareLocalPreview: openLocalPreviewDialog,
          ...roomHeaderActions
        }}
        statusProps={{
          notices: roomNotices,
          secretWarningVisible,
          lockedMessage: isSelectedRoomLocked ? roomLockMessage(selectedRoom, isSelectedRoomRevoked) : null,
          onAcknowledgeSecretWarning: acknowledgeRoomVisibilityWarning
        }}
        markdownFallbackProps={markdownCopyFallback ? {
          title: markdownCopyFallback.title,
          markdown: markdownCopyFallback.markdown,
          onRetryCopy: () => copyMarkdownWithFallback(
            markdownCopyFallback.title,
            markdownCopyFallback.markdown,
            (message) => setChatMessageForRoom(selectedRoom.id, message),
            selectedRoom.id
          ),
          onDismiss: () => setMarkdownCopyFallbackForRoom(selectedRoom.id, null)
        } : null}
        chatProps={{
          messages: chatMessageRows,
          approvalVisible,
          approvalSummary: codexApprovalSummaryDisplay,
          isActiveHost,
          codexRunning,
          canApproveCodex: hasSelectedRoom && canApproveCodexTurn(selectedRoom, localUser, isSelectedRoomLocked),
          canUseChat: roomCanUseChat,
          canSendMessage: roomCanUseChat && (Boolean(draft.trim()) || pendingAttachments.length > 0),
          roomLocked: isSelectedRoomLocked,
          lockedPlaceholder: roomLockMessage(selectedRoom, isSelectedRoomRevoked),
          chatEnabled: selectedRoom.mode.chat,
          draft,
          pendingAttachments: pendingAttachmentRows,
          localPreviewCards,
          pendingAttachmentSummary,
          markdownSelectionMode,
          onToggleMessageSelection: toggleMessageSelection,
          onRemovePendingAttachment: removePendingAttachment,
          onSendMessage: sendMessage,
          ...roomChatPanelActions
        }}
      />

      <ShellResizer
        side="right"
        collapsed={inspectorCollapsed}
        expandLabel="Expand context column"
        collapseLabel="Collapse context column"
        onBeginResize={(event) => beginShellResize("inspector", event)}
        onToggleCollapsed={toggleInspectorCollapsed}
      />

      <RoomInspectorPanel
        activeTab={inspectorTab}
        browserPanel={(
          <BrowserAccessPanel
            hidden={inspectorTab !== "browser"}
            activeBrowserUrl={activeBrowserUrl}
            browserUrl={browserUrl}
            canHostBrowser={canHostBrowser}
            onBrowserUrlChange={(url) => setBrowserUrlForRoom(selectedRoom.id, url)}
            onOpenBrowserNow={openRoomBrowserNow}
          />
        )}
        workPanel={(
          <RoomInspectorWorkPanel
            project={{
              projectPath: selectedRoom.projectPath,
              projectPathDraft,
              branchLabel: gitStatus?.branch ?? "loading",
              disabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost,
              attachDisabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost || !projectPathDraft.trim() || projectPathDraft.trim() === selectedRoom.projectPath,
              onProjectPathDraftChange: (path) => setProjectPathDraftForRoom(selectedRoom.id, path),
              onChooseProjectPath: chooseProjectPath,
              onUseDefaultProjectPath: () => setProjectPathDraftForRoom(selectedRoom.id, defaultProjectPath),
              onUpdateProjectPath: updateProjectPath
            }}
            teamRoster={{
              members: selectedTeamMemberRows,
              hasSelectedTeam: Boolean(selectedTeam),
              busy: selectedTeamMembersBusy,
              message: selectedTeamMembersMessage,
              onPromote: (member) => changeTeamMemberRole(member, "admin"),
              onDemote: (member) => changeTeamMemberRole(member, "member"),
              onTransferOwnership: transferOwnershipToTeamMember,
              onRemove: removeMemberFromTeam
            }}
            roomMembers={{
              members: roomMemberRows,
              localDeviceId: deviceId,
              message: deviceIdentityMessage,
              onCopyFingerprint: (member) => copyRoomMemberDeviceFingerprint(member, member.trusted),
              onTrust: trustRoomMemberDevice,
              onUntrust: untrustRoomMemberDevice
            }}
            hostHandoff={{
              handoffs: hostHandoffs,
              acceptDisabled: !hasSelectedRoom || isSelectedRoomLocked || hostBusy,
              onAcceptHandoff: acceptHostHandoff,
              formatModel: formatCodexModel
            }}
            encryptedInvite={{
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
            }}
            approvalPolicy={{
              selectedPolicy: selectedRoom.approvalPolicy,
              labels: approvalPolicyLabels,
              disabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost,
              message: settingsMessage,
              onSelectPolicy: setApprovalPolicy
            }}
            roomMode={{
              mode: selectedRoom.mode,
              labels: roomModeLabels,
              disabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost,
              onToggleMode: toggleRoomMode
            }}
            model={{
              selectedModel: selectedCodexModel,
              selectedModelLabel: formatCodexModel(selectedCodexModel),
              customModel: customCodexModel,
              modelOptions: codexModelOptions,
              disabled: !hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost,
              canApplyCustomModel: Boolean(customCodexModel.trim()) && customCodexModel.trim() !== selectedCodexModel,
              onSelectModel: setCodexModel,
              onCustomModelChange: (model) => setCustomCodexModelForRoom(selectedRoom.id, model),
              onApplyCustomModel: () => setCodexModel(customCodexModel)
            }}
            localHistory={{
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
            }}
            workspaceFiles={{
              fileQuery,
              projectFiles,
              selectedFile,
              gitStatus,
              selectedDiff,
              fileBusy,
              fileMessage,
              canReadLocalWorkspace,
              canAttachSelectedFile: canStageRoomChatAttachment(selectedRoom, isSelectedRoomLocked),
              selectedFileRisks,
              selectedFileNeedsAttachmentReview,
              selectedSensitiveFileReviewed,
              selectedAttachmentActionLabel: selectedAttachmentReview?.actionLabel ?? "Attach",
              selectedAttachmentWarningDetail: selectedAttachmentReview?.warningDetail ?? undefined,
              filePreviewTab,
              formatBytes,
              ...workspaceFilesPanelActions
            }}
            gitHandoff={{
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
            }}
            githubActions={{
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
              formatTimestamp,
              onRefresh: () => refreshGitHubActions()
            }}
            terminal={{
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
              canApproveTerminal: canReadLocalWorkspace && isActiveHost,
              ...terminalPanelActions
            }}
          />
        )}
      />
      {localPreviewDialog.open && (
        <LocalPreviewDialog
          dialog={localPreviewDialog}
          busy={localPreviewBusy}
          disclaimer={quickTunnelDisclaimer}
          safetyText={quickTunnelSafetyText}
          onClose={() => setLocalPreviewDialog((current) => ({ ...current, open: false }))}
          onSelectedUrlChange={(selectedUrl) => setLocalPreviewDialog((current) => ({ ...current, selectedUrl }))}
          onManualUrlChange={(manualUrl) => setLocalPreviewDialog((current) => ({ ...current, manualUrl }))}
          onBackToSelect={() => setLocalPreviewDialog((current) => ({ ...current, phase: "select" }))}
          onContinue={() => void prepareLocalPreviewConfirmation()}
          onStartSharing={() => void confirmLocalPreviewShare()}
        />
      )}
    </div>
  );
}
