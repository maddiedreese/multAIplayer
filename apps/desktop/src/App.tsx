import { useMemo, useRef, useState } from "react";
import type {
  ChatPlaintextPayload,
  ChatReactionPlaintextPayload,
  CodexTurnSummary,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  HostHandoffPlaintextPayload,
  InviteJoinRequestPlaintextPayload,
  InviteJoinStatusPlaintextPayload,
  LocalPreviewPlaintextPayload,
  RelayEnvelope,
  RoomKeyRotationPlaintextPayload,
  RoomRecord,
  RoomMode,
  TeamMemberRecord,
  TeamRecord,
  ApprovalPolicy
} from "@multaiplayer/protocol";
import {
  codexModelOptions,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultRoomMode
} from "@multaiplayer/protocol";
import {
  createRoomSecret,
  decodeRoomInviteSecret,
  decryptJson,
  encodeRoomInviteSecret,
  encryptJson,
  openDeviceSealedJson,
  sealJsonToDevice,
  unwrapRoomSecretForDevice,
  wrapRoomSecretForDevice
} from "@multaiplayer/crypto";
import {
  exportRoomSecret,
  importRoomSecret,
  loadHistorySettings,
  loadTeamHistorySettings,
  loadOrCreateRoomSecret,
  saveHistorySettings,
  saveTeamHistorySettings,
  clearEncryptedHistory,
  forgetRoomLocalData,
  loadRoomSecret,
  replaceRoomSecret,
  type LocalHistorySettings
} from "./lib/localHistory";
import {
  loadTeamRoomDefaults,
  saveTeamRoomDefaults,
  teamDefaultsRoomSettings
} from "./lib/teamRoomDefaults";
import { loadOrCreateDeviceIdentity, resetDeviceIdentity, type DeviceIdentity } from "./lib/deviceIdentity";
import {
  buildDeviceFingerprintMarkdown,
  loadTrustedDeviceKeys,
  trustDeviceKey,
  untrustDeviceKey,
  type TrustedDeviceKey
} from "./lib/deviceTrust";
import {
  applyGitPatch,
  chooseProjectFolder,
  cloneGitRepository,
  createGitPatch,
  defaultProjectPath,
  getGitRemoteOrigin,
  getGitStatus,
  runCodexTurn,
  runGitWorkflow,
  type CodexProbe,
  type GitApplyPatchResult,
  type GitCloneResult,
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
  createInvite,
  createRoom,
  createTeam,
  lookupInvite,
  removeTeamMember,
  transferTeamOwnership,
  updateTeamMemberRole,
  updateRoomHost,
  updateRoomSettings
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
  shouldAutoApproveChatOnlyTurn,
  shouldResetCodexApprovalForRoomModeChange,
  shouldResetCodexApprovalForRoomUpdate
} from "./lib/codexApproval";
import { buildCodexApprovalSnapshot, buildCodexTurnInput, buildCodexTurnSummary } from "./lib/codexTurn";
import { normalizeCodexThreadId } from "./lib/codexThread";
import { buildPullRequestBody } from "./lib/markdownExport";
import {
  maxCodexModelChars,
  maxRoomProjectPathChars,
  normalizeCodexModel,
  normalizeProjectPath,
  normalizeRoomName,
  planRoomCreation,
  planTeamCreation
} from "./lib/workspaceCreation";
import {
  canAcceptRoomHostHandoff,
  createHandoffSettingsPatch,
  findRoomHostHandoff,
  handoffRepoIdentity,
  hostHandoffDetail,
  roomHostHandoffMessage,
  sameHandoffRepo
} from "./lib/hostHandoff";
import {
  canActOnRoomInviteRequest,
  findRoomInviteRequest,
  roomInviteRequestMessage
} from "./lib/inviteApproval";
import { canControlRoomTerminal } from "./lib/terminalAccess";
import { displayableInviteLink } from "./lib/invitePrivacy";
import { canCreateRoomInvite } from "./lib/invitePolicy";
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
  parseGitHubRemoteUrl,
  type GitWorkflowDraft
} from "./lib/gitWorkflowDraft";
import { upsertRoomPreservingUnread } from "./lib/roomUnread";
import { ensureRoomDefaults } from "./lib/roomDefaults";
import { isMembershipRemovedRelayError, membershipRemovedRoomMessage } from "./lib/relayAccess";
import { omitRecordKey, withoutSetValue } from "./lib/setUtils";
import {
  replaceRoomTerminalSnapshots,
  terminalsForLocalHistory
} from "./lib/terminalState";
import {
  isDeviceSealedPayload,
  isInviteJoinRequestPlaintextPayload,
  isInviteJoinStatusPlaintextPayload,
  pruneLocalRoomHistory
} from "./lib/localRoomHistoryPayload";
import { roomLockMessage, roomSecretStorageLabel } from "./lib/appRuntime";
import { decodeNoSecretRoomInvite, encodeNoSecretRoomInvite, jsonWebKeyToDevicePublicKeyJwk } from "./lib/noSecretRoomInvite";
import {
  embeddedAttachmentBytes,
  encodedBytes,
  attachmentTypeFromName,
  formatBytes,
  formatCodexModel,
  formatMessageTime,
  formatSessionPersistence,
  formatTeamMemberName,
  formatTeamRole,
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
import {
  acknowledgeRoomVisibilityWarning as saveRoomVisibilityWarningAcknowledgement,
  clearRoomVisibilityWarningAcknowledgement,
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

  async function signOut() {
    await stopOwnedLocalPreviews("Stopped because the sharing user signed out.");
    await signOutGitHub();
  }

  async function rotateDeviceIdentity() {
    setDeviceIdentity(null);
    setDeviceIdentityMessage("Resetting local device identity...");
    try {
      await resetDeviceIdentity();
      const identity = await loadOrCreateDeviceIdentity();
      setDeviceIdentity(identity);
      setTrustedDeviceKeys((current) => untrustDeviceKey(current, selectedRoom.id, deviceId));
      setDeviceIdentityMessage("Created new local device identity. Public key registration will refresh automatically.");
    } catch (error) {
      setDeviceIdentityMessage(`Device identity rotation failed: ${String(error)}`);
    }
  }

  function trustRoomMemberDevice(member: RoomPresence) {
    const fingerprint = member.publicKeyFingerprint;
    if (!fingerprint) {
      setDeviceIdentityMessage(`${member.displayName} has no registered device identity to trust.`);
      return;
    }
    setTrustedDeviceKeys((current) =>
      trustDeviceKey(current, selectedRoom.id, member.deviceId, fingerprint)
    );
    setDeviceIdentityMessage(`Trusted ${member.displayName}'s device identity for ${selectedRoom.name}.`);
  }

  function untrustRoomMemberDevice(member: RoomPresence) {
    setTrustedDeviceKeys((current) => untrustDeviceKey(current, selectedRoom.id, member.deviceId));
    setDeviceIdentityMessage(`Removed local trust for ${member.displayName}'s device identity in ${selectedRoom.name}.`);
  }

  async function copyRoomMemberDeviceFingerprint(member: RoomPresence, trusted: boolean) {
    const fingerprint = member.publicKeyFingerprint;
    if (!fingerprint) {
      setDeviceIdentityMessage(`${member.displayName} has no registered device identity to copy.`);
      return;
    }
    const markdown = buildDeviceFingerprintMarkdown({
      roomName: selectedRoom.name,
      displayName: member.displayName,
      deviceId: member.deviceId,
      fingerprint,
      trusted
    });
    await copyMarkdownWithFallback(
      `${member.displayName} device fingerprint`,
      markdown,
      setDeviceIdentityMessage,
      selectedRoom.id
    );
  }

  async function addTeam() {
    let plan: ReturnType<typeof planTeamCreation>;
    try {
      plan = planTeamCreation(newTeamName);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      const team = await createTeam(plan.name);
      upsertTeam(team);
      setSelectedTeam(team.id);
      setNewTeamName("");
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(String(error));
    }
  }

  async function addRoom() {
    let plan: ReturnType<typeof planRoomCreation>;
    try {
      plan = planRoomCreation(selectedTeam, newRoomName, newRoomProjectPath);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      const teamDefaults = loadTeamRoomDefaults(plan.teamId);
      const room = await createRoom(
        plan.teamId,
        plan.name,
        plan.projectPath,
        {
          approvalPolicy: teamDefaults.approvalPolicy,
          codexModel: teamDefaults.codexModel,
          browserAllowedOrigins: teamDefaults.browserAllowedOrigins,
          browserProfilePersistent: teamDefaults.browserProfilePersistent
        }
      );
      upsertRoom(ensureRoomDefaults(room));
      setRevokedRoomIds((current) => withoutSetValue(current, room.id));
      setRevokedTeamIds((current) => withoutSetValue(current, room.teamId));
      setForgottenRoomIds((current) => withoutSetValue(current, room.id));
      setInviteApprovalGateForRoom(room.id, teamDefaults.inviteApprovalGate);
      saveHistorySettings(room.id, loadTeamHistorySettings(plan.teamId));
      setMessagesByRoom((current) => ({ ...current, [room.id]: [] }));
      setSelectedRoomId(room.id);
      setNewRoomName("");
      setNewRoomProjectPath(plan.projectPath);
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(String(error));
    }
  }

  async function chooseNewRoomProjectPath() {
    try {
      const path = await chooseProjectFolder(newRoomProjectPath || defaultProjectPath);
      if (!path) return;
      setNewRoomProjectPath(path);
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(String(error));
    }
  }

  function upsertTeam(team: TeamRecord) {
    setTeams((current) => {
      if (current.some((item) => item.id === team.id)) {
        return current.map((item) => (item.id === team.id ? team : item));
      }
      return [...current, team];
    });
    if (team.role) {
      setTeamMembersByTeam((current) => {
        if (current[team.id]?.some((member) => member.userId === localUser.id)) return current;
        return {
          ...current,
          [team.id]: [{
            teamId: team.id,
            userId: localUser.id,
            role: team.role ?? "member",
            joinedAt: new Date().toISOString()
          }]
        };
      });
    }
  }

  function upsertRoom(room: RoomRecord) {
    const nextRoom = ensureRoomDefaults(room);
    const previousRoom = roomsRef.current.find((existing) => existing.id === nextRoom.id);
    if (previousRoom && shouldResetCodexApprovalForRoomUpdate(ensureRoomDefaults(previousRoom), nextRoom)) {
      resetCodexApprovalForRoom(nextRoom.id);
    }
    setRooms((current) => upsertRoomPreservingUnread(current, nextRoom));
  }

  function handleRelayError(message: string) {
    console.warn("Relay error", message);
    if (!isMembershipRemovedRelayError(message) || !hasSelectedRoom) return;

    const room = selectedRoom;
    const userMessage = membershipRemovedRoomMessage(room.name);
    setRevokedRoomIds((current) => new Set(current).add(room.id));
    setRevokedTeamIds((current) => new Set(current).add(room.teamId));
    setForgottenRoomIds((current) => new Set(current).add(room.id));
    setInviteAdmissionsByRoom((current) => omitRecordKey(current, room.id));
    setPresenceByRoom((current) => omitRecordKey(current, room.id));
    setInviteLinkForRoom(room.id, "");
    setInviteMessageForRoom(room.id, userMessage);
    setChatMessageForRoom(room.id, userMessage);
    setHostMessageForRoom(room.id, userMessage);
    setWorkspaceError(userMessage);
  }

  async function changeTeamMemberRole(member: TeamMemberRecord, role: "admin" | "member") {
    if (!selectedTeam || selectedTeamMembersBusy) return;
    setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: true }));
    setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: null }));
    try {
      const members = await updateTeamMemberRole(selectedTeam, member.userId, role);
      setTeamMembersByTeam((current) => ({ ...current, [selectedTeam]: members }));
      setTeamMembersMessageByTeam((current) => ({
        ...current,
        [selectedTeam]: `${formatTeamMemberName(member.userId, currentUser)} is now ${formatTeamRole(role)}.`
      }));
    } catch (error) {
      setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: String(error) }));
    } finally {
      setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: false }));
    }
  }

  async function transferOwnershipToTeamMember(member: TeamMemberRecord) {
    if (!selectedTeam || selectedTeamMembersBusy) return;
    setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: true }));
    setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: null }));
    try {
      const members = await transferTeamOwnership(selectedTeam, member.userId);
      setTeamMembersByTeam((current) => ({ ...current, [selectedTeam]: members }));
      const localMember = members.find((item) => item.userId === localUser.id);
      setTeams((current) => current.map((team) =>
        team.id === selectedTeam ? { ...team, role: localMember?.role ?? team.role } : team
      ));
      setTeamMembersMessageByTeam((current) => ({
        ...current,
        [selectedTeam]: `${formatTeamMemberName(member.userId, currentUser)} is now the team owner.`
      }));
    } catch (error) {
      setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: String(error) }));
    } finally {
      setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: false }));
    }
  }

  async function removeMemberFromTeam(member: TeamMemberRecord) {
    if (!selectedTeam || selectedTeamMembersBusy) return;
    setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: true }));
    setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: null }));
    try {
      const members = await removeTeamMember(selectedTeam, member.userId);
      setTeamMembersByTeam((current) => ({ ...current, [selectedTeam]: members }));
      setTeams((current) => current.map((team) => team.id === selectedTeam ? { ...team, members: members.length } : team));
      setTeamMembersMessageByTeam((current) => ({
        ...current,
        [selectedTeam]: `Removed ${formatTeamMemberName(member.userId, currentUser)} from ${selectedTeamName}.`
      }));
    } catch (error) {
      setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: String(error) }));
    } finally {
      setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: false }));
    }
  }

  async function setRoomHost(hostStatus: RoomRecord["hostStatus"]) {
    if (!hasSelectedRoom) {
      setSelectedHostMessage("Create or join a room before changing the host.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedHostMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (hostStatus !== "active" && !isActiveHost) {
      setSelectedHostMessage(hostGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomHostMutationInFlight(roomId)) return;
    setHostBusyForRoom(roomId, true);
    setHostMessageForRoom(roomId, null);
    try {
      const host = hostStatus === "active" ? localUser.name : hostStatus === "handoff" ? selectedRoom.host : "No host";
      const hostUserId = hostStatus === "active" ? localUser.id : selectedRoom.hostUserId ?? localUser.id;
      const room = await updateRoomHost(roomId, host, hostUserId, hostStatus);
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setHostMessageForRoom(
          roomId,
          hostStatus === "active"
            ? `You are hosting ${room.name}.`
            : hostStatus === "handoff"
              ? `${room.name} is ready for host handoff.`
              : `${room.name} no longer has an active host.`
        );
      }
      if (hostStatus === "handoff") {
        await publishHostHandoff(room);
      }
      if (hostStatus === "active") {
        markLatestHostHandoffAccepted(room.id);
        setCodexContinuationByRoom((current) => omitRecordKey(current, room.id));
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHostMessageForRoom(roomId, String(error));
    } finally {
      setHostBusyForRoom(roomId, false);
    }
  }

  async function acceptHostHandoff(handoff: HostHandoffRecord) {
    if (!hasSelectedRoom) {
      setSelectedHostMessage("Create or join a room before accepting a host handoff.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedHostMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomHostMutationInFlight(roomId)) return;
    if (handoff.status !== "available") {
      setSelectedHostMessage("This host handoff has already been accepted.");
      return;
    }
    const roomHandoff = findRoomHostHandoff(hostHandoffs, handoff.id);
    if (!roomHandoff || !canAcceptRoomHostHandoff(hostHandoffs, handoff.id)) {
      setHostMessageForRoom(roomId, roomHostHandoffMessage(hostHandoffs, handoff.id));
      return;
    }
    setHostBusyForRoom(roomId, true);
    setHostMessageForRoom(roomId, null);
    try {
      const patch = createHandoffSettingsPatch(roomHandoff);
      const handoffProject = await resolveHandoffProject(roomHandoff, patch.projectPath);
      if (roomHandoff.gitPatch && !roomHandoff.gitPatchTruncated) {
        const patchResult = await applyGitPatch(handoffProject.path, roomHandoff.gitPatch);
        if (patchResult.status !== 0) {
          throw new Error(`Cloned or selected the repository, but could not apply ${roomHandoff.fromHost}'s local patch: ${patchResult.stderr || patchResult.stdout || "git apply failed"}`);
        }
      }
      const handoffProjectPath = handoffProject.path;
      const updatedSettings = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        ...patch,
        projectPath: handoffProjectPath
      });
      const claimed = await updateRoomHost(updatedSettings.id, localUser.name, localUser.id, "active");
      setRooms((current) => current.map((item) => (item.id === claimed.id ? ensureRoomDefaults(claimed) : item)));
      markHostHandoffAccepted(roomId, roomHandoff.id);
      await publishHostHandoffAccepted(selectedRoom, roomHandoff);
      setCodexContinuationByRoom((current) =>
        roomHandoff.reason === "usage_limit" ? { ...current, [roomId]: roomHandoff } : omitRecordKey(current, roomId)
      );
      resetFileContextForRoom(roomId);
      resetCodexApprovalForRoom(roomId);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setProjectPathDraftForRoom(roomId, handoffProjectPath);
        setCustomCodexModelForRoom(roomId, patch.codexModel);
        setSettingsMessageForRoom(
          roomId,
          buildAcceptedHandoffMessage(roomHandoff, handoffProject, patch.codexModel)
        );
        setHostMessageForRoom(
          roomId,
          roomHandoff.reason === "usage_limit"
            ? `You are now hosting ${claimed.name}. Codex will continue with the full room context on the next approved turn.`
            : `You are now hosting ${claimed.name} from ${roomHandoff.fromHost}'s handoff.`
        );
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHostMessageForRoom(roomId, String(error));
    } finally {
      setHostBusyForRoom(roomId, false);
    }
  }

  async function resolveHandoffProject(
    handoff: HostHandoffRecord,
    fallbackPath: string
  ): Promise<{ path: string; source: "existing" | "cloned" | "selected"; cloneResult?: GitCloneResult; patchResult?: GitApplyPatchResult }> {
    const expectedRepo = handoffRepoIdentity(handoff);

    async function pathMatches(path: string): Promise<boolean> {
      if (!expectedRepo) return true;
      const remote = await getGitRemoteOrigin(path).catch(() => ({ originUrl: null }));
      const actualRepo = remote.originUrl ? parseGitHubRemoteUrl(remote.originUrl) : null;
      return sameHandoffRepo(expectedRepo, actualRepo);
    }

    if (await pathMatches(fallbackPath)) return { path: fallbackPath, source: "existing" };

    if (handoff.gitRemoteUrl && expectedRepo) {
      const parentDir = defaultProjectPath.slice(0, defaultProjectPath.lastIndexOf("/")) || defaultProjectPath;
      const cloneResult = await cloneGitRepository(handoff.gitRemoteUrl, parentDir, handoff.gitBranch);
      if (cloneResult.status === 0 && await pathMatches(cloneResult.path)) {
        return { path: cloneResult.path, source: "cloned", cloneResult };
      }
      throw new Error(`Could not clone ${expectedRepo.owner}/${expectedRepo.repo}: ${cloneResult.stderr || cloneResult.stdout || "git clone failed"}`);
    }

    const selected = await chooseProjectFolder(defaultProjectPath);
    if (!selected) {
      throw new Error(`${hostHandoffDetail(handoff)} No local project folder was selected.`);
    }
    if (!(await pathMatches(selected))) {
      const repoLabel = expectedRepo ? `${expectedRepo.owner}/${expectedRepo.repo}` : "the handoff repository";
      throw new Error(`Selected folder is not a clone of ${repoLabel}. Choose a local clone or continue from GitHub.`);
    }
    return { path: selected, source: "selected" };
  }

  function buildAcceptedHandoffMessage(
    handoff: HostHandoffRecord,
    project: { path: string; source: "existing" | "cloned" | "selected" },
    codexModel: string
  ): string {
    const source =
      project.source === "cloned"
        ? "cloned from GitHub"
        : project.source === "selected"
          ? "selected locally"
          : "matched locally";
    const patchMessage = handoff.gitPatch && !handoff.gitPatchTruncated
      ? " Applied the previous host's local patch."
      : handoff.gitPatchTruncated
        ? " The previous host's patch was too large to apply automatically; ask them to push or share it."
        : handoff.gitDirtyFiles?.length
          ? " The previous host had local changes but no transferable patch was available."
          : "";
    return `Accepted handoff from ${handoff.fromHost}; ${source}, using ${formatCodexModel(codexModel)} at ${project.path}.${patchMessage}`;
  }

  async function publishHostHandoff(
    room: RoomRecord,
    reason: HostHandoffRecord["reason"] = "manual",
    contextMessages: ChatMessage[] = messages
  ) {
    const remoteInfo = await getGitRemoteOrigin(room.projectPath).catch(() => ({ originUrl: null }));
    const repoRef = remoteInfo.originUrl ? parseGitHubRemoteUrl(remoteInfo.originUrl) : null;
    const roomGitStatus = room.id === selectedRoom.id ? gitStatus : gitStatusByRoom[room.id] ?? null;
    const patchResult = roomGitStatus?.files.length
      ? await createGitPatch(room.projectPath).catch(() => null)
      : null;
    const summary = buildCodexTurnSummary(
      contextMessages,
      room,
      terminals,
      browserRequestsByRoom[room.id] ?? [],
      roomGitStatus
    );
    const handoff: HostHandoffRecord = {
      id: crypto.randomUUID(),
      fromHost: localUser.name,
      fromUserId: localUser.id,
      reason,
      projectPath: room.projectPath,
      ...(remoteInfo.originUrl ? { gitRemoteUrl: remoteInfo.originUrl } : {}),
      ...(repoRef ? { gitRepoOwner: repoRef.owner, gitRepoName: repoRef.repo } : {}),
      ...(roomGitStatus?.branch ? { gitBranch: roomGitStatus.branch } : {}),
      ...(roomGitStatus?.files.length ? { gitDirtyFiles: roomGitStatus.files.slice(0, 50).map((file) => file.path) } : {}),
      ...(patchResult?.patch && !patchResult.truncated ? { gitPatch: patchResult.patch } : {}),
      ...(patchResult?.truncated ? { gitPatchTruncated: true } : {}),
      codexModel: room.codexModel,
      approvalPolicy: room.approvalPolicy,
      messagesSinceLastCodex: summary.messagesSinceLastCodex,
      attachmentNames: summary.attachments.map((attachment) => attachment.name),
      terminals: summary.terminals,
      continuationSummary: reason === "usage_limit"
        ? codexUsageLimitMessage(localUser.name)
        : undefined,
      createdAt: new Date().toISOString(),
      status: "available"
    };
    appendHostHandoff(room.id, handoff);

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      setHostMessageForRoom(room.id, "Host handoff package saved locally because the relay is not connected.");
      return;
    }

    const payload: HostHandoffPlaintextPayload = {
      id: handoff.id,
      fromHost: handoff.fromHost,
      fromUserId: handoff.fromUserId,
      reason: handoff.reason,
      projectPath: handoff.projectPath,
      gitRemoteUrl: handoff.gitRemoteUrl,
      gitRepoOwner: handoff.gitRepoOwner,
      gitRepoName: handoff.gitRepoName,
      gitBranch: handoff.gitBranch,
      gitDirtyFiles: handoff.gitDirtyFiles,
      gitPatch: handoff.gitPatch,
      gitPatchTruncated: handoff.gitPatchTruncated,
      codexModel: handoff.codexModel,
      approvalPolicy: handoff.approvalPolicy,
      messagesSinceLastCodex: handoff.messagesSinceLastCodex,
      attachmentNames: handoff.attachmentNames,
      terminals: handoff.terminals,
      continuationSummary: handoff.continuationSummary,
      createdAt: handoff.createdAt
    };
    const secret = await loadOrCreateRoomSecret(room.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: new Date().toISOString(),
      kind: "room.host",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishHostHandoffAccepted(room: RoomRecord, handoff: HostHandoffRecord) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const acceptedAt = new Date().toISOString();
    const payload: HostHandoffPlaintextPayload = {
      id: handoff.id,
      fromHost: handoff.fromHost,
      fromUserId: handoff.fromUserId,
      reason: handoff.reason,
      projectPath: handoff.projectPath,
      gitRemoteUrl: handoff.gitRemoteUrl,
      gitRepoOwner: handoff.gitRepoOwner,
      gitRepoName: handoff.gitRepoName,
      gitBranch: handoff.gitBranch,
      gitDirtyFiles: handoff.gitDirtyFiles,
      gitPatch: handoff.gitPatch,
      gitPatchTruncated: handoff.gitPatchTruncated,
      codexModel: handoff.codexModel,
      approvalPolicy: handoff.approvalPolicy,
      messagesSinceLastCodex: handoff.messagesSinceLastCodex,
      attachmentNames: handoff.attachmentNames,
      terminals: handoff.terminals,
      continuationSummary: handoff.continuationSummary,
      createdAt: handoff.createdAt,
      status: "accepted",
      acceptedBy: localUser.name,
      acceptedByUserId: localUser.id,
      acceptedAt
    };
    const secret = await loadOrCreateRoomSecret(room.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: acceptedAt,
      kind: "room.host",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishInviteJoinRequest(
    teamId: string,
    roomId: string,
    request: InviteJoinRequestPlaintextPayload,
    recipientPublicKeyJwk?: Record<string, unknown>
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return false;
    const payload = recipientPublicKeyJwk
      ? await sealJsonToDevice(request, recipientPublicKeyJwk)
      : await encryptJson(request, await loadOrCreateRoomSecret(roomId));
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId,
      roomId,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: request.requestedAt,
      kind: "room.invite",
      payload
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
    return true;
  }

  async function decryptInviteEnvelope(envelope: RelayEnvelope): Promise<unknown | null> {
    if (deviceIdentity && isDeviceSealedPayload(envelope.payload)) {
      try {
        return await openDeviceSealedJson<unknown>(envelope.payload, deviceIdentity.privateKeyJwk);
      } catch {
        return null;
      }
    }
    if (envelope.payload.algorithm === "AES-GCM-256") {
      const secret = await loadRoomSecret(envelope.roomId);
      if (!secret) {
        setForgottenRoomIds((current) => new Set(current).add(envelope.roomId));
        return null;
      }
      return decryptJson<unknown>(envelope.payload, secret);
    }
    return null;
  }

  async function handleInviteEnvelopePlaintext(roomId: string, plaintext: unknown) {
    if (isInviteJoinRequestPlaintextPayload(plaintext)) {
      appendInviteRequest(roomId, { ...plaintext, status: "pending" });
      return;
    }
    if (!isInviteJoinStatusPlaintextPayload(plaintext)) return;
    updateInviteRequestStatus(roomId, plaintext.requestId, plaintext.status);
    if (!plaintext.requestId.startsWith(`${deviceId}:`)) return;
    if (
      plaintext.status === "approved" &&
      plaintext.wrappedRoomSecret &&
      plaintext.recipientDeviceId === deviceId &&
      deviceIdentity
    ) {
      const unwrappedSecret = await unwrapRoomSecretForDevice(plaintext.wrappedRoomSecret, deviceIdentity.privateKeyJwk);
      await importRoomSecret(roomId, unwrappedSecret);
      setForgottenRoomIds((current) => withoutSetValue(current, roomId));
    }
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
      setInviteMessageForRoom(
        roomId,
        plaintext.status === "approved"
          ? plaintext.wrappedRoomSecret
            ? `${plaintext.decidedBy} approved your room join request. This room is unlocked on this device.`
            : `${plaintext.decidedBy} approved your room join request.`
          : `${plaintext.decidedBy} denied your room join request.`
      );
    }
  }

  async function decideInviteJoinRequest(request: InviteJoinRequest, status: InviteJoinRequest["status"]) {
    if (!hasSelectedRoom) {
      setSelectedInviteMessage("Create or join a room before deciding invite requests.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedInviteMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedInviteMessage(hostGateMessage);
      return;
    }
    if (status === "pending") return;
    const room = selectedRoom;
    const roomRequest = findRoomInviteRequest(inviteRequests, request.id);
    if (!roomRequest || !canActOnRoomInviteRequest(inviteRequests, request.id)) {
      setInviteMessageForRoom(room.id, roomInviteRequestMessage(inviteRequests, request.id));
      return;
    }
    updateInviteRequestStatus(room.id, roomRequest.id, status);
    setInviteMessageForRoom(room.id, `${status === "approved" ? "Approved" : "Denied"} ${roomRequest.requester}'s join request.`);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    try {
      const secret = await loadOrCreateRoomSecret(room.id);
      const wrappedRoomSecret = status === "approved" && roomRequest.requesterPublicKeyJwk
        ? await wrapRoomSecretForDevice(secret, roomRequest.requesterPublicKeyJwk)
        : undefined;
      const payload: InviteJoinStatusPlaintextPayload = {
        eventType: "invite.status",
        requestId: roomRequest.id,
        status,
        decidedBy: localUser.name,
        decidedByUserId: localUser.id,
        decidedAt: new Date().toISOString(),
        recipientDeviceId: roomRequest.requesterDeviceId,
        recipientPublicKeyFingerprint: roomRequest.requesterPublicKeyFingerprint,
        wrappedRoomSecret
      };
      const envelopePayload = roomRequest.requesterPublicKeyJwk
        ? await sealJsonToDevice(payload, roomRequest.requesterPublicKeyJwk)
        : await encryptJson(payload, secret);
      const envelope: RelayEnvelope = {
        id: crypto.randomUUID(),
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: deviceId,
        senderUserId: localUser.id,
        createdAt: payload.decidedAt,
        kind: "room.invite",
        payload: envelopePayload
      };
      seenEnvelopeIds.current.add(envelope.id);
      client.publish({ type: "publish", envelope });
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setInviteMessageForRoom(room.id, String(error));
    }
  }

  function markLatestHostHandoffAccepted(roomId: string) {
    setHostHandoffsByRoom((current) => {
      const roomHandoffs = current[roomId] ?? [];
      const latestAvailable = [...roomHandoffs].reverse().find((handoff) => handoff.status === "available");
      if (!latestAvailable) return current;
      return markHostHandoffAcceptedInState(current, roomId, latestAvailable.id);
    });
  }

  function markHostHandoffAccepted(roomId: string, handoffId: string) {
    setHostHandoffsByRoom((current) => markHostHandoffAcceptedInState(current, roomId, handoffId));
  }

  function markHostHandoffAcceptedInState(
    current: Record<string, HostHandoffRecord[]>,
    roomId: string,
    handoffId: string
  ): Record<string, HostHandoffRecord[]> {
    const roomHandoffs = current[roomId] ?? [];
    if (!roomHandoffs.some((handoff) => handoff.id === handoffId)) return current;
    return {
      ...current,
      [roomId]: roomHandoffs.map((handoff) =>
        handoff.id === handoffId ? { ...handoff, status: "accepted" } : handoff
      )
    };
  }

  async function setApprovalPolicy(approvalPolicy: ApprovalPolicy) {
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing room settings.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousPolicy = selectedRoom.approvalPolicy;
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), approvalPolicy });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "approvalPolicy",
        previousValue: previousPolicy,
        nextValue: approvalPolicy,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Approval policy set to ${approvalPolicyLabels[approvalPolicy]}.`);
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function toggleRoomMode(key: keyof RoomMode) {
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing room settings.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const nextMode: RoomMode = {
        ...selectedRoom.mode,
        [key]: !selectedRoom.mode[key]
      };
      const previousValue = `${key}:${selectedRoom.mode[key] ? "enabled" : "disabled"}`;
      const nextValue = `${key}:${nextMode[key] ? "enabled" : "disabled"}`;
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), mode: nextMode });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "roomMode",
        previousValue,
        nextValue,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `${roomModeLabels[key]} mode ${nextMode[key] ? "enabled" : "disabled"}.`);
      }
      if (shouldResetCodexApprovalForRoomModeChange(key)) {
        resetCodexApprovalForRoom(roomId);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setCodexModel(codexModel: string) {
    const nextModel = normalizeCodexModel(codexModel);
    if (!nextModel) {
      setSelectedSettingsMessage(`Use a known Codex model or a model-like id up to ${maxCodexModelChars} characters.`);
      return;
    }
    if (nextModel === selectedCodexModel) return;
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing the Codex model.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousModel = selectedCodexModel;
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), codexModel: nextModel });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "codexModel",
        previousValue: previousModel,
        nextValue: nextModel,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Codex model set to ${formatCodexModel(nextModel)}.`);
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function renameRoom(name: string) {
    const nextName = normalizeRoomName(name);
    if (!nextName) {
      setSelectedSettingsMessage("Use a room title up to 160 characters without control characters.");
      return;
    }
    if (!hasSelectedRoom || nextName === selectedRoom.name) return;
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousName = selectedRoom.name;
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), name: nextName });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "roomName",
        previousValue: previousName,
        nextValue: nextName,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Room title changed to ${nextName}.`);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setBrowserProfilePersistence(browserProfilePersistent: boolean) {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before changing browser profile persistence.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedBrowserMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(roomSettingsGateMessage);
      return;
    }
    if (browserProfilePersistent === selectedRoom.browserProfilePersistent) return;
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId, setBrowserMessageForRoom)) return;
    setSettingsBusyForRoom(roomId, true);
    setBrowserMessageForRoom(roomId, null);
    try {
      const previousPersistence = selectedRoom.browserProfilePersistent;
      const room = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        browserProfilePersistent
      });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "browserProfilePersistent",
        previousValue: String(previousPersistence),
        nextValue: String(browserProfilePersistent),
        changedAt: new Date().toISOString()
      });
      if (!browserProfilePersistent) {
        setBrowserStatusByRoom((current) => omitRecordKey(current, roomId));
      }
      resetCodexApprovalForRoom(roomId);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setBrowserMessageForRoom(
          roomId,
          browserProfilePersistent
            ? "Browser profile persistence enabled for this room."
            : "Browser profile will refresh before each approved page opens."
        );
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setBrowserMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function updateProjectPath() {
    const nextProjectPath = normalizeProjectPath(projectPathDraft);
    if (!nextProjectPath) {
      setSelectedSettingsMessage(`Enter a local project folder up to ${maxRoomProjectPathChars} characters without control characters.`);
      return;
    }
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before attaching a project folder.");
      return;
    }
    if (nextProjectPath === selectedRoom.projectPath) return;
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousProjectPath = selectedRoom.projectPath;
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), projectPath: nextProjectPath });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "projectPath",
        previousValue: previousProjectPath,
        nextValue: nextProjectPath,
        changedAt: new Date().toISOString()
      });
      resetFileContextForRoom(roomId);
      resetCodexApprovalForRoom(roomId);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Project folder set to ${nextProjectPath}.`);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  function roomSettingsActor() {
    return {
      requesterName: localUser.name,
      requesterUserId: localUser.id
    };
  }

  async function chooseProjectPath() {
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before choosing a project folder.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    setSettingsMessageForRoom(roomId, null);
    try {
      const selectedPath = await chooseProjectFolder(projectPathDraft || selectedRoom.projectPath);
      if (!selectedPath) {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setSettingsMessageForRoom(roomId, "Native folder picker is available in the Tauri app. In web preview, paste a local folder path.");
        }
        return;
      }
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setProjectPathDraftForRoom(roomId, selectedPath);
        setSettingsMessageForRoom(roomId, `Selected project folder: ${selectedPath}`);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    }
  }

  function updateLocalHistorySettings(next: LocalHistorySettings) {
    if (!hasSelectedRoom) {
      setSelectedHistoryMessage("Create or join a room before changing encrypted history settings.");
      return;
    }
    const roomId = selectedRoom.id;
    const saved = saveHistorySettings(roomId, next);
    setHistorySettings(saved);
    if (saved.enabled) {
      const payload = pruneLocalRoomHistory({
        version: 3,
        messages,
        terminalRequests,
        browserRequests,
        inviteRequests,
        codexEvents,
        gitWorkflowEvents,
        githubActionsEvents,
        localPreviews,
        terminalSnapshots: terminalsForLocalHistory(terminals.filter((terminal) => terminal.roomId === roomId)),
        hostHandoffs,
        ...(selectedCodexThreadId ? { codexThreadId: selectedCodexThreadId } : {})
      }, saved.retentionDays);
      setMessagesByRoom((current) => ({ ...current, [roomId]: payload.messages }));
      setTerminalRequestsByRoom((current) => ({ ...current, [roomId]: payload.terminalRequests }));
      setBrowserRequestsByRoom((current) => ({ ...current, [roomId]: payload.browserRequests }));
      setInviteRequestsByRoom((current) => ({ ...current, [roomId]: payload.inviteRequests }));
      setCodexEventsByRoom((current) => ({ ...current, [roomId]: payload.codexEvents }));
      setGitWorkflowEventsByRoom((current) => ({ ...current, [roomId]: payload.gitWorkflowEvents }));
      setGitHubActionsEventsByRoom((current) => ({ ...current, [roomId]: payload.githubActionsEvents }));
      setLocalPreviewsByRoom((current) => ({ ...current, [roomId]: payload.localPreviews }));
      setTerminals((current) => replaceRoomTerminalSnapshots(current, roomId, payload.terminalSnapshots));
      setHostHandoffsByRoom((current) => ({ ...current, [roomId]: payload.hostHandoffs }));
    }
    setHistoryMessageForRoom(
      roomId,
      saved.enabled
        ? `Encrypted local history retention set to ${saved.retentionDays} days.`
        : "Encrypted local history is disabled for this room."
    );
	  }

  function updateTeamHistoryDefaults(next: LocalHistorySettings) {
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team history defaults.");
      return;
    }
    const teamId = selectedTeam;
    const saved = saveTeamHistorySettings(selectedTeam, next);
    setTeamHistorySettings(saved);
    setTeamHistoryMessageForTeam(
      teamId,
      saved.enabled
        ? `Team default local history retention set to ${saved.retentionDays} days for new rooms.`
        : "Team default local history is disabled for new rooms."
    );
  }

  function updateTeamDefaultApprovalPolicy(approvalPolicy: ApprovalPolicy) {
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team defaults.");
      return;
    }
    const saved = saveTeamRoomDefaults(selectedTeam, {
      ...loadTeamRoomDefaults(selectedTeam),
      approvalPolicy
    });
    setTeamDefaultApprovalPolicy(saved.approvalPolicy);
    setTeamDefaultCodexModel(saved.codexModel);
    setTeamDefaultBrowserProfilePersistent(saved.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(saved.inviteApprovalGate);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      `New rooms in this team will default to ${approvalPolicyLabels[saved.approvalPolicy]}.`
    );
  }

  function updateTeamDefaultCodexModel(codexModel: string) {
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team defaults.");
      return;
    }
    const saved = saveTeamRoomDefaults(selectedTeam, {
      ...loadTeamRoomDefaults(selectedTeam),
      codexModel
    });
    setTeamDefaultApprovalPolicy(saved.approvalPolicy);
    setTeamDefaultCodexModel(saved.codexModel);
    setTeamDefaultBrowserProfilePersistent(saved.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(saved.inviteApprovalGate);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      `New rooms in this team will default to ${formatCodexModel(saved.codexModel)}.`
    );
  }

  function updateTeamDefaultInviteApprovalGate(inviteApprovalGate: boolean) {
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team defaults.");
      return;
    }
    const saved = saveTeamRoomDefaults(selectedTeam, {
      ...loadTeamRoomDefaults(selectedTeam),
      inviteApprovalGate
    });
    setTeamDefaultApprovalPolicy(saved.approvalPolicy);
    setTeamDefaultCodexModel(saved.codexModel);
    setTeamDefaultBrowserProfilePersistent(saved.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(saved.inviteApprovalGate);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      saved.inviteApprovalGate
        ? "New room invites in this team will require host approval by default."
        : "New room invites in this team will include the room key by default."
    );
  }

  async function applyTeamDefaultsToRoom() {
    if (!hasSelectedRoom) {
      setSelectedHistoryMessage("Create or join a room before applying team defaults.");
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId, setHistoryMessageForRoom)) return;
    const teamId = selectedRoom.teamId;
    const historyDefaults = loadTeamHistorySettings(teamId);
    const roomDefaults = loadTeamRoomDefaults(teamId);
    updateLocalHistorySettings(historyDefaults);
    setInviteApprovalGateForRoom(roomId, roomDefaults.inviteApprovalGate);
    if (isSelectedRoomLocked) {
      setHistoryMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setHistoryMessageForRoom(
        roomId,
        "Applied local history and invite defaults. Claim host to apply approval and browser defaults to this room."
      );
      return;
    }
    setSettingsBusyForRoom(roomId, true);
    try {
      const roomSettings = teamDefaultsRoomSettings(roomDefaults);
      const room = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        ...roomSettings
      });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      if (!roomSettings.browserProfilePersistent) {
        setBrowserStatusByRoom((current) => omitRecordKey(current, roomId));
        setActiveBrowserUrlsByRoom((current) => omitRecordKey(current, roomId));
      }
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setHistoryMessageForRoom(roomId, "Applied team defaults to this room.");
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHistoryMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function clearRoomHistory() {
    if (!hasSelectedRoom) {
      setSelectedHistoryMessage("Create or join a room before clearing local history.");
      return;
    }
    const roomId = selectedRoom.id;
    await clearEncryptedHistory(selectedRoom.id);
    setMessagesByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setTerminalRequestsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setBrowserRequestsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setInviteRequestsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setCodexEventsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setGitWorkflowEventsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setGitHubActionsEventsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setHostHandoffsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setCodexThreadIdsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionRunsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsLastCheckedByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setGitWorkflowBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHostBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHostMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setChatMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setMarkdownCopyFallbacksByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSecretWarningsVisibleByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHistoryMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSettingsBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSettingsMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setCustomCodexModelsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setProjectPathDraftsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setKeyRotationBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setApprovalVisibleByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setPendingCodexApprovalsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setCodexRunningByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActiveBrowserUrlsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setGitStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setFileQueriesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setProjectFilesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSelectedFilesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSelectedDiffsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setFileBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setFileMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setPendingAttachmentsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalLinesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSelectedTerminalIdsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalNamesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalCommandsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalInputsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalErrorsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminals((current) => current.filter((terminal) => terminal.roomId !== selectedRoom.id));
    setBrowserUrlsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserReasonsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setInviteLinksByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setInviteApprovalGatesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setInviteMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setDraftsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHistoryMessageForRoom(roomId, "Cleared encrypted local history for this room.");
  }

  async function forgetSelectedRoomLocalData() {
    if (!hasSelectedRoom) {
      setSelectedHistoryMessage("Create or join a room before forgetting local room data.");
      return;
    }
    const roomId = selectedRoom.id;
    const confirmed = window.confirm(
      `Forget ${selectedRoom.name} on this device?\n\nThis deletes local history, room settings, and this device's room access. You will need a fresh invite or host approval to read or send room messages again.`
    );
    if (!confirmed) return;
    await forgetRoomLocalData(selectedRoom.id);
    clearRoomVisibilityWarningAcknowledgement(selectedRoom.id);
    historyLoadedRoomIds.current.delete(selectedRoom.id);
    setForgottenRoomIds((current) => new Set(current).add(selectedRoom.id));
    setMessagesByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setTerminalRequestsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setBrowserRequestsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setInviteRequestsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setCodexEventsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setGitWorkflowEventsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setGitHubActionsEventsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setHostHandoffsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setCodexThreadIdsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionRunsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsLastCheckedByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setGitWorkflowBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHostBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHostMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setChatMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setMarkdownCopyFallbacksByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSecretWarningsVisibleByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHistoryMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSettingsBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSettingsMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setCustomCodexModelsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setProjectPathDraftsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setKeyRotationBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setApprovalVisibleByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setPendingCodexApprovalsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setCodexRunningByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActiveBrowserUrlsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setGitStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setFileQueriesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setProjectFilesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSelectedFilesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSelectedDiffsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setFileBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setFileMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setPendingAttachmentsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalLinesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setSelectedTerminalIdsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalNamesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalCommandsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalInputsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalErrorsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminals((current) => current.filter((terminal) => terminal.roomId !== selectedRoom.id));
    setBrowserUrlsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserReasonsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setInviteLinksByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setInviteApprovalGatesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setInviteMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setDraftsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHistorySettings(loadHistorySettings(selectedRoom.id));
    setSecretWarningVisibleForRoom(selectedRoom.id, true);
    setHistoryMessageForRoom(roomId, "Forgot this room on this device. Rejoin from an invite to unlock it again.");
  }

  async function copyInviteLink() {
    if (!hasSelectedRoom) {
      setSelectedInviteMessage("Create or join a room before copying an invite.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedInviteMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    if (!canCreateRoomInvite(room, localUser, false, inviteApprovalGate)) {
      setInviteMessageForRoom(roomId, "Only the active host can create approval-gated invite links.");
      return;
    }
    setInviteMessageForRoom(roomId, null);
    setInviteLinkForRoom(roomId, "");
    try {
      const invite = await createInvite(room.teamId, room.id);
      if (inviteApprovalGate) {
        if (!deviceIdentity) {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(roomId, "Device identity is still being prepared. Try again in a moment.");
          }
          return;
        }
        const joinFragment = encodeNoSecretRoomInvite({
          version: 1,
          teamId: room.teamId,
          roomId: room.id,
          roomName: room.name,
          hostDeviceId: deviceId,
          hostPublicKeyJwk: jsonWebKeyToDevicePublicKeyJwk(deviceIdentity.publicKeyJwk),
          hostPublicKeyFingerprint: deviceIdentity.publicKeyFingerprint
        });
        const link = `${window.location.origin}${window.location.pathname}?invite=${invite.id}#multaiplayerJoin=${joinFragment}&approval=request`;
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteLinkForRoom(roomId, displayableInviteLink(link, false));
        }
        try {
          await navigator.clipboard.writeText(link);
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(roomId, "Copied approval invite link. The host will approve access when someone joins.");
          }
        } catch {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(roomId, "Approval invite generated. Copying was blocked because the app was not focused.");
          }
        }
        return;
      }
      const secret = await exportRoomSecret(room.id);
      const secretFragment = encodeRoomInviteSecret({
        version: 1,
        teamId: room.teamId,
        roomId: room.id,
        roomName: room.name,
        secret
      });
      const link = `${window.location.origin}${window.location.pathname}?invite=${invite.id}#multaiplayerInvite=${secretFragment}`;
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setInviteLinkForRoom(roomId, displayableInviteLink(link, true));
      }
      try {
        await navigator.clipboard.writeText(link);
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(roomId, "Copied direct invite link. It grants room access, so it is not displayed after copying.");
        }
      } catch {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(roomId, "Direct invite generated, but copying was blocked. Focus the app and try again, or use host approval.");
        }
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setInviteMessageForRoom(roomId, String(error));
    }
  }

  async function rotateSelectedRoomKey() {
    if (!hasSelectedRoom) {
      setSelectedInviteMessage("Create or join a room before refreshing room access.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedInviteMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedInviteMessage(hostGateMessage);
      return;
    }
    if (reportRoomKeyRotationInFlight(selectedRoom.id)) return;
    const confirmed = window.confirm(
      `Refresh room access for ${selectedRoom.name}?\n\nThis updates future messages and invites for current members. It is not full member removal in the alpha.`
    );
    if (!confirmed) return;

    const room = selectedRoom;
    setKeyRotationBusyForRoom(room.id, true);
    setInviteMessageForRoom(room.id, null);
    try {
      const oldSecret = await loadOrCreateRoomSecret(room.id);
      const newSecret = await createRoomSecret();
      const rotatedAt = new Date().toISOString();
      const payload: RoomKeyRotationPlaintextPayload = {
        eventType: "room.key.rotated",
        id: crypto.randomUUID(),
        rotatedBy: localUser.name,
        rotatedByUserId: localUser.id,
        rotatedAt,
        newSecret,
        note: "Future room messages and invites use this key."
      };

      const client = relayRef.current;
      if (client && relayStatus !== "closed" && relayStatus !== "error") {
        const envelope: RelayEnvelope = {
          id: crypto.randomUUID(),
          teamId: room.teamId,
          roomId: room.id,
          senderDeviceId: deviceId,
          senderUserId: localUser.id,
          createdAt: rotatedAt,
          kind: "room.key",
          payload: await encryptJson(payload, oldSecret)
        };
        seenEnvelopeIds.current.add(envelope.id);
        client.publish({ type: "publish", envelope });
      }

      await replaceRoomSecret(room.id, newSecret);
      historyLoadedRoomIds.current.add(room.id);
      appendRoomMessage(room.id, {
        id: payload.id,
        author: "multAIplayer",
        role: "system",
        body: `${localUser.name} refreshed room access. Future messages and invites use the updated access state.`,
        time: formatMessageTime(rotatedAt),
        createdAt: rotatedAt
      });
      setForgottenRoomIds((current) => withoutSetValue(current, room.id));
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        setInviteLinkForRoom(room.id, "");
        setInviteMessageForRoom(
          room.id,
          client && relayStatus !== "closed" && relayStatus !== "error"
            ? "Refreshed room access for future messages and invites."
            : "Refreshed access locally, but the relay is offline. Other members will need a fresh invite."
        );
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setInviteMessageForRoom(room.id, String(error));
    } finally {
      setKeyRotationBusyForRoom(room.id, false);
    }
  }

  async function requestNoSecretInviteAccess(encodedInvite: string, inviteId?: string | null) {
    const inviteSecret = decodeNoSecretRoomInvite(encodedInvite);
    let acceptedRoomName = inviteSecret.roomName;
    if (inviteId) {
      const metadata = await lookupInvite(inviteId);
      if (metadata.invite.teamId !== inviteSecret.teamId || metadata.invite.roomId !== inviteSecret.roomId) {
        throw new Error("Invite metadata does not match the no-secret invite fragment.");
      }
      upsertTeam(metadata.team);
      upsertRoom(ensureRoomDefaults(metadata.room));
      acceptedRoomName = metadata.room.name;
      setRevokedRoomIds((current) => withoutSetValue(current, inviteSecret.roomId));
      setRevokedTeamIds((current) => withoutSetValue(current, inviteSecret.teamId));
      setInviteAdmissionsByRoom((current) => ({
        ...current,
        [inviteSecret.roomId]: inviteId
      }));
    } else {
      upsertTeam({
        id: inviteSecret.teamId,
        name: "Invited team",
        members: 1
      });
      upsertRoom(ensureRoomDefaults({
        id: inviteSecret.roomId,
        teamId: inviteSecret.teamId,
        name: inviteSecret.roomName,
        projectPath: defaultProjectPath,
        host: "No host",
        hostStatus: "offline",
        approvalPolicy: "ask_every_turn",
        mode: defaultRoomMode,
        codexModel: defaultCodexModel,
        browserAllowedOrigins: defaultBrowserAllowedOrigins,
        browserProfilePersistent: defaultBrowserProfilePersistent,
        unread: 0
      }));
    }

    setMessagesByRoom((current) => ({
      ...current,
      [inviteSecret.roomId]: current[inviteSecret.roomId] ?? []
    }));
    setSelectedTeam(inviteSecret.teamId);
    setSelectedRoomId(inviteSecret.roomId);
    setInviteSecretInput("");
    const requestedAt = new Date().toISOString();
    const request: InviteJoinRequest = {
      eventType: "invite.request",
      id: `${deviceId}:${crypto.randomUUID()}`,
      inviteId: inviteId ?? undefined,
      requester: localUser.name,
      requesterUserId: localUser.id,
      requesterDeviceId: deviceId,
      requesterPublicKeyJwk: deviceIdentity ? jsonWebKeyToDevicePublicKeyJwk(deviceIdentity.publicKeyJwk) : undefined,
      requesterPublicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
      requestedAt,
      note: `Requesting access to ${acceptedRoomName}.`,
      status: "pending"
    };
    appendInviteRequest(inviteSecret.roomId, request);
    const published = await publishInviteJoinRequest(inviteSecret.teamId, inviteSecret.roomId, {
      eventType: request.eventType,
      id: request.id,
      inviteId: request.inviteId,
      requester: request.requester,
      requesterUserId: request.requesterUserId,
      requesterDeviceId: request.requesterDeviceId,
      requesterPublicKeyJwk: request.requesterPublicKeyJwk,
      requesterPublicKeyFingerprint: request.requesterPublicKeyFingerprint,
      requestedAt: request.requestedAt,
      note: request.note
    }, inviteSecret.hostPublicKeyJwk);
    setInviteMessageForRoom(inviteSecret.roomId, published
      ? `Requested access to ${acceptedRoomName}. The host needs to approve this device before the room unlocks.`
      : `Imported ${acceptedRoomName} metadata. Send again after the relay reconnects so the host can approve access.`);
  }

  async function acceptInvite(encodedSecret: string, inviteId?: string | null, approvalRequested = false) {
    const inviteSecret = decodeRoomInviteSecret(encodedSecret);
    let acceptedRoomName = inviteSecret.roomName;

    if (inviteId) {
      const metadata = await lookupInvite(inviteId);
      if (metadata.invite.teamId !== inviteSecret.teamId || metadata.invite.roomId !== inviteSecret.roomId) {
        throw new Error("Invite metadata does not match this invite.");
      }
      upsertTeam(metadata.team);
      upsertRoom(ensureRoomDefaults(metadata.room));
      acceptedRoomName = metadata.room.name;
      setRevokedRoomIds((current) => withoutSetValue(current, inviteSecret.roomId));
      setRevokedTeamIds((current) => withoutSetValue(current, inviteSecret.teamId));
    } else {
      upsertTeam({
        id: inviteSecret.teamId,
        name: "Invited team",
        members: 1
      });
      upsertRoom(ensureRoomDefaults({
        id: inviteSecret.roomId,
        teamId: inviteSecret.teamId,
        name: inviteSecret.roomName,
        projectPath: defaultProjectPath,
        host: "No host",
        hostStatus: "offline",
        approvalPolicy: "ask_every_turn",
        mode: defaultRoomMode,
        codexModel: defaultCodexModel,
        browserAllowedOrigins: defaultBrowserAllowedOrigins,
        browserProfilePersistent: defaultBrowserProfilePersistent,
        unread: 0
      }));
    }

    await importRoomSecret(inviteSecret.roomId, inviteSecret.secret);
    setForgottenRoomIds((current) => withoutSetValue(current, inviteSecret.roomId));
    if (inviteId) {
      setInviteAdmissionsByRoom((current) => ({
        ...current,
        [inviteSecret.roomId]: inviteId
      }));
    }
    setMessagesByRoom((current) => ({
      ...current,
      [inviteSecret.roomId]: current[inviteSecret.roomId] ?? []
    }));
    setSelectedTeam(inviteSecret.teamId);
    setSelectedRoomId(inviteSecret.roomId);
    setInviteSecretInput("");
    if (approvalRequested) {
      const requestedAt = new Date().toISOString();
      const request: InviteJoinRequest = {
        eventType: "invite.request",
        id: `${deviceId}:${crypto.randomUUID()}`,
        inviteId: inviteId ?? undefined,
        requester: localUser.name,
        requesterUserId: localUser.id,
        requesterDeviceId: deviceId,
        requesterPublicKeyJwk: deviceIdentity ? jsonWebKeyToDevicePublicKeyJwk(deviceIdentity.publicKeyJwk) : undefined,
        requesterPublicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
        requestedAt,
        note: `Requesting access to ${acceptedRoomName}.`,
        status: "pending"
      };
      appendInviteRequest(inviteSecret.roomId, request);
      const published = await publishInviteJoinRequest(inviteSecret.teamId, inviteSecret.roomId, {
        eventType: request.eventType,
        id: request.id,
        inviteId: request.inviteId,
        requester: request.requester,
        requesterUserId: request.requesterUserId,
        requesterDeviceId: request.requesterDeviceId,
        requesterPublicKeyJwk: request.requesterPublicKeyJwk,
        requesterPublicKeyFingerprint: request.requesterPublicKeyFingerprint,
        requestedAt: request.requestedAt,
        note: request.note
      });
      setInviteMessageForRoom(inviteSecret.roomId, published
        ? `Imported ${acceptedRoomName} and sent a join request to the active host.`
        : `Imported ${acceptedRoomName}. Send again after the relay reconnects so the host can approve access.`);
      return;
    }
    setInviteMessageForRoom(inviteSecret.roomId, `Joined ${acceptedRoomName}.`);
  }

  async function joinInviteSecret() {
    const raw = inviteSecretInput.trim();
    if (!raw) return;
    setSelectedInviteMessage(null);
    setInviteSecretInput("");
    try {
      const [beforeHash, afterHash] = raw.includes("#") ? raw.split("#") : ["", raw];
      const inviteId = beforeHash.includes("?")
        ? new URLSearchParams(beforeHash.split("?").at(-1) ?? "").get("invite")
        : null;
      const fragment = afterHash ?? raw;
      const params = new URLSearchParams(fragment.replace(/^#/, ""));
      const joinInvite = params.get("multaiplayerJoin");
      if (joinInvite) {
        await requestNoSecretInviteAccess(joinInvite, inviteId);
        return;
      }
      const encoded = params.get("multaiplayerInvite") ?? raw;
      await acceptInvite(encoded, inviteId, params.get("approval") === "request");
    } catch (error) {
      setSelectedInviteMessage(`Invite could not be imported: ${String(error)}`);
    }
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
