import { useMemo, useRef, useState } from "react";
import type {
  ChatPlaintextPayload,
  ChatReactionPlaintextPayload,
  CodexTurnSummary,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  LocalPreviewPlaintextPayload,
  RelayEnvelope,
  RoomRecord,
  TeamMemberRecord,
  TeamRecord,
  ApprovalPolicy
} from "@multaiplayer/protocol";
import {
  codexModelOptions,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
} from "@multaiplayer/protocol";
import {
  decryptJson,
  encryptJson,
} from "@multaiplayer/crypto";
import {
  loadHistorySettings,
  loadOrCreateRoomSecret,
  type LocalHistorySettings
} from "./lib/localHistory";
import { loadTeamRoomDefaults } from "./lib/teamRoomDefaults";
import type { DeviceIdentity } from "./lib/deviceIdentity";
import {
  loadTrustedDeviceKeys,
  type TrustedDeviceKey
} from "./lib/deviceTrust";
import {
  defaultProjectPath,
  getGitStatus,
  runCodexTurn,
  runGitWorkflow,
  type CodexProbe,
  type GitDiffResult,
  type GitWorkflowResult,
  type GitStatusSummary,
  type ProjectFileContent,
  type ProjectFileEntry,
  type TerminalSnapshot
} from "./lib/localBackend";
import {
  createPullRequest,
  type GitHubActionRun,
} from "./lib/authClient";
import type { RelayClient } from "./lib/relayClient";
import {
  updateRoomHost
} from "./lib/workspaceClient";
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
import {
  canApproveCodexTurn,
  shouldAutoApproveChatOnlyTurn
} from "./lib/codexApproval";
import { buildCodexApprovalSnapshot, buildCodexTurnInput, buildCodexTurnSummary } from "./lib/codexTurn";
import { normalizeCodexThreadId } from "./lib/codexThread";
import { buildPullRequestBody } from "./lib/markdownExport";
import {
  normalizeRoomName
} from "./lib/workspaceCreation";
import { canControlRoomTerminal } from "./lib/terminalAccess";
import { canHostBrowserAction } from "./lib/browserPolicy";
import { attachmentReviewScopeKey } from "./lib/attachmentPolicy";
import { canUseLocalWorkspace } from "./lib/workspaceAccess";
import { shouldApplyRoomScopedUiUpdate } from "./lib/roomScopedUi";
import { canStageRoomChatAttachment, canUseRoomChat, roomChatGateMessage } from "./lib/chatPolicy";
import { extractCodexBrowserOpenUrl, messageInvokesCodex } from "./lib/codexInvoke";
import { classifyCodexFailure, codexUsageLimitMessage } from "./lib/codexFailure";
import type { FilePreviewTab } from "./lib/filePreview";
import type { GitHubActionsTarget } from "./lib/githubWorkflowReadiness";
import {
  gitWorkflowInFlightMessage,
  isGitWorkflowInFlight,
  type GitWorkflowDraft
} from "./lib/gitWorkflowDraft";
import { ensureRoomDefaults } from "./lib/roomDefaults";
import { omitRecordKey } from "./lib/setUtils";
import { roomLockMessage, roomSecretStorageLabel } from "./lib/appRuntime";
import {
  embeddedAttachmentBytes,
  encodedBytes,
  attachmentTypeFromName,
  formatBytes,
  formatCodexModel,
  formatMessageTime,
  formatSessionPersistence,
  formatTimestamp,
  validatePendingAttachments
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
import {
  acknowledgeRoomVisibilityWarning as saveRoomVisibilityWarningAcknowledgement,
  hasAcknowledgedRoomVisibilityWarning
} from "./lib/roomVisibilityWarning";
import { InlineSecretWarning } from "./components/common";
import { ShellResizer, SidebarDrawer } from "./components/AppShellLayout";
import { ModelPanel } from "./components/ModelPanel";
import { RoomModePanel } from "./components/RoomModePanel";
import { ApprovalPolicyPanel } from "./components/ApprovalPolicyPanel";
import { HostHandoffPanel } from "./components/HostHandoffPanel";
import { EncryptedInvitePanel } from "./components/EncryptedInvitePanel";
import { LocalHistoryPanel } from "./components/LocalHistoryPanel";
import { BrowserAccessPanel } from "./components/BrowserAccessPanel";
import { WorkspaceFilesPanel } from "./components/WorkspaceFilesPanel";
import { GitHubActionsPanel } from "./components/GitHubActionsPanel";
import { GitHandoffPanel } from "./components/GitHandoffPanel";
import { ProjectPanel } from "./components/ProjectPanel";
import { RoomMembersPanel, TeamRosterPanel } from "./components/RosterPanels";
import { TerminalPanel } from "./components/TerminalPanel";
import { ProfileDrawerPanel } from "./components/ProfileDrawerPanel";
import { RoomSettingsDrawerPanel } from "./components/RoomSettingsDrawerPanel";
import { DesktopSidebar } from "./components/DesktopSidebar";
import { RoomMainColumn } from "./components/RoomMainColumn";
import { RoomInspectorPanel, type InspectorTab } from "./components/RoomInspectorPanel";
import { LocalPreviewDialog } from "./components/LocalPreviewDialog";
import type {
  BrowserAccessRequest,
  BrowserStatus,
  ChatAttachment,
  ChatMessage,
  ChatReaction,
  CodexRoomEvent,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewDialogState,
  LocalPreviewRecord,
  MarkdownCopyFallback,
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
  const [teams, setTeams] = useState<TeamRecord[]>(seededTeams);
  const [rooms, setRooms] = useState<RoomRecord[]>(seededRooms);
  const [teamMembersByTeam, setTeamMembersByTeam] = useState<Record<string, TeamMemberRecord[]>>(seededTeamMembers);
  const [teamMembersMessageByTeam, setTeamMembersMessageByTeam] = useState<Record<string, string | null>>({});
  const [teamMembersBusyByTeam, setTeamMembersBusyByTeam] = useState<Record<string, boolean>>({});
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<SidebarPanel>(null);
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
  const [hostBusyByRoom, setHostBusyByRoom] = useState<Record<string, boolean>>({});
  const [hostMessagesByRoom, setHostMessagesByRoom] = useState<Record<string, string | null>>({});
  const [chatMessagesByRoom, setChatMessagesByRoom] = useState<Record<string, string | null>>({});
  const [settingsBusyByRoom, setSettingsBusyByRoom] = useState<Record<string, boolean>>({});
  const [settingsMessagesByRoom, setSettingsMessagesByRoom] = useState<Record<string, string | null>>({});
  const [customCodexModelsByRoom, setCustomCodexModelsByRoom] = useState<Record<string, string>>({});
  const [projectPathDraftsByRoom, setProjectPathDraftsByRoom] = useState<Record<string, string>>({});
  const [historySettings, setHistorySettings] = useState<LocalHistorySettings>({
    enabled: true,
    retentionDays: 30
  });
  const [teamHistorySettings, setTeamHistorySettings] = useState<LocalHistorySettings>({
    enabled: true,
    retentionDays: 30
  });
  const [teamDefaultApprovalPolicy, setTeamDefaultApprovalPolicy] = useState<ApprovalPolicy>(() =>
    loadTeamRoomDefaults(seededTeams[0].id).approvalPolicy
  );
  const [teamDefaultCodexModel, setTeamDefaultCodexModel] = useState(() =>
    loadTeamRoomDefaults(seededTeams[0].id).codexModel
  );
  const [teamDefaultBrowserProfilePersistent, setTeamDefaultBrowserProfilePersistent] = useState(() =>
    loadTeamRoomDefaults(seededTeams[0].id).browserProfilePersistent
  );
  const [teamDefaultInviteApprovalGate, setTeamDefaultInviteApprovalGate] = useState(() =>
    loadTeamRoomDefaults(seededTeams[0].id).inviteApprovalGate
  );
  const [historyMessagesByRoom, setHistoryMessagesByRoom] = useState<Record<string, string | null>>({});
  const [teamHistoryMessagesByTeam, setTeamHistoryMessagesByTeam] = useState<Record<string, string | null>>({});
  const [newTeamName, setNewTeamName] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomProjectPath, setNewRoomProjectPath] = useState(defaultProjectPath);
  const [selectedTeam, setSelectedTeam] = useState(seededTeams[0].id);
  const [selectedRoomId, setSelectedRoomId] = useState("room-desktop");
  const [inspectorTabsByRoom, setInspectorTabsByRoom] = useState<Record<string, InspectorTab>>({});
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, ChatMessage[]>>(initialMessagesByRoom);
  const [forgottenRoomIds, setForgottenRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedRoomIds, setRevokedRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedTeamIds, setRevokedTeamIds] = useState<Set<string>>(() => new Set());
  const [presenceByRoom, setPresenceByRoom] = useState<Record<string, Record<string, RoomPresence>>>({});
  const [hostHandoffsByRoom, setHostHandoffsByRoom] = useState<Record<string, HostHandoffRecord[]>>({});
  const [codexContinuationByRoom, setCodexContinuationByRoom] = useState<Record<string, HostHandoffRecord>>({});
  const [inviteRequestsByRoom, setInviteRequestsByRoom] = useState<Record<string, InviteJoinRequest[]>>({});
  const [codexEventsByRoom, setCodexEventsByRoom] = useState<Record<string, CodexRoomEvent[]>>({});
  const [gitWorkflowEventsByRoom, setGitWorkflowEventsByRoom] = useState<Record<string, GitWorkflowEventPlaintextPayload[]>>({});
  const [githubActionsEventsByRoom, setGitHubActionsEventsByRoom] = useState<Record<string, GitHubActionsEventPlaintextPayload[]>>({});
  const [localPreviewsByRoom, setLocalPreviewsByRoom] = useState<Record<string, LocalPreviewRecord[]>>({});
  const [localPreviewDialog, setLocalPreviewDialog] = useState<LocalPreviewDialogState>({
    open: false,
    phase: "select",
    roomId: "",
    candidates: [],
    selectedUrl: "",
    manualUrl: "",
    error: null,
    cloudflaredVersion: null
  });
  const [localPreviewBusyByRoom, setLocalPreviewBusyByRoom] = useState<Record<string, boolean>>({});
  const [draftsByRoom, setDraftsByRoom] = useState<Record<string, string>>({});
  const [pendingAttachmentsByRoom, setPendingAttachmentsByRoom] = useState<Record<string, ChatAttachment[]>>({});
  const [approvalVisibleByRoom, setApprovalVisibleByRoom] = useState<Record<string, boolean>>({});
  const [pendingCodexApprovalsByRoom, setPendingCodexApprovalsByRoom] = useState<Record<string, PendingCodexApproval>>({});
  const [codexRunningByRoom, setCodexRunningByRoom] = useState<Record<string, boolean>>({});
  const [secretWarningsVisibleByRoom, setSecretWarningsVisibleByRoom] = useState<Record<string, boolean>>({});
  const [gitStatusByRoom, setGitStatusByRoom] = useState<Record<string, GitStatusSummary | null>>({});
  const [codexProbe, setCodexProbe] = useState<CodexProbe | null>(null);
  const [terminalLinesByRoom, setTerminalLinesByRoom] = useState<Record<string, string[]>>(initialTerminalLinesByRoom);
  const [terminalBusyByRoom, setTerminalBusyByRoom] = useState<Record<string, boolean>>({});
  const [terminals, setTerminals] = useState<TerminalSnapshot[]>([]);
  const [terminalRequestsByRoom, setTerminalRequestsByRoom] = useState<Record<string, TerminalCommandRequest[]>>({});
  const [selectedTerminalIdsByRoom, setSelectedTerminalIdsByRoom] = useState<Record<string, string | null>>({});
  const [terminalNamesByRoom, setTerminalNamesByRoom] = useState<Record<string, string>>({});
  const [terminalCommandsByRoom, setTerminalCommandsByRoom] = useState<Record<string, string>>({});
  const [terminalInputsByRoom, setTerminalInputsByRoom] = useState<Record<string, string>>({});
  const [terminalErrorsByRoom, setTerminalErrorsByRoom] = useState<Record<string, string | null>>({});
  const terminalAutoOpenedRoomsRef = useRef<Set<string>>(new Set());
  const [browserRequestsByRoom, setBrowserRequestsByRoom] = useState<Record<string, BrowserAccessRequest[]>>({});
  const [browserUrlsByRoom, setBrowserUrlsByRoom] = useState<Record<string, string>>({});
  const [browserReasonsByRoom, setBrowserReasonsByRoom] = useState<Record<string, string>>({});
  const [browserMessagesByRoom, setBrowserMessagesByRoom] = useState<Record<string, string | null>>({});
  const [browserStatusByRoom, setBrowserStatusByRoom] = useState<Record<string, BrowserStatus>>({});
  const [activeBrowserUrlsByRoom, setActiveBrowserUrlsByRoom] = useState<Record<string, string | null>>({});
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("closed");
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceIdentityMessage, setDeviceIdentityMessage] = useState<string | null>(null);
  const [trustedDeviceKeys, setTrustedDeviceKeys] = useState<TrustedDeviceKey[]>(() => loadTrustedDeviceKeys());
  const [gitWorkflowBusyByRoom, setGitWorkflowBusyByRoom] = useState<Record<string, boolean>>({});
  const [gitWorkflowMessagesByRoom, setGitWorkflowMessagesByRoom] = useState<Record<string, string | null>>({});
  const [actionsBusyByRoom, setActionsBusyByRoom] = useState<Record<string, boolean>>({});
  const [actionsMessagesByRoom, setActionsMessagesByRoom] = useState<Record<string, string | null>>({});
  const [actionRunsByRoom, setActionRunsByRoom] = useState<Record<string, GitHubActionRun[]>>({});
  const [actionsLastCheckedByRoom, setActionsLastCheckedByRoom] = useState<Record<string, string | null>>({});
  const [gitWorkflowDraftsByRoom, setGitWorkflowDraftsByRoom] = useState<Record<string, Partial<GitWorkflowDraft>>>({});
  const [fileQueriesByRoom, setFileQueriesByRoom] = useState<Record<string, string>>({});
  const [projectFilesByRoom, setProjectFilesByRoom] = useState<Record<string, ProjectFileEntry[]>>({});
  const [selectedFilesByRoom, setSelectedFilesByRoom] = useState<Record<string, ProjectFileContent | null>>({});
  const [selectedDiffsByRoom, setSelectedDiffsByRoom] = useState<Record<string, GitDiffResult | null>>({});
  const [filePreviewTabsByRoom, setFilePreviewTabsByRoom] = useState<Record<string, FilePreviewTab>>({});
  const [fileBusyByRoom, setFileBusyByRoom] = useState<Record<string, boolean>>({});
  const [fileMessagesByRoom, setFileMessagesByRoom] = useState<Record<string, string | null>>({});
  const [markdownCopyFallbacksByRoom, setMarkdownCopyFallbacksByRoom] = useState<Record<string, MarkdownCopyFallback | null>>({});
  const [historySearchMessagesByRoom, setHistorySearchMessagesByRoom] = useState<Record<string, ChatMessage[]>>({});
  const [historySearchBusy, setHistorySearchBusy] = useState(false);
  const [sensitiveAttachmentReviewKey, setSensitiveAttachmentReviewKey] = useState<string | null>(null);
  const [inviteSecretInput, setInviteSecretInput] = useState("");
  const [inviteLinksByRoom, setInviteLinksByRoom] = useState<Record<string, string>>({});
  const [inviteApprovalGatesByRoom, setInviteApprovalGatesByRoom] = useState<Record<string, boolean>>({});
  const [inviteMessagesByRoom, setInviteMessagesByRoom] = useState<Record<string, string | null>>({});
  const [keyRotationBusyByRoom, setKeyRotationBusyByRoom] = useState<Record<string, boolean>>({});
  const [inviteAdmissionsByRoom, setInviteAdmissionsByRoom] = useState<Record<string, string>>({});
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

  async function sendMessage() {
    if (!hasSelectedRoom) {
      setSelectedChatMessage("Create or join a room before sending messages.");
      return;
    }
    const roomId = selectedRoom.id;
    if (isSelectedRoomLocked) {
      setChatMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!canUseRoomChat(selectedRoom)) {
      setChatMessageForRoom(roomId, roomChatGateMessage(selectedRoom));
      return;
    }
    const attachments = pendingAttachments;
    const body = draft.trim();
    if (!body && attachments.length === 0) return;
    const attachmentError = validatePendingAttachments(attachments);
    if (attachmentError) {
      setChatMessageForRoom(roomId, attachmentError);
      return;
    }
    const invokesCodex = messageInvokesCodex(body);
    const createdAt = new Date().toISOString();
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      author: localUser.name,
      role: invokesCodex ? "system" : "human",
      body: body || "Attached files.",
      time: formatMessageTime(createdAt),
      createdAt,
      attachments: attachments.length ? attachments : undefined
    };
    await publishChatMessage(message);
    if (invokesCodex) {
      if (!handleCodexBrowserOpenCommand(message, selectedRoom)) handleCodexInvoke(message);
    }
    setDraftForRoom(roomId, "");
    setPendingAttachmentsForRoom(roomId, []);
  }

  function handleCodexInvoke(pendingMessage?: ChatMessage) {
    if (!hasSelectedRoom) {
      setSelectedHostMessage("Create or join a room before invoking Codex.");
      return;
    }
    const roomId = selectedRoom.id;
    if (isSelectedRoomLocked) {
      setHostMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (!canUseRoomChat(selectedRoom)) {
      setHostMessageForRoom(roomId, roomChatGateMessage(selectedRoom));
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (!selectedRoom.mode.code) {
      setHostMessageForRoom(roomId, "Code mode is disabled for this room.");
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (selectedRoom.approvalPolicy === "never_host") {
      setHostMessageForRoom(roomId, "This room is set to never host Codex turns.");
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    const approvalSnapshot = buildCodexApprovalSnapshot(selectedRoom, messages, pendingMessage, roomTerminals, browserRequests, gitStatus, {
      includeWorkspaceContext: canReadLocalWorkspace
    });
    if (selectedRoom.approvalPolicy === "auto_chat_only") {
      if (shouldAutoApproveChatOnlyTurn(approvalSnapshot.summary, isActiveHost)) {
        setPendingCodexApprovalForRoom(roomId, null);
        setApprovalVisibleForRoom(roomId, false);
        setHostMessageForRoom(roomId, "Auto-approved chat-only Codex turn.");
        approveCodexTurn(approvalSnapshot).catch((error) => {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHostMessageForRoom(roomId, String(error));
        });
        return;
      }
      setPendingCodexApprovalForRoom(roomId, approvalSnapshot);
      setApprovalVisibleForRoom(roomId, true);
      setHostMessageForRoom(
        roomId,
        isActiveHost
          ? "This turn includes workspace, browser, terminal, or attachment context, so host approval is required."
          : hostGateMessage
      );
      return;
    }
    setPendingCodexApprovalForRoom(roomId, approvalSnapshot);
    setApprovalVisibleForRoom(roomId, true);
  }

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
  async function approveCodexTurn(approval: PendingCodexApproval | null = activeCodexApproval) {
    const roomId = approval?.roomId ?? selectedRoom.id;
    const room = roomsRef.current.find((item) => item.id === roomId);
    if (!room) {
      setHostMessageForRoom(roomId, "This Codex approval belongs to a room that is no longer available.");
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    const roomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const roomLocked = forgottenRoomIds.has(room.id) || roomRevoked;
    const roomCanReadLocalWorkspace = canUseLocalWorkspace(room, localUser, roomLocked);
    if (roomLocked) {
      setHostMessageForRoom(roomId, roomLockMessage(room, roomRevoked));
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    const roomHostGateMessage =
      room.hostStatus === "active"
        ? `Only ${room.host} can approve host-side actions in this room.`
        : "Claim host before approving host-side actions in this room.";
    if (!room.mode.code) {
      setHostMessageForRoom(roomId, "Code mode is disabled for this room.");
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (room.approvalPolicy === "never_host") {
      setHostMessageForRoom(roomId, "This room is set to never host Codex turns.");
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    if (!canApproveCodexTurn(room, localUser, roomLocked)) {
      setHostMessageForRoom(roomId, roomHostGateMessage);
      setPendingCodexApprovalForRoom(roomId, null);
      setApprovalVisibleForRoom(roomId, false);
      return;
    }
    const turnMessages = approval?.messages ?? messagesByRoom[roomId] ?? [];
    const turnSummary = buildCodexTurnSummary(
      turnMessages,
      room,
      terminals.filter((terminal) => terminal.roomId === roomId),
      browserRequestsByRoom[roomId] ?? [],
      gitStatusByRoom[roomId] ?? null,
      { includeWorkspaceContext: roomCanReadLocalWorkspace }
    );
    const model = room.codexModel ?? defaultCodexModel;
    const projectPath = room.projectPath;
    setPendingCodexApprovalForRoom(roomId, null);
    setApprovalVisibleForRoom(roomId, false);
    setCodexRunningForRoom(roomId, true);
    appendTerminalLinesForRoom(roomId, [
      "$ codex app-server",
      `Starting approved Codex turn with ${formatCodexModel(model)} from encrypted room context...`
    ]);

	    const turnId = crypto.randomUUID();
    const continuationHandoff = codexContinuationByRoom[roomId] ?? null;
	    const input = buildCodexTurnInput(turnMessages, projectPath, model, turnSummary, {
      fullRoomContext: Boolean(continuationHandoff)
    });
    const previousThreadId = codexThreadIdsByRoom[roomId] ?? null;
    try {
      await publishCodexEvent({
        turnId,
        status: "started",
        message: previousThreadId
          ? `Resuming Codex thread ${previousThreadId} with ${formatCodexModel(model)}.`
          : `Started Codex turn with ${formatCodexModel(model)}.`,
        model
      }, room);
      const result = await runCodexTurn(projectPath, input, model, previousThreadId);
      if (classifyCodexFailure([result.status, result.stderr, result.transcript, ...result.events]) === "usage_limit") {
        await handleCodexUsageLimit(room, turnId, model, turnMessages, result.events, result.stderr);
        return;
      }
      const threadId = normalizeCodexThreadId(result.threadId);
      if (threadId) {
        setCodexThreadIdsByRoom((current) => ({
          ...current,
          [roomId]: threadId
        }));
      }
      for (const eventName of result.events.slice(-16)) {
        await publishCodexEvent({
          turnId,
          status: "event",
          message: eventName,
          eventName,
          model,
          ...(threadId ? { threadId } : {})
        }, room);
      }
      await publishCodexEvent({
        turnId,
        status: "completed",
        message: `Codex turn finished with status: ${result.status}.`,
        model,
        ...(threadId ? { threadId } : {})
      }, room);
      const body =
        result.transcript.trim() ||
        `Codex turn finished with status: ${result.status}. Events: ${result.events.slice(0, 8).join(", ")}`;
      await publishChatMessage({
        id: crypto.randomUUID(),
        author: `Codex via ${localUser.name}`,
        role: "codex",
        body,
        time: formatMessageTime(),
        createdAt: new Date().toISOString()
      }, room);
      appendTerminalLinesForRoom(roomId, [
        `Codex status: ${result.status}`,
        `Codex thread: ${result.threadId ?? "unknown"}`,
        ...result.events.slice(-8).map((event) => `event: ${event}`),
        ...(result.stderr ? [`stderr: ${result.stderr}`] : [])
      ]);
    } catch (error) {
      if (classifyCodexFailure([String(error)]) === "usage_limit") {
        await handleCodexUsageLimit(room, turnId, model, turnMessages, [String(error)], String(error));
        return;
      }
      await publishCodexEvent({
        turnId,
        status: "failed",
        message: String(error),
        model
      }, room);
      await publishChatMessage({
        id: crypto.randomUUID(),
        author: `Codex via ${localUser.name}`,
        role: "codex",
        body: `Codex could not start from this host: ${String(error)}`,
        time: formatMessageTime(),
        createdAt: new Date().toISOString()
      }, room);
      appendTerminalLinesForRoom(roomId, [`Codex error: ${String(error)}`]);
    } finally {
      if (continuationHandoff) {
        setCodexContinuationByRoom((current) => omitRecordKey(current, roomId));
      }
      setCodexRunningForRoom(roomId, false);
    }
  }

  async function handleCodexUsageLimit(
    room: RoomRecord,
    turnId: string,
    model: string,
    turnMessages: ChatMessage[],
    events: string[],
    stderr: string
  ) {
    const roomId = room.id;
    await publishCodexEvent({
      turnId,
      status: "failed",
      message: codexUsageLimitMessage(room.host),
      model
    }, room);
    appendTerminalLinesForRoom(roomId, [
      codexUsageLimitMessage(room.host),
      ...events.slice(-4).map((event) => `event: ${event}`),
      ...(stderr ? [`stderr: ${stderr}`] : [])
    ]);
    await publishChatMessage({
      id: crypto.randomUUID(),
      author: "multAIplayer",
      role: "system",
      body: `${codexUsageLimitMessage(room.host)} Click Continue with another host in the room panel to keep going from this room context.`,
      time: formatMessageTime(),
      createdAt: new Date().toISOString()
    }, room);
    try {
      const handedOff = await updateRoomHost(roomId, room.host, room.hostUserId ?? localUser.id, "handoff");
      setRooms((current) => current.map((item) => (item.id === handedOff.id ? ensureRoomDefaults(handedOff) : item)));
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setHostMessageForRoom(roomId, `Codex usage is unavailable, but host handoff could not update room host status: ${String(error)}`);
      }
    }
    await publishHostHandoff(room, "usage_limit", turnMessages);
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
      setHostMessageForRoom(roomId, codexUsageLimitMessage(room.host));
    }
  }

  async function publishChatMessage(message: ChatMessage, room: RoomRecord = selectedRoom) {
    const revoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    if (forgottenRoomIds.has(room.id) || revoked) {
      setChatMessageForRoom(room.id, roomLockMessage(room, revoked));
      return;
    }
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      appendRoomMessage(room.id, message);
      return;
    }

    const secret = await loadOrCreateRoomSecret(room.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: new Date().toISOString(),
      kind: "chat.message",
      payload: await encryptJson(message satisfies ChatPlaintextPayload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
    appendRoomMessage(room.id, message);
  }

  async function toggleMessageReaction(message: ChatMessage, emoji: string) {
    if (!hasSelectedRoom) {
      setSelectedChatMessage("Create or join a room before reacting to messages.");
      return;
    }
    const roomId = selectedRoom.id;
    if (isSelectedRoomLocked) {
      setChatMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!canUseRoomChat(selectedRoom)) {
      setChatMessageForRoom(roomId, roomChatGateMessage(selectedRoom));
      return;
    }
    const hasReacted = message.reactions
      ?.find((reaction) => reaction.emoji === emoji)
      ?.reactors.some((reactor) => reactor.userId === localUser.id) ?? false;
    const payload: ChatReactionPlaintextPayload = {
      id: crypto.randomUUID(),
      messageId: message.id,
      emoji,
      action: hasReacted ? "remove" : "add",
      reactor: localUser.name,
      reactorUserId: localUser.id,
      createdAt: new Date().toISOString()
    };
    applyMessageReaction(roomId, payload);

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      setChatMessageForRoom(roomId, "Saved reaction locally because the relay is not connected.");
      return;
    }
    const secret = await loadOrCreateRoomSecret(roomId);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: selectedRoom.teamId,
      roomId,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.createdAt,
      kind: "chat.reaction",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  function acknowledgeRoomVisibilityWarning() {
    if (!hasSelectedRoom) {
      return;
    }
    saveRoomVisibilityWarningAcknowledgement(selectedRoom.id);
    setSecretWarningVisibleForRoom(selectedRoom.id, false);
  }

  async function approveGitWorkflow() {
    if (!hasSelectedRoom) {
      setSelectedGitWorkflowMessage("Create or join a room before approving a git workflow.");
      return;
    }
    if (!isActiveHost) {
      setSelectedGitWorkflowMessage(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedGitWorkflowMessage(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    if (isGitWorkflowInFlight(gitWorkflowBusyRef.current, roomId)) {
      setGitWorkflowMessageForRoom(roomId, gitWorkflowInFlightMessage());
      return;
    }
    const projectPath = room.projectPath;
    const workflowDraft = gitWorkflowDraft;
    if (!gitApprovalPreview.plan) {
      setGitWorkflowMessageForRoom(roomId, gitApprovalPreview.error ?? "Git workflow approval preview is invalid.");
      return;
    }
    if (workflowDraft.pushEnabled && !githubWorkflowReadiness.ready) {
      setGitWorkflowMessageForRoom(roomId, githubWorkflowReadiness.messages.join(" "));
      return;
    }
    const gitPlan = gitApprovalPreview.plan;
    const normalizedPrBase = workflowDraft.pushEnabled ? githubWorkflowReadiness.normalizedBase : gitApprovalPreview.normalizedBase;
    setGitWorkflowBusyForRoom(roomId, true);
    setGitWorkflowMessageForRoom(roomId, null);
    appendTerminalLinesForRoom(roomId, [
      `Approve git workflow: branch=${gitPlan.branch}, push=${gitPlan.push}`,
      ...gitPlan.approvals.flatMap((approval) => approval.commands.map((command) => `$ ${command}`))
    ]);
    publishGitWorkflowEvent({
      status: "started",
      branch: gitPlan.branch,
      push: gitPlan.push,
      message: `Started Git workflow on ${gitPlan.branch}.`
    }, room).catch((error) => {
      console.warn("Failed to publish git workflow start", error);
    });
    try {
      const results = await runGitWorkflow(
        gitPlan.cwd,
        gitPlan.branch,
        gitPlan.message,
        gitPlan.push
      );
      appendTerminalLinesForRoom(roomId, [
        ...results
          .flatMap((result) => [
            `$ ${result.command}`,
            result.stdout.trim(),
            result.stderr.trim()
          ])
          .filter(Boolean)
      ]);

      const failed = results.find((result) => result.status !== 0);
      if (failed) {
        const message = `Stopped after failed command: ${failed.command}`;
        setGitWorkflowMessageForRoom(roomId, message);
        publishGitWorkflowEvent({
          status: "failed",
          branch: gitPlan.branch,
          push: gitPlan.push,
          message,
          results
        }, room).catch((error) => {
          console.warn("Failed to publish git workflow failure", error);
        });
        return;
      }

      if (gitPlan.push) {
        const pr = await createPullRequest({
          owner: workflowDraft.prOwner,
          repo: workflowDraft.prRepo,
          title: gitPlan.message,
          body: buildPullRequestBody(messages, gitStatus?.files ?? []),
          head: gitPlan.branch,
          base: normalizedPrBase,
          draft: true
        });
        const message = `Opened draft PR #${pr.number}: ${pr.url}`;
        setGitWorkflowMessageForRoom(roomId, message);
        publishGitWorkflowEvent({
          status: "pr_opened",
          branch: gitPlan.branch,
          push: gitPlan.push,
          message,
          results,
          pullRequest: {
            number: pr.number,
            url: pr.url
          }
        }, room).catch((error) => {
          console.warn("Failed to publish git workflow PR event", error);
        });
        refreshGitHubActions(room, {
          owner: workflowDraft.prOwner,
          repo: workflowDraft.prRepo,
          branch: gitPlan.branch
        });
      } else {
        const message = "Created local branch and commit. Enable push when you are ready to open a PR.";
        setGitWorkflowMessageForRoom(roomId, message);
        publishGitWorkflowEvent({
          status: "completed",
          branch: gitPlan.branch,
          push: gitPlan.push,
          message,
          results
        }, room).catch((error) => {
          console.warn("Failed to publish git workflow completion", error);
        });
      }

      const status = await getGitStatus(projectPath);
      setGitStatusForRoom(roomId, status);
    } catch (error) {
      const message = String(error);
      setGitWorkflowMessageForRoom(roomId, message);
      appendTerminalLinesForRoom(roomId, [`Git workflow error: ${message}`]);
      publishGitWorkflowEvent({
        status: "failed",
        branch: gitPlan?.branch ?? workflowDraft.branchName,
        push: gitPlan?.push ?? workflowDraft.pushEnabled,
        message
      }, room).catch((publishError) => {
        console.warn("Failed to publish git workflow error", publishError);
      });
    } finally {
      setGitWorkflowBusyForRoom(roomId, false);
    }
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

      {activeSidebarPanel && (
        <SidebarDrawer
          label={activeSidebarPanel === "profile" ? "Account" : "Room settings"}
          title={activeSidebarPanel === "profile" ? localUser.name : selectedRoom.name}
          onClose={() => setActiveSidebarPanel(null)}
        >
          {activeSidebarPanel === "profile" ? (
            <ProfileDrawerPanel
              currentUser={currentUser}
              authConfig={authConfig}
              authBusy={authBusy}
              authError={authError}
              deviceFlow={deviceFlow}
              deviceId={deviceId}
              deviceIdentity={deviceIdentity}
              deviceIdentityMessage={deviceIdentityMessage}
              relaySessionPersistence={formatSessionPersistence(authConfig?.sessionPersistence)}
              onRotateDeviceIdentity={rotateDeviceIdentity}
              onSignIn={beginGitHubSignIn}
              onSignOut={signOut}
            />
          ) : (
            <RoomSettingsDrawerPanel
              relaySummary={`${relayStatus} · ${appConfig.relayWsUrl}`}
              relayApi={appConfig.relayHttpUrl}
              codexSummary={codexProbe?.available ? codexProbe.version ?? "Available" : codexProbe?.error ?? "Not connected"}
              projectPath={selectedRoom.projectPath}
              modelLabel={formatCodexModel(selectedCodexModel)}
              approvalLabel={approvalPolicyLabels[selectedRoom.approvalPolicy]}
              roomKeysLabel={roomSecretStorageLabel()}
              posture={roomPosture}
              chooseProjectDisabled={!hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost}
              relayHttpDraft={relayHttpDraft}
              relayWsDraft={relayWsDraft}
              defaultRelayHttpUrl={defaultRelayHttpUrl}
              defaultRelayWsUrl={defaultRelayWsUrl}
              saveRelayDisabled={!relayHttpDraft.trim() || !relayWsDraft.trim()}
              roomMode={selectedRoom.mode}
              roomModeLabels={roomModeLabels}
              roomModesDisabled={!hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost}
              showRoomSettingsGate={!isActiveHost && hasSelectedRoom}
              roomSettingsGateMessage={roomSettingsGateMessage}
              historySettings={historySettings}
              teamHistorySettings={teamHistorySettings}
              hasSelectedRoom={hasSelectedRoom}
              selectedTeam={Boolean(selectedTeam)}
              settingsBusy={settingsBusy}
              teamDefaultApprovalPolicy={teamDefaultApprovalPolicy}
              approvalPolicyLabels={approvalPolicyLabels}
              teamDefaultCodexModel={teamDefaultCodexModel}
              defaultCodexModel={defaultCodexModel}
              codexModelOptions={codexModelOptions}
              teamDefaultBrowserProfilePersistent={teamDefaultBrowserProfilePersistent}
              teamDefaultInviteApprovalGate={teamDefaultInviteApprovalGate}
              message={appConfigMessage ?? settingsMessage ?? visibleHistoryMessage}
              onChooseProject={chooseProjectPath}
              onRelayHttpDraftChange={setRelayHttpDraft}
              onRelayWsDraftChange={setRelayWsDraft}
              onResetRelay={resetRelayConfiguration}
              onSaveRelay={saveRelayConfiguration}
              onToggleRoomMode={toggleRoomMode}
              onHistoryEnabledChange={(enabled) =>
                updateLocalHistorySettings({
                  ...historySettings,
                  enabled
                })
              }
              onHistoryRetentionDaysChange={(retentionDays) =>
                updateLocalHistorySettings({
                  ...historySettings,
                  retentionDays
                })
              }
              onClearRoomHistory={clearRoomHistory}
              onForgetRoomLocalData={forgetSelectedRoomLocalData}
              onTeamHistoryEnabledChange={(enabled) =>
                updateTeamHistoryDefaults({
                  ...teamHistorySettings,
                  enabled
                })
              }
              onTeamHistoryRetentionDaysChange={(retentionDays) =>
                updateTeamHistoryDefaults({
                  ...teamHistorySettings,
                  retentionDays
                })
              }
              onTeamDefaultApprovalPolicyChange={updateTeamDefaultApprovalPolicy}
              onTeamDefaultCodexModelChange={updateTeamDefaultCodexModel}
              onTeamDefaultBrowserProfilePersistentChange={setTeamDefaultBrowserProfilePersistent}
              onTeamDefaultInviteApprovalGateChange={updateTeamDefaultInviteApprovalGate}
              onApplyTeamDefaultsToRoom={applyTeamDefaultsToRoom}
            />
          )}
        </SidebarDrawer>
      )}

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
          onSelectTeam: (teamId) => {
            setSelectedTeam(teamId);
            setSelectedRoomId(rooms.find((room) => room.teamId === teamId)?.id ?? selectedRoomId);
          },
          onRenameRoom: renameRoom,
          onSelectModel: setCodexModel,
          onSelectInspectorTab: (tab) => {
            setInspectorTabsByRoom((current) => ({ ...current, [selectedRoom.id]: tab }));
            if (tab === "browser" && !activeBrowserUrl) openRoomBrowserNow();
          },
          onCopyRoomMarkdown: copyRoomMarkdown,
          onCopySelectedMarkdown: copySelectedMessagesMarkdown,
          onToggleMarkdownSelection: toggleMarkdownSelectionMode,
          onClearSelectedMessages: clearSelectedMessages,
          onShareLocalPreview: openLocalPreviewDialog
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
          onCopyMessageMarkdown: (messageId) => {
            const message = messages.find((item) => item.id === messageId);
            if (message) copyMessageMarkdown(message);
          },
          onCopyCodexOutputMarkdown: (messageId) => {
            const message = messages.find((item) => item.id === messageId);
            if (message) copyCodexOutputMarkdown(message);
          },
          onOpenAttachment: (messageId, attachmentId) => {
            const message = messages.find((item) => item.id === messageId);
            const attachment = message?.attachments?.find((item) => item.id === attachmentId);
            if (attachment) openEncryptedAttachmentBlob(attachment);
          },
          onToggleReaction: (messageId, emoji) => {
            const message = messages.find((item) => item.id === messageId);
            if (message) toggleMessageReaction(message, emoji);
          },
          onDenyApproval: () => {
            setPendingCodexApprovalForRoom(selectedRoom.id, null);
            setApprovalVisibleForRoom(selectedRoom.id, false);
          },
          onApproveApproval: () => approveCodexTurn(),
          onInvokeCodex: () => handleCodexInvoke(),
          onRemovePendingAttachment: removePendingAttachment,
          onOpenLocalPreview: (previewId) => {
            const preview = localPreviews.find((item) => item.id === previewId);
            if (preview?.publicUrl) window.open(preview.publicUrl, "_blank", "noopener,noreferrer");
          },
          onCopyLocalPreviewLink: (previewId) => {
            const preview = localPreviews.find((item) => item.id === previewId);
            if (preview?.publicUrl) {
              void copyMarkdownWithFallback("local preview link", preview.publicUrl, (message) => setChatMessageForRoom(selectedRoom.id, message), selectedRoom.id);
            }
          },
          onStopLocalPreview: (previewId) => void stopLocalPreview(previewId),
          onDraftChange: (nextDraft) => setDraftForRoom(selectedRoom.id, nextDraft),
          onSendMessage: sendMessage
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
          <>
        <ProjectPanel
          projectPath={selectedRoom.projectPath}
          projectPathDraft={projectPathDraft}
          branchLabel={gitStatus?.branch ?? "loading"}
          disabled={!hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost}
          attachDisabled={!hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost || !projectPathDraft.trim() || projectPathDraft.trim() === selectedRoom.projectPath}
          onProjectPathDraftChange={(path) => setProjectPathDraftForRoom(selectedRoom.id, path)}
          onChooseProjectPath={chooseProjectPath}
          onUseDefaultProjectPath={() => setProjectPathDraftForRoom(selectedRoom.id, defaultProjectPath)}
          onUpdateProjectPath={updateProjectPath}
        />

        <TeamRosterPanel
          members={selectedTeamMemberRows}
          hasSelectedTeam={Boolean(selectedTeam)}
          busy={selectedTeamMembersBusy}
          message={selectedTeamMembersMessage}
          onPromote={(member) => changeTeamMemberRole(member, "admin")}
          onDemote={(member) => changeTeamMemberRole(member, "member")}
          onTransferOwnership={transferOwnershipToTeamMember}
          onRemove={removeMemberFromTeam}
        />

        <RoomMembersPanel
          members={roomMemberRows}
          localDeviceId={deviceId}
          message={deviceIdentityMessage}
          onCopyFingerprint={(member) => copyRoomMemberDeviceFingerprint(member, member.trusted)}
          onTrust={trustRoomMemberDevice}
          onUntrust={untrustRoomMemberDevice}
        />

        <HostHandoffPanel
          handoffs={hostHandoffs}
          acceptDisabled={!hasSelectedRoom || isSelectedRoomLocked || hostBusy}
          onAcceptHandoff={acceptHostHandoff}
          formatModel={formatCodexModel}
        />

        <EncryptedInvitePanel
          inviteApprovalGate={inviteApprovalGate}
          copyDisabled={!canCopyRoomInvite}
          inviteSecretInput={inviteSecretInput}
          inviteRequests={inviteRequests}
          localDeviceId={deviceId}
          gateDisabled={!hasSelectedRoom || isSelectedRoomLocked}
          importDisabled={!inviteSecretInput.trim()}
          rotateDisabled={!hasSelectedRoom || isSelectedRoomLocked || !isActiveHost || keyRotationBusy}
          approvalDisabled={!hasSelectedRoom || isSelectedRoomLocked || !isActiveHost}
          keyRotationBusy={keyRotationBusy}
          inviteLink={inviteLink}
          inviteMessage={inviteMessage}
          onCopyInvite={copyInviteLink}
          onInviteApprovalGateChange={(enabled) => setInviteApprovalGateForRoom(selectedRoom.id, enabled)}
          onInviteSecretInputChange={setInviteSecretInput}
          onImportInvite={joinInviteSecret}
          onRotateRoomKey={rotateSelectedRoomKey}
          onDecideInviteRequest={decideInviteJoinRequest}
        />

        <ApprovalPolicyPanel
          selectedPolicy={selectedRoom.approvalPolicy}
          labels={approvalPolicyLabels}
          disabled={!hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost}
          message={settingsMessage}
          onSelectPolicy={setApprovalPolicy}
        />

        <RoomModePanel
          mode={selectedRoom.mode}
          labels={roomModeLabels}
          disabled={!hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost}
          onToggleMode={toggleRoomMode}
        />

        <ModelPanel
          selectedModel={selectedCodexModel}
          selectedModelLabel={formatCodexModel(selectedCodexModel)}
          customModel={customCodexModel}
          modelOptions={codexModelOptions}
          disabled={!hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost}
          canApplyCustomModel={Boolean(customCodexModel.trim()) && customCodexModel.trim() !== selectedCodexModel}
          onSelectModel={setCodexModel}
          onCustomModelChange={(model) => setCustomCodexModelForRoom(selectedRoom.id, model)}
          onApplyCustomModel={() => setCodexModel(customCodexModel)}
        />

        <LocalHistoryPanel
          historySettings={historySettings}
          teamHistorySettings={teamHistorySettings}
          selectedTeam={Boolean(selectedTeam)}
          hasSelectedRoom={hasSelectedRoom}
          settingsBusy={settingsBusy}
          teamDefaultApprovalPolicy={teamDefaultApprovalPolicy}
          approvalPolicyLabels={approvalPolicyLabels}
          teamDefaultCodexModel={teamDefaultCodexModel}
          defaultCodexModel={defaultCodexModel}
          codexModelOptions={codexModelOptions}
          teamDefaultBrowserProfilePersistent={teamDefaultBrowserProfilePersistent}
          teamDefaultInviteApprovalGate={teamDefaultInviteApprovalGate}
          message={visibleHistoryMessage}
          onHistoryEnabledChange={(enabled) =>
            updateLocalHistorySettings({
              ...historySettings,
              enabled
            })
          }
          onHistoryRetentionDaysChange={(retentionDays) =>
            updateLocalHistorySettings({
              ...historySettings,
              retentionDays
            })
          }
          onClearRoomHistory={clearRoomHistory}
          onForgetRoomLocalData={forgetSelectedRoomLocalData}
          onApplyTeamDefaultsToRoom={applyTeamDefaultsToRoom}
          onTeamHistoryEnabledChange={(enabled) =>
            updateTeamHistoryDefaults({
              ...teamHistorySettings,
              enabled
            })
          }
          onTeamHistoryRetentionDaysChange={(retentionDays) =>
            updateTeamHistoryDefaults({
              ...teamHistorySettings,
              retentionDays
            })
          }
          onTeamDefaultApprovalPolicyChange={updateTeamDefaultApprovalPolicy}
          onTeamDefaultCodexModelChange={updateTeamDefaultCodexModel}
          onTeamDefaultBrowserProfilePersistentChange={setTeamDefaultBrowserProfilePersistent}
          onTeamDefaultInviteApprovalGateChange={updateTeamDefaultInviteApprovalGate}
        />

        <WorkspaceFilesPanel
          fileQuery={fileQuery}
          projectFiles={projectFiles}
          selectedFile={selectedFile}
          gitStatus={gitStatus}
          selectedDiff={selectedDiff}
          fileBusy={fileBusy}
          fileMessage={fileMessage}
          canReadLocalWorkspace={canReadLocalWorkspace}
          canAttachSelectedFile={canStageRoomChatAttachment(selectedRoom, isSelectedRoomLocked)}
          selectedFileRisks={selectedFileRisks}
          selectedFileNeedsAttachmentReview={selectedFileNeedsAttachmentReview}
          selectedSensitiveFileReviewed={selectedSensitiveFileReviewed}
          selectedAttachmentActionLabel={selectedAttachmentReview?.actionLabel ?? "Attach"}
          selectedAttachmentWarningDetail={selectedAttachmentReview?.warningDetail ?? undefined}
          filePreviewTab={filePreviewTab}
          formatBytes={formatBytes}
          onCopyProjectMarkdown={copyProjectMarkdown}
          onFileQueryChange={(query) => setFileQueryForRoom(selectedRoom.id, query)}
          onOpenProjectFile={openProjectFile}
          onCopyDiffSummaryMarkdown={copyDiffSummaryMarkdown}
          onAttachSelectedFileToMessage={attachSelectedFileToMessage}
          onFilePreviewTabChange={(tab) => setFilePreviewTabForRoom(selectedRoom.id, tab)}
          onCloseFileViewer={() => {
            setSelectedFileForRoom(selectedRoom.id, null);
            setSelectedDiffForRoom(selectedRoom.id, null);
            setSensitiveAttachmentReviewKey(null);
          }}
        />

        <GitHandoffPanel
          draft={gitWorkflowDraft}
          preview={gitApprovalPreview}
          readiness={githubWorkflowReadiness}
          canReadLocalWorkspace={canReadLocalWorkspace}
          gitWorkflowBusy={gitWorkflowBusy}
          isActiveHost={isActiveHost}
          message={gitWorkflowMessage}
          onDraftChange={updateSelectedGitWorkflowDraft}
          onCopyPullRequestDraftMarkdown={copyPullRequestDraftMarkdown}
          onApproveGitWorkflow={approveGitWorkflow}
        />

        <GitHubActionsPanel
          summary={actionsSummary}
          readiness={githubActionsReadiness}
          runs={actionRuns}
          owner={gitWorkflowDraft.prOwner}
          repo={gitWorkflowDraft.prRepo}
          branch={gitWorkflowDraft.branchName}
          lastChecked={actionsLastChecked}
          busy={actionsBusy}
          refreshDisabled={!canReadLocalWorkspace || actionsBusy || !isActiveHost || !githubActionsReadiness.ready}
          currentUserSignedIn={Boolean(currentUser)}
          message={actionsMessage}
          formatTimestamp={formatTimestamp}
          onRefresh={() => refreshGitHubActions()}
        />

        <TerminalPanel
          terminalName={terminalName}
          terminalCommand={terminalCommand}
          terminalInput={terminalInput}
          terminalBusy={terminalBusy}
          terminalError={terminalError}
          terminalCommandRisks={terminalCommandRisks}
          terminalRisks={terminalRisks}
          codexEvents={codexEventRows}
          commandRequests={terminalRequestRows}
          roomTerminals={roomTerminals}
          selectedTerminal={selectedTerminal}
          selectedTerminalId={selectedTerminalId}
          selectedTerminalCanControl={selectedTerminalCanControl}
          selectedTerminalCanRestart={selectedTerminalCanRestart}
          terminalOutputLines={terminalOutputLines}
          codexRunning={codexRunning}
          canReadLocalWorkspace={canReadLocalWorkspace}
          canRequestWorkspace={canRequestWorkspace}
          canApproveTerminal={canReadLocalWorkspace && isActiveHost}
          onCopyMarkdown={copyTerminalMarkdown}
          onRunGitStatus={runApprovedTerminalCheck}
          onOpenInteractiveTerminal={() => openInteractiveTerminal({ reuseExisting: false })}
          onTerminalNameChange={(name) => setTerminalNameForRoom(selectedRoom.id, name)}
          onTerminalCommandChange={(command) => setTerminalCommandForRoom(selectedRoom.id, command)}
          onStartTerminal={startNamedTerminal}
          onRequestTerminalCommand={requestTerminalCommand}
          onApproveTerminalRequest={(requestId) => {
            const request = terminalRequests.find((item) => item.id === requestId);
            if (request) approveTerminalRequest(request);
          }}
          onDenyTerminalRequest={denyTerminalRequest}
          onSelectTerminal={(terminalId) => setSelectedTerminalIdForRoom(selectedRoom.id, terminalId)}
          onTerminalInputChange={(input) => setTerminalInputForRoom(selectedRoom.id, input)}
          onSendTerminalInput={sendTerminalInput}
          onRestartTerminal={restartSelectedTerminal}
          onStopTerminal={stopSelectedTerminal}
        />
          </>
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
