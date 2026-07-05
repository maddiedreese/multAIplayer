import {
  Bell,
  Bot,
  Check,
  Circle,
  Copy,
  FileCode2,
  FolderGit2,
  Github,
  KeyRound,
  Lock,
  MessageSquare,
  ExternalLink,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Terminal,
  UserRoundCheck,
  UsersRound,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatPlaintextPayload,
  BrowserRequestPlaintextPayload,
  ChatReactionPlaintextPayload,
  CodexEventPlaintextPayload,
  CodexTurnSummary,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  HostHandoffPlaintextPayload,
  InviteJoinRequestPlaintextPayload,
  InviteJoinStatusPlaintextPayload,
  RelayEnvelope,
  RequestStatusPlaintextPayload,
  RoomSettingsPlaintextPayload,
  RoomKeyRotationPlaintextPayload,
  RoomRecord,
  RoomMode,
  TeamMemberRecord,
  TeamRecord,
  TerminalResultPlaintextPayload,
  TerminalRequestPlaintextPayload,
  ApprovalPolicy
} from "@multaiplayer/protocol";
import {
  codexModelOptions,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultRoomMode,
  maxEmbeddedAttachmentBytes,
  maxEmbeddedAttachmentBytesPerMessage,
  maxMessageAttachments,
  RoomKeyRotationPlaintextPayload as RoomKeyRotationPlaintextPayloadSchema
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
  hasHistorySettings,
  importRoomSecret,
  loadHistorySettings,
  loadTeamHistorySettings,
  loadEncryptedHistory,
  loadOrCreateRoomSecret,
  saveHistorySettings,
  saveTeamHistorySettings,
  clearEncryptedHistory,
  forgetRoomLocalData,
  loadRoomSecret,
  replaceRoomSecret,
  type LocalHistorySettings,
  saveEncryptedHistory
} from "./lib/localHistory";
import {
  isRoomSettingsMutationInFlight,
  loadTeamRoomDefaults,
  roomSettingsMutationInFlightMessage,
  saveTeamRoomDefaults,
  teamDefaultsRoomSettings
} from "./lib/teamRoomDefaults";
import { loadOrCreateDeviceIdentity, resetDeviceIdentity, type DeviceIdentity } from "./lib/deviceIdentity";
import {
  buildDeviceFingerprintMarkdown,
  isDeviceKeyTrusted,
  loadTrustedDeviceKeys,
  trustDeviceKey,
  untrustDeviceKey,
  type TrustedDeviceKey
} from "./lib/deviceTrust";
import {
  chooseProjectFolder,
  defaultProjectPath,
  getGitDiff,
  getGitRemoteOrigin,
  getGitStatus,
  listTerminals,
  openBrowserView,
  probeCodex,
  readProjectFile,
  readTerminal,
  runCodexTurn,
  runGitWorkflow,
  runShellCommand,
  searchProjectFiles,
  startTerminal,
  stopTerminal,
  resetBrowserProfile,
  writeTerminal,
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
  getAuthConfig,
  getCurrentUser,
  listGitHubActionRuns,
  logout,
  pollGitHubDeviceFlow,
  startGitHubDeviceFlow,
  type GitHubAuthConfig,
  type GitHubActionRun,
  type GitHubDeviceStart,
  type SignedInUser
} from "./lib/authClient";
import { connectRelay, type RelayClient } from "./lib/relayClient";
import {
  createAttachmentBlob,
  createInvite,
  createRoom,
  createTeam,
  loadAttachmentBlob,
  loadTeamMembers,
  loadWorkspace,
  lookupInvite,
  registerDevice,
  removeTeamMember,
  transferTeamOwnership,
  updateTeamMemberRole,
  updateRoomHost,
  updateRoomSettings
} from "./lib/workspaceClient";
import { defaultRelayHttpUrl, defaultRelayWsUrl, loadAppConfig, resetAppConfig, saveAppConfig, type AppConfig } from "./lib/appConfig";
import {
  canApproveCodexTurn,
  shouldAutoApproveChatOnlyTurn,
  shouldResetCodexApprovalForRoomModeChange,
  shouldResetCodexApprovalForRoomUpdate
} from "./lib/codexApproval";
import { buildCodexApprovalSnapshot, buildCodexTurnInput, buildCodexTurnSummary, messagesSinceLastCodex } from "./lib/codexTurn";
import { normalizeCodexThreadId } from "./lib/codexThread";
import {
  buildCodexOutputMarkdown,
  buildDiffSummaryMarkdown,
  buildMessageMarkdown,
  buildProjectMarkdown,
  buildPullRequestBody,
  buildRoomMarkdown,
  buildSelectedMessagesMarkdown,
  buildTerminalMarkdown
} from "./lib/markdownExport";
import {
  maxCodexModelChars,
  maxRoomProjectPathChars,
  normalizeCodexModel,
  normalizeProjectPath,
  planRoomCreation,
  planTeamCreation
} from "./lib/workspaceCreation";
import {
  canAcceptRoomHostHandoff,
  createHandoffSettingsPatch,
  findRoomHostHandoff,
  isRoomHostMutationInFlight,
  roomHostHandoffMessage,
  roomHostMutationInFlightMessage
} from "./lib/hostHandoff";
import { detectBrowserSecretRisks, detectSecretRisks, detectTerminalCommandRisks } from "./lib/secretRisks";
import { createGitWorkflowApprovalPlan, formatGitWorkflowApprovalPreview } from "@multaiplayer/git";
import { normalizeGitHubBranchName } from "@multaiplayer/github";
import {
  canActOnRoomInviteRequest,
  findRoomInviteRequest,
  roomInviteRequestMessage
} from "./lib/inviteApproval";
import {
  canActOnRoomTerminalRequest,
  findRoomTerminalRequest,
  isRoomTerminalActionInFlight,
  roomTerminalActionInFlightMessage,
  roomTerminalRequestMessage,
  terminalRequestForApprovedRun
} from "./lib/terminalApproval";
import { canControlRoomTerminal, roomTerminalControlMessage } from "./lib/terminalAccess";
import { readInviteUrlPayload } from "./lib/inviteUrl";
import { displayableInviteLink } from "./lib/invitePrivacy";
import { canCreateRoomInvite } from "./lib/invitePolicy";
import {
  browserAccessGateMessage,
  canActOnRoomBrowserRequest,
  canHostBrowserAction,
  canRequestBrowserAccess,
  findRoomBrowserRequest,
  normalizeBrowserAllowedOrigins,
  roomBrowserRequestMessage,
  shouldAutoApproveBrowserRequest
} from "./lib/browserPolicy";
import { browserDecisionMessageId, buildBrowserDecisionMessage } from "./lib/browserActivity";
import { attachmentReviewMessage, attachmentReviewScopeKey, decideAttachmentReview, reviewedAttachmentPathForScope } from "./lib/attachmentPolicy";
import { isLocalUserActiveHostForRoom } from "./lib/roomHost";
import {
  canRequestWorkspaceAction,
  canUseLocalWorkspace,
  isRoomFileActionInFlight,
  localWorkspaceGateMessage,
  roomFileActionInFlightMessage
} from "./lib/workspaceAccess";
import { shouldApplyRoomScopedUiUpdate } from "./lib/roomScopedUi";
import { normalizeChatMessage } from "./lib/chatSanitizer";
import { canStageRoomChatAttachment, canUseRoomChat, roomChatGateMessage } from "./lib/chatPolicy";
import { messageInvokesCodex } from "./lib/codexInvoke";
import { resolveFilePreviewTab, type FilePreviewTab } from "./lib/filePreview";
import { copyTextToClipboard } from "./lib/clipboard";
import {
  checkGitHubActionsReadiness,
  checkGitHubWorkflowReadiness,
  gitHubActionsRefreshInFlightMessage,
  isGitHubActionsRefreshInFlight,
  type GitHubActionsTarget
} from "./lib/githubWorkflowReadiness";
import {
  defaultGitWorkflowDraft,
  gitWorkflowInFlightMessage,
  isGitWorkflowInFlight,
  parseGitHubRemoteUrl,
  resolveGitWorkflowDraft,
  updateGitWorkflowDraftRecord,
  type GitWorkflowDraft
} from "./lib/gitWorkflowDraft";
import { markRoomRead, markRoomUnreadForIncomingChat, upsertRoomPreservingUnread } from "./lib/roomUnread";
import { isRoomKeyRotationInFlight, roomKeyRotationInFlightMessage } from "./lib/roomKeyRotation";
import { isMembershipRemovedRelayError, membershipRemovedRoomMessage } from "./lib/relayAccess";
import { roomPostureSummary } from "./lib/roomPosture";
import { findSidebarMessageHits, mergeSearchableMessages, searchMatches } from "./lib/sidebarSearch";
import { replaceRoomTerminalSnapshots } from "./lib/terminalState";
import {
  acknowledgeRoomVisibilityWarning as saveRoomVisibilityWarningAcknowledgement,
  clearRoomVisibilityWarningAcknowledgement,
  hasAcknowledgedRoomVisibilityWarning
} from "./lib/roomVisibilityWarning";
import { InfoRow, InlineSecretWarning, StatusPill } from "./components/common";
import { InspectorTabs, type InspectorTab } from "./components/InspectorTabs";
import { RoomSettingsOverview } from "./components/RoomSettingsOverview";
import { RoomHeader } from "./components/RoomHeader";
import { CodexApprovalCard } from "./components/CodexApprovalCard";
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
import { RoomMembersPanel, TeamRosterPanel, type RoomMemberDisplay, type TeamMemberDisplay } from "./components/RosterPanels";
import { inspectorAttentionCounts } from "./lib/inspectorAttention";

interface ChatMessage {
  id: string;
  author: string;
  role: "human" | "codex" | "system";
  body: string;
  time: string;
  createdAt?: string;
  attachments?: ChatAttachment[];
  reactions?: ChatReaction[];
}

interface ChatReaction {
  emoji: string;
  reactors: Array<{ userId: string; name: string }>;
}

interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  content?: string;
  blobId?: string;
  blobBytes?: number;
  truncated?: boolean;
}

interface PendingCodexApproval {
  roomId: string;
  messages: ChatMessage[];
  summary: CodexTurnSummary;
}

interface RoomPresence {
  userId: string;
  deviceId: string;
  displayName: string;
  avatarUrl?: string;
  publicKeyFingerprint?: string;
  status: "online" | "offline";
}

interface TerminalCommandRequest extends TerminalRequestPlaintextPayload {
  status: "pending" | "approved" | "denied";
}

interface BrowserAccessRequest extends BrowserRequestPlaintextPayload {
  status: "pending" | "approved" | "denied";
}

interface BrowserStatus {
  profilePath: string | null;
  downloadsBlocked: boolean;
  clipboardBlocked: boolean;
  fileUploadsBlocked: boolean;
}

interface InviteJoinRequest extends InviteJoinRequestPlaintextPayload {
  status: "pending" | "approved" | "denied";
}

interface CodexRoomEvent extends CodexEventPlaintextPayload {}

interface HostHandoffRecord extends HostHandoffPlaintextPayload {
  status: "available" | "accepted";
}

interface MarkdownCopyFallback {
  title: string;
  markdown: string;
}

interface NoSecretRoomInvite {
  version: 1;
  teamId: string;
  roomId: string;
  roomName: string;
  hostDeviceId: string;
  hostPublicKeyJwk: Record<string, unknown>;
  hostPublicKeyFingerprint: string;
}

interface LocalRoomHistoryPayload {
  version: 3;
  messages: ChatMessage[];
  terminalRequests: TerminalCommandRequest[];
  browserRequests: BrowserAccessRequest[];
  inviteRequests: InviteJoinRequest[];
  codexEvents: CodexRoomEvent[];
  gitWorkflowEvents: GitWorkflowEventPlaintextPayload[];
  githubActionsEvents: GitHubActionsEventPlaintextPayload[];
  terminalSnapshots: TerminalSnapshot[];
  hostHandoffs: HostHandoffRecord[];
  codexThreadId?: string;
}

type RelayStatus = "connecting" | "open" | "closed" | "error";
type SidebarPanel = "profile" | "settings" | null;

const fallbackUser = {
  id: "github:maddiedreese",
  name: "Maddie"
};

const seededTeams: TeamRecord[] = [
  { id: "team-core", name: "Core Team", members: 4, role: "owner" },
  { id: "team-labs", name: "Labs", members: 2 }
];

const seededTeamMembers: Record<string, TeamMemberRecord[]> = {
  "team-core": [
    { teamId: "team-core", userId: "github:maddiedreese", role: "owner", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-core", userId: "github:alex", role: "admin", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-core", userId: "github:tester", role: "member", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-core", userId: "github:design", role: "member", joinedAt: "2026-07-04T00:00:00.000Z" }
  ],
  "team-labs": [
    { teamId: "team-labs", userId: "github:labs", role: "owner", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-labs", userId: "github:research", role: "member", joinedAt: "2026-07-04T00:00:00.000Z" }
  ]
};

const seededRooms: RoomRecord[] = [
  {
    id: "room-desktop",
    teamId: "team-core",
    name: "Desktop client",
    projectPath: defaultProjectPath,
    host: "Maddie",
    hostUserId: fallbackUser.id,
    hostStatus: "active",
    approvalPolicy: "ask_every_turn",
    mode: { ...defaultRoomMode, browser: true },
    codexModel: defaultCodexModel,
    browserAllowedOrigins: defaultBrowserAllowedOrigins,
    browserProfilePersistent: defaultBrowserProfilePersistent,
    unread: 0
  },
  {
    id: "room-relay",
    teamId: "team-core",
    name: "Relay + E2EE",
    projectPath: defaultProjectPath,
    host: "Alex",
    hostUserId: "github:alex",
    hostStatus: "handoff",
    approvalPolicy: "auto_chat_only",
    mode: defaultRoomMode,
    codexModel: "gpt-5.4-mini",
    browserAllowedOrigins: defaultBrowserAllowedOrigins,
    browserProfilePersistent: defaultBrowserProfilePersistent,
    unread: 2
  },
  {
    id: "room-github",
    teamId: "team-labs",
    name: "GitHub flow",
    projectPath: defaultProjectPath,
    host: "No host",
    hostUserId: undefined,
    hostStatus: "offline",
    approvalPolicy: "never_host",
    mode: defaultRoomMode,
    codexModel: "gpt-5.4-thinking",
    browserAllowedOrigins: defaultBrowserAllowedOrigins,
    browserProfilePersistent: defaultBrowserProfilePersistent,
    unread: 0
  }
];

const emptyRoom: RoomRecord = {
  id: "__empty-room",
  teamId: "__empty-team",
  name: "No room selected",
  projectPath: defaultProjectPath,
  host: "No host",
  hostUserId: undefined,
  hostStatus: "offline",
  approvalPolicy: "ask_every_turn",
  mode: defaultRoomMode,
  codexModel: defaultCodexModel,
  browserAllowedOrigins: defaultBrowserAllowedOrigins,
  browserProfilePersistent: defaultBrowserProfilePersistent,
  unread: 0
};

const initialMessages: ChatMessage[] = [
  {
    id: "m1",
    author: "Maddie",
    role: "human",
    body: "Let's make the first pass feel like a coding room, not a generic chat wrapper.",
    time: "10:14"
  },
  {
    id: "m2",
    author: "Sam",
    role: "human",
    body: "Agree. The right rail should show files and diffs while Codex is working.",
    time: "10:15"
  },
  {
    id: "m3",
    author: "Priya",
    role: "human",
    body: "@Codex can you wire the approval sheet to show chat delta, attachments, browser access, terminals, and workspace?",
    time: "10:17",
    attachments: [{ id: "att-seed-approval", name: "approval-flow.sketch", type: "image", size: 2400000 }]
  },
  {
    id: "m4",
    author: "Codex via Maddie",
    role: "codex",
    body: "I can do that. I will use the current chat delta, selected project folder, and the dev-server terminal. I will not use browser access unless approved.",
    time: "10:18"
  },
  {
    id: "m5",
    author: "Maddie",
    role: "human",
    body: "Next turn should also include copy-as-markdown and the secret warning.",
    time: "10:20"
  }
];

const initialMessagesByRoom: Record<string, ChatMessage[]> = {
  "room-desktop": initialMessages,
  "room-relay": [
    {
      id: "relay-m1",
      author: "Alex",
      role: "human",
      body: "The relay should only ever see encrypted envelopes and room metadata.",
      time: "09:52"
    },
    {
      id: "relay-m2",
      author: "Maddie",
      role: "human",
      body: "Yes. Gated invites should only carry metadata and the host device key; approval can deliver the room key wrapped to the joiner's device.",
      time: "09:55"
    }
  ],
  "room-github": [
    {
      id: "github-m1",
      author: "Priya",
      role: "human",
      body: "V1 needs local commits, optional push, draft PR creation, and visible GitHub Actions status.",
      time: "11:03"
    }
  ]
};

const approvalPolicyLabels: Record<ApprovalPolicy, string> = {
  ask_every_turn: "Ask every Codex turn",
  auto_chat_only: "Auto-approve chat-only turns",
  auto_browser_allowed_sites: "Auto-approve allowed browser sites",
  never_host: "Never host this room"
};

const roomModeLabels: Record<keyof RoomMode, string> = {
  chat: "Chat",
  code: "Code",
  workspace: "Workspace",
  browser: "Browser"
};

const initialTerminalLines = [
  "$ npm run dev:desktop",
  "VITE v6.0.11 ready in 392 ms",
  "Local: http://127.0.0.1:1420/",
  "$ npm run check",
  "TypeScript watching for changes..."
];
const initialTerminalLinesByRoom: Record<string, string[]> = {
  "room-desktop": initialTerminalLines
};
const maxTerminalActivityLines = 1000;

const defaultBrowserStatus: BrowserStatus = {
  profilePath: null,
  downloadsBlocked: false,
  clipboardBlocked: false,
  fileUploadsBlocked: false
};
const defaultBrowserUrl = "https://github.com/maddiedreese/multAIplayer";
const defaultBrowserReason = "Use this page as Codex browser context.";

export function App() {
  const [teams, setTeams] = useState<TeamRecord[]>(seededTeams);
  const [rooms, setRooms] = useState<RoomRecord[]>(seededRooms);
  const [teamMembersByTeam, setTeamMembersByTeam] = useState<Record<string, TeamMemberRecord[]>>(seededTeamMembers);
  const [teamMembersMessageByTeam, setTeamMembersMessageByTeam] = useState<Record<string, string | null>>({});
  const [teamMembersBusyByTeam, setTeamMembersBusyByTeam] = useState<Record<string, boolean>>({});
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<SidebarPanel>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>(() => loadAppConfig());
  const [relayHttpDraft, setRelayHttpDraft] = useState(() => loadAppConfig().relayHttpUrl);
  const [relayWsDraft, setRelayWsDraft] = useState(() => loadAppConfig().relayWsUrl);
  const [appConfigMessage, setAppConfigMessage] = useState<string | null>(null);
  const [hostBusyByRoom, setHostBusyByRoom] = useState<Record<string, boolean>>({});
  const [hostMessagesByRoom, setHostMessagesByRoom] = useState<Record<string, string | null>>({});
  const [chatMessagesByRoom, setChatMessagesByRoom] = useState<Record<string, string | null>>({});
  const [settingsBusyByRoom, setSettingsBusyByRoom] = useState<Record<string, boolean>>({});
  const [settingsMessagesByRoom, setSettingsMessagesByRoom] = useState<Record<string, string | null>>({});
  const [customCodexModelsByRoom, setCustomCodexModelsByRoom] = useState<Record<string, string>>({});
  const [projectPathDraftsByRoom, setProjectPathDraftsByRoom] = useState<Record<string, string>>({});
  const [browserAllowedOriginsDraftsByRoom, setBrowserAllowedOriginsDraftsByRoom] = useState<Record<string, string>>({});
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
  const [teamDefaultBrowserAllowedOriginsDraft, setTeamDefaultBrowserAllowedOriginsDraft] = useState(() =>
    loadTeamRoomDefaults(seededTeams[0].id).browserAllowedOrigins.join("\n")
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
  const [inviteRequestsByRoom, setInviteRequestsByRoom] = useState<Record<string, InviteJoinRequest[]>>({});
  const [codexEventsByRoom, setCodexEventsByRoom] = useState<Record<string, CodexRoomEvent[]>>({});
  const [gitWorkflowEventsByRoom, setGitWorkflowEventsByRoom] = useState<Record<string, GitWorkflowEventPlaintextPayload[]>>({});
  const [githubActionsEventsByRoom, setGitHubActionsEventsByRoom] = useState<Record<string, GitHubActionsEventPlaintextPayload[]>>({});
  const [draftsByRoom, setDraftsByRoom] = useState<Record<string, string>>({});
  const [selectedMessageIdsByRoom, setSelectedMessageIdsByRoom] = useState<Record<string, string[]>>({});
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
  const [browserRequestsByRoom, setBrowserRequestsByRoom] = useState<Record<string, BrowserAccessRequest[]>>({});
  const [browserUrlsByRoom, setBrowserUrlsByRoom] = useState<Record<string, string>>({});
  const [browserReasonsByRoom, setBrowserReasonsByRoom] = useState<Record<string, string>>({});
  const [browserMessagesByRoom, setBrowserMessagesByRoom] = useState<Record<string, string | null>>({});
  const [browserStatusByRoom, setBrowserStatusByRoom] = useState<Record<string, BrowserStatus>>({});
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("closed");
  const [authConfig, setAuthConfig] = useState<GitHubAuthConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<SignedInUser | null>(null);
  const [deviceFlow, setDeviceFlow] = useState<GitHubDeviceStart | null>(null);
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceIdentityMessage, setDeviceIdentityMessage] = useState<string | null>(null);
  const [trustedDeviceKeys, setTrustedDeviceKeys] = useState<TrustedDeviceKey[]>(() => loadTrustedDeviceKeys());
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
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
  const relayRef = useRef<RelayClient | null>(null);
  const seenEnvelopeIds = useRef(new Set<string>());
  const historyLoadedRoomIds = useRef(new Set<string>());
  const roomsRef = useRef<RoomRecord[]>(rooms);
  const selectedRoomIdRef = useRef(selectedRoomId);
  const gitWorkflowDraftsRef = useRef(gitWorkflowDraftsByRoom);
  const hostBusyRef = useRef(hostBusyByRoom);
  const settingsBusyRef = useRef(settingsBusyByRoom);
  const keyRotationBusyRef = useRef(keyRotationBusyByRoom);
  const gitWorkflowBusyRef = useRef(gitWorkflowBusyByRoom);
  const actionsBusyRef = useRef(actionsBusyByRoom);
  const terminalBusyRef = useRef(terminalBusyByRoom);
  const fileBusyRef = useRef(fileBusyByRoom);
  const browserRequestsRef = useRef(browserRequestsByRoom);
  const deviceId = useMemo(() => loadOrCreateDeviceId(), []);
  const localUser = useMemo(
    () => ({
      id: currentUser?.id ?? fallbackUser.id,
      name: currentUser?.name ?? currentUser?.login ?? fallbackUser.name,
      avatarUrl: currentUser?.avatarUrl
    }),
    [currentUser]
  );

  const hasSelectedRoom = rooms.some((room) => room.id === selectedRoomId);
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? emptyRoom;
  const inspectorTab = inspectorTabsByRoom[selectedRoom.id] ?? "work";
  const selectedTeamRecord = teams.find((team) => team.id === selectedTeam) ?? null;
  const selectedTeamName = selectedTeamRecord?.name ?? (teams.length ? "No team selected" : "No teams yet");
  const selectedTeamMembers = teamMembersByTeam[selectedTeam] ?? [];
  const selectedTeamMembersMessage = teamMembersMessageByTeam[selectedTeam] ?? null;
  const selectedTeamMembersBusy = teamMembersBusyByTeam[selectedTeam] ?? false;
  const selectedTeamMemberRows: TeamMemberDisplay[] = selectedTeamMembers.map((member) => ({
    member,
    initial: formatTeamMemberInitial(member.userId),
    name: formatTeamMemberName(member.userId, currentUser),
    roleLabel: formatTeamRole(member.role),
    joinedLabel: formatTeamMemberJoinedAt(member.joinedAt),
    canPromote: canPromoteTeamMember(selectedTeamRecord, member),
    canDemote: canDemoteTeamMember(selectedTeamRecord, member),
    canTransferOwnership: canTransferTeamOwnership(selectedTeamRecord, member, localUser.id),
    canRemove: canRemoveTeamMember(selectedTeamRecord, member)
  }));
  const selectedCodexModel = selectedRoom?.codexModel ?? defaultCodexModel;
  const selectedBrowserAllowedOrigins = selectedRoom.browserAllowedOrigins ?? defaultBrowserAllowedOrigins;
  const customCodexModel = customCodexModelsByRoom[selectedRoom?.id ?? selectedRoomId] ?? selectedCodexModel;
  const projectPathDraft = projectPathDraftsByRoom[selectedRoom?.id ?? selectedRoomId] ?? selectedRoom.projectPath;
  const browserAllowedOriginsDraft = browserAllowedOriginsDraftsByRoom[selectedRoom?.id ?? selectedRoomId] ?? selectedBrowserAllowedOrigins.join("\n");
  const messages = messagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const draft = draftsByRoom[selectedRoom?.id ?? selectedRoomId] ?? "";
  const selectedMessageIds = selectedMessageIdsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const selectedMessages = messages.filter((message) => selectedMessageIds.includes(message.id));
  const pendingAttachments = pendingAttachmentsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const pendingAttachmentBytes = embeddedAttachmentBytes(pendingAttachments);
  const browserRequests = browserRequestsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const browserUrl = browserUrlsByRoom[selectedRoom?.id ?? selectedRoomId] ?? defaultBrowserUrl;
  const browserReason = browserReasonsByRoom[selectedRoom?.id ?? selectedRoomId] ?? defaultBrowserReason;
  const browserMessage = browserMessagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const browserStatus = browserStatusByRoom[selectedRoom?.id ?? selectedRoomId] ?? defaultBrowserStatus;
  const gitStatus = gitStatusByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const gitWorkflowDraft = resolveGitWorkflowDraft(gitWorkflowDraftsByRoom, selectedRoom?.id ?? selectedRoomId);
  const gitWorkflowBusy = gitWorkflowBusyByRoom[selectedRoom?.id ?? selectedRoomId] ?? false;
  const gitWorkflowMessage = gitWorkflowMessagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const actionRuns = actionRunsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const actionsBusy = actionsBusyByRoom[selectedRoom?.id ?? selectedRoomId] ?? false;
  const actionsLastChecked = actionsLastCheckedByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const actionsMessage = actionsMessagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const terminalLines = terminalLinesByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const terminalBusy = terminalBusyByRoom[selectedRoom?.id ?? selectedRoomId] ?? false;
  const selectedTerminalId = selectedTerminalIdsByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const terminalName = terminalNamesByRoom[selectedRoom?.id ?? selectedRoomId] ?? "dev-server";
  const terminalCommand = terminalCommandsByRoom[selectedRoom?.id ?? selectedRoomId] ?? "npm run dev:desktop";
  const terminalInput = terminalInputsByRoom[selectedRoom?.id ?? selectedRoomId] ?? "";
  const terminalError = terminalErrorsByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const fileQuery = fileQueriesByRoom[selectedRoom?.id ?? selectedRoomId] ?? "";
  const projectFiles = projectFilesByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const selectedFile = selectedFilesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const selectedDiff = selectedDiffsByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const filePreviewTab = resolveFilePreviewTab(
    filePreviewTabsByRoom[selectedRoom?.id ?? selectedRoomId] ?? "file",
    Boolean(selectedDiff?.diff.trim())
  );
  const fileBusy = fileBusyByRoom[selectedRoom?.id ?? selectedRoomId] ?? false;
  const fileMessage = fileMessagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const inviteLink = inviteLinksByRoom[selectedRoom?.id ?? selectedRoomId] ?? "";
  const inviteApprovalGate = inviteApprovalGatesByRoom[selectedRoom?.id ?? selectedRoomId] ?? false;
  const inviteMessage = inviteMessagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const hostMessage = hostMessagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const chatMessage = chatMessagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const settingsMessage = settingsMessagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const historyMessage = historyMessagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const teamHistoryMessage = teamHistoryMessagesByTeam[selectedTeam || "__no-team"] ?? null;
  const visibleHistoryMessage = historyMessage ?? teamHistoryMessage;
  const markdownCopyFallback = markdownCopyFallbacksByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const secretWarningVisible = hasSelectedRoom && (
    secretWarningsVisibleByRoom[selectedRoom?.id ?? selectedRoomId] ??
    !hasAcknowledgedRoomVisibilityWarning(selectedRoom?.id ?? selectedRoomId)
  );
  const isActiveHost = isLocalUserActiveHostForRoom(selectedRoom, localUser);
  const isSelectedRoomForgotten = forgottenRoomIds.has(selectedRoom.id);
  const isSelectedRoomRevoked = revokedRoomIds.has(selectedRoom.id) || revokedTeamIds.has(selectedRoom.teamId);
  const isSelectedRoomLocked = isSelectedRoomForgotten || isSelectedRoomRevoked;
  const canReadLocalWorkspace = hasSelectedRoom && canUseLocalWorkspace(selectedRoom, localUser, isSelectedRoomLocked);
  const canRequestWorkspace = hasSelectedRoom && canRequestWorkspaceAction(selectedRoom, isSelectedRoomLocked);
  const canRequestBrowser = hasSelectedRoom && canRequestBrowserAccess(selectedRoom, isSelectedRoomLocked);
  const canHostBrowser = hasSelectedRoom && canHostBrowserAction(selectedRoom, localUser, isSelectedRoomLocked);
  const canCopyRoomInvite = hasSelectedRoom && canCreateRoomInvite(selectedRoom, localUser, isSelectedRoomLocked, inviteApprovalGate);
  const localWorkspaceMessage = localWorkspaceGateMessage(selectedRoom, isSelectedRoomLocked);
  const roomPosture = roomPostureSummary({
    locked: isSelectedRoomLocked,
    isActiveHost,
    canReadLocalWorkspace,
    historySettings,
    browserProfilePersistent: selectedRoom.browserProfilePersistent,
    mode: selectedRoom.mode
  });
  const browserAccessMessage = browserAccessGateMessage(selectedRoom, isSelectedRoomLocked);
  const workspaceRequestMessage = isSelectedRoomLocked
    ? roomLockMessage(selectedRoom, isSelectedRoomRevoked)
    : "Workspace mode is disabled for this room.";
  const hostGateMessage =
    selectedRoom.hostStatus === "active"
      ? `Only ${selectedRoom.host} can approve host-side actions in this room.`
      : "Claim host before approving host-side actions in this room.";
  const roomSettingsGateMessage =
    selectedRoom.hostStatus === "active"
      ? `Only ${selectedRoom.host} can change room host settings.`
      : "Claim host before changing room host settings.";
  const actionsSummary = useMemo(() => summarizeActionRuns(actionRuns), [actionRuns]);
  const githubWorkflowReadiness = useMemo(() => checkGitHubWorkflowReadiness({
    pushEnabled: gitWorkflowDraft.pushEnabled,
    authConfig,
    currentUser,
    owner: gitWorkflowDraft.prOwner,
    repo: gitWorkflowDraft.prRepo,
    head: gitWorkflowDraft.branchName,
    base: gitWorkflowDraft.prBase
  }), [authConfig, currentUser, gitWorkflowDraft.branchName, gitWorkflowDraft.prBase, gitWorkflowDraft.prOwner, gitWorkflowDraft.prRepo, gitWorkflowDraft.pushEnabled]);
  const githubActionsReadiness = useMemo(() => checkGitHubActionsReadiness({
    authConfig,
    currentUser,
    owner: gitWorkflowDraft.prOwner,
    repo: gitWorkflowDraft.prRepo,
    branch: gitWorkflowDraft.branchName
  }), [authConfig, currentUser, gitWorkflowDraft.branchName, gitWorkflowDraft.prOwner, gitWorkflowDraft.prRepo]);
  const gitApprovalPreview = useMemo(() => {
    try {
      const plan = createGitWorkflowApprovalPlan(
        selectedRoom.projectPath,
        gitWorkflowDraft.branchName,
        gitWorkflowDraft.commitMessage,
        gitWorkflowDraft.pushEnabled
      );
      const normalizedBase = gitWorkflowDraft.pushEnabled ? normalizeGitHubBranchName(gitWorkflowDraft.prBase.trim() || "main") : gitWorkflowDraft.prBase.trim();
      return {
        plan,
        normalizedBase,
        steps: formatGitWorkflowApprovalPreview(plan),
        error: null
      };
    } catch (error) {
      return {
        plan: null,
        normalizedBase: gitWorkflowDraft.prBase.trim(),
        steps: [],
        error: String(error)
      };
    }
  }, [gitWorkflowDraft.branchName, gitWorkflowDraft.commitMessage, gitWorkflowDraft.prBase, gitWorkflowDraft.pushEnabled, selectedRoom.projectPath]);
  const roomTerminals = useMemo(
    () => terminals.filter((terminal) => terminal.roomId === selectedRoom.id),
    [terminals, selectedRoom.id]
  );
  const codexTurnSummary = useMemo(
    () => buildCodexTurnSummary(messages, selectedRoom, roomTerminals, browserRequests, gitStatus, {
      includeWorkspaceContext: canReadLocalWorkspace
    }),
    [messages, selectedRoom, roomTerminals, browserRequests, gitStatus, canReadLocalWorkspace]
  );
  const activeCodexApproval = pendingCodexApprovalsByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const approvalVisible = approvalVisibleByRoom[selectedRoom?.id ?? selectedRoomId] ?? false;
  const visibleCodexTurnSummary = activeCodexApproval?.summary ?? codexTurnSummary;
  const roomMembers = Object.values(presenceByRoom[selectedRoom?.id ?? selectedRoomId] ?? {})
    .filter((member) => member.status === "online")
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const visibleRoomMembers: RoomPresence[] = roomMembers.length ? roomMembers : [{
    userId: localUser.id,
    deviceId,
    displayName: localUser.name,
    avatarUrl: localUser.avatarUrl,
    publicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
    status: "online" as const
  }];
  const roomMemberRows: RoomMemberDisplay[] = visibleRoomMembers.map((member) => {
    const trusted = isDeviceKeyTrusted(
      trustedDeviceKeys,
      selectedRoom.id,
      member.deviceId,
      member.publicKeyFingerprint
    );
    return {
      ...member,
      trusted,
      isHost: isRoomHostMember(member, selectedRoom),
      deviceLabel: formatMemberDeviceLabel(member, deviceId, trusted)
    };
  });
  const selectedTerminal = roomTerminals.find((terminal) => terminal.id === selectedTerminalId) ?? null;
  const selectedTerminalCanRestart = Boolean(selectedTerminal && !selectedTerminal.running);
  const hostHandoffs = hostHandoffsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const terminalRequests = terminalRequestsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const inspectorAttention = inspectorAttentionCounts({ approvalVisible, terminalRequests, browserRequests });
  const inviteRequests = inviteRequestsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const codexEvents = codexEventsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const gitWorkflowEvents = gitWorkflowEventsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const githubActionsEvents = githubActionsEventsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const selectedCodexThreadId = codexThreadIdsByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const codexRunning = codexRunningByRoom[selectedRoom?.id ?? selectedRoomId] ?? false;
  const codexApprovalSummaryDisplay = {
    messages: `${visibleCodexTurnSummary.messagesSinceLastCodex} since last Codex response`,
    attachments: formatCodexAttachmentSummary(visibleCodexTurnSummary.attachments),
    workspace: selectedRoom.mode.workspace ? visibleCodexTurnSummary.workspacePath ?? "None" : "Disabled",
    git: formatCodexGitSummary(visibleCodexTurnSummary.git),
    browser: selectedRoom.mode.browser ? visibleCodexTurnSummary.browserAccess.join(", ") || "No pages shared" : "Disabled",
    terminals: visibleCodexTurnSummary.terminals.join(", ") || "None",
    model: formatCodexModel(selectedCodexModel),
    thread: formatCodexThreadId(selectedCodexThreadId),
    policy: approvalPolicyLabels[selectedRoom.approvalPolicy]
  };
  const hostBusy = hostBusyByRoom[selectedRoom?.id ?? selectedRoomId] ?? false;
  const settingsBusy = settingsBusyByRoom[selectedRoom?.id ?? selectedRoomId] ?? false;
  const keyRotationBusy = keyRotationBusyByRoom[selectedRoom?.id ?? selectedRoomId] ?? false;
  const hostStatusLabel = formatHostStatus(selectedRoom);

  function setGitWorkflowMessageForRoom(roomId: string, message: string | null) {
    setGitWorkflowMessagesByRoom((current) => ({
      ...current,
      [roomId]: message
    }));
  }

  function setGitWorkflowBusyForRoom(roomId: string, busy: boolean) {
    gitWorkflowBusyRef.current = busy
      ? { ...gitWorkflowBusyRef.current, [roomId]: true }
      : omitRecordKey(gitWorkflowBusyRef.current, roomId);
    setGitWorkflowBusyByRoom((current) => busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setActionsBusyForRoom(roomId: string, busy: boolean) {
    actionsBusyRef.current = busy
      ? { ...actionsBusyRef.current, [roomId]: true }
      : omitRecordKey(actionsBusyRef.current, roomId);
    setActionsBusyByRoom((current) => busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setHostBusyForRoom(roomId: string, busy: boolean) {
    hostBusyRef.current = busy
      ? { ...hostBusyRef.current, [roomId]: true }
      : omitRecordKey(hostBusyRef.current, roomId);
    setHostBusyByRoom((current) => busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setHostMessageForRoom(roomId: string, message: string | null) {
    setHostMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedHostMessage(message: string | null) {
    setHostMessageForRoom(selectedRoom.id, message);
  }

  function reportRoomHostMutationInFlight(roomId: string): boolean {
    if (!isRoomHostMutationInFlight(hostBusyRef.current, roomId)) return false;
    setHostMessageForRoom(roomId, roomHostMutationInFlightMessage());
    return true;
  }

  function setChatMessageForRoom(roomId: string, message: string | null) {
    setChatMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedChatMessage(message: string | null) {
    setChatMessageForRoom(selectedRoom.id, message);
  }

  function setMarkdownCopyFallbackForRoom(roomId: string, fallback: MarkdownCopyFallback | null) {
    setMarkdownCopyFallbacksByRoom((current) => fallback ? { ...current, [roomId]: fallback } : omitRecordKey(current, roomId));
  }

  function setSecretWarningVisibleForRoom(roomId: string, visible: boolean) {
    setSecretWarningsVisibleByRoom((current) => visible ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setHistoryMessageForRoom(roomId: string, message: string | null) {
    setHistoryMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedHistoryMessage(message: string | null) {
    setHistoryMessageForRoom(selectedRoom.id, message);
  }

  function setTeamHistoryMessageForTeam(teamId: string, message: string | null) {
    setTeamHistoryMessagesByTeam((current) => message ? { ...current, [teamId || "__no-team"]: message } : omitRecordKey(current, teamId || "__no-team"));
  }

  function setSelectedTeamHistoryMessage(message: string | null) {
    setTeamHistoryMessageForTeam(selectedTeam || "__no-team", message);
  }

  function setSettingsBusyForRoom(roomId: string, busy: boolean) {
    settingsBusyRef.current = busy
      ? { ...settingsBusyRef.current, [roomId]: true }
      : omitRecordKey(settingsBusyRef.current, roomId);
    setSettingsBusyByRoom((current) => busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setSettingsMessageForRoom(roomId: string, message: string | null) {
    setSettingsMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedSettingsMessage(message: string | null) {
    setSettingsMessageForRoom(selectedRoom.id, message);
  }

  function reportRoomSettingsMutationInFlight(
    roomId: string,
    setMessage: (roomId: string, message: string | null) => void = setSettingsMessageForRoom
  ): boolean {
    if (!isRoomSettingsMutationInFlight(settingsBusyRef.current, roomId)) return false;
    setMessage(roomId, roomSettingsMutationInFlightMessage());
    return true;
  }

  function setKeyRotationBusyForRoom(roomId: string, busy: boolean) {
    keyRotationBusyRef.current = busy
      ? { ...keyRotationBusyRef.current, [roomId]: true }
      : omitRecordKey(keyRotationBusyRef.current, roomId);
    setKeyRotationBusyByRoom((current) => busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function reportRoomKeyRotationInFlight(roomId: string): boolean {
    if (!isRoomKeyRotationInFlight(keyRotationBusyRef.current, roomId)) return false;
    setInviteMessageForRoom(roomId, roomKeyRotationInFlightMessage());
    return true;
  }

  function setApprovalVisibleForRoom(roomId: string, visible: boolean) {
    setApprovalVisibleByRoom((current) => visible ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setPendingCodexApprovalForRoom(
    roomId: string,
    approval: PendingCodexApproval | null
  ) {
    setPendingCodexApprovalsByRoom((current) => approval ? { ...current, [roomId]: approval } : omitRecordKey(current, roomId));
  }

  function resetCodexApprovalForRoom(roomId: string) {
    setPendingCodexApprovalForRoom(roomId, null);
    setApprovalVisibleForRoom(roomId, false);
  }

  function setCodexRunningForRoom(roomId: string, running: boolean) {
    setCodexRunningByRoom((current) => running ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setCustomCodexModelForRoom(roomId: string, model: string) {
    const room = roomsRef.current.find((item) => item.id === roomId);
    const currentModel = room?.codexModel ?? defaultCodexModel;
    setCustomCodexModelsByRoom((current) => model === currentModel ? omitRecordKey(current, roomId) : { ...current, [roomId]: model });
  }

  function setProjectPathDraftForRoom(roomId: string, projectPath: string) {
    const room = roomsRef.current.find((item) => item.id === roomId);
    const currentProjectPath = room?.projectPath ?? defaultProjectPath;
    setProjectPathDraftsByRoom((current) => projectPath === currentProjectPath ? omitRecordKey(current, roomId) : { ...current, [roomId]: projectPath });
  }

  function setBrowserAllowedOriginsDraftForRoom(roomId: string, draftValue: string) {
    const room = roomsRef.current.find((item) => item.id === roomId);
    const currentOrigins = room?.browserAllowedOrigins ?? defaultBrowserAllowedOrigins;
    const currentDraft = currentOrigins.join("\n");
    setBrowserAllowedOriginsDraftsByRoom((current) => draftValue === currentDraft ? omitRecordKey(current, roomId) : { ...current, [roomId]: draftValue });
  }

  function setFileQueryForRoom(roomId: string, query: string) {
    setFileQueriesByRoom((current) => query ? { ...current, [roomId]: query } : omitRecordKey(current, roomId));
  }

  function setProjectFilesForRoom(roomId: string, files: ProjectFileEntry[]) {
    setProjectFilesByRoom((current) => ({
      ...current,
      [roomId]: files
    }));
  }

  function setSelectedFileForRoom(roomId: string, file: ProjectFileContent | null) {
    setSelectedFilesByRoom((current) => file ? { ...current, [roomId]: file } : omitRecordKey(current, roomId));
  }

  function setSelectedDiffForRoom(roomId: string, diff: GitDiffResult | null) {
    setSelectedDiffsByRoom((current) => diff ? { ...current, [roomId]: diff } : omitRecordKey(current, roomId));
  }

  function setFilePreviewTabForRoom(roomId: string, tab: FilePreviewTab) {
    setFilePreviewTabsByRoom((current) => tab === "file" ? omitRecordKey(current, roomId) : { ...current, [roomId]: tab });
  }

  function setFileBusyForRoom(roomId: string, busy: boolean) {
    fileBusyRef.current = busy
      ? { ...fileBusyRef.current, [roomId]: true }
      : omitRecordKey(fileBusyRef.current, roomId);
    setFileBusyByRoom((current) => busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setFileMessageForRoom(roomId: string, message: string | null) {
    setFileMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedFileMessage(message: string | null) {
    setFileMessageForRoom(selectedRoom.id, message);
  }

  function reportRoomFileActionInFlight(roomId: string): boolean {
    if (!isRoomFileActionInFlight(fileBusyRef.current, roomId)) return false;
    setFileMessageForRoom(roomId, roomFileActionInFlightMessage());
    return true;
  }

  function setSelectedTerminalIdForRoom(roomId: string, terminalId: string | null) {
    setSelectedTerminalIdsByRoom((current) => terminalId ? { ...current, [roomId]: terminalId } : omitRecordKey(current, roomId));
  }

  function setTerminalNameForRoom(roomId: string, name: string) {
    setTerminalNamesByRoom((current) => name === "dev-server" ? omitRecordKey(current, roomId) : { ...current, [roomId]: name });
  }

  function setTerminalCommandForRoom(roomId: string, command: string) {
    setTerminalCommandsByRoom((current) => command === "npm run dev:desktop" ? omitRecordKey(current, roomId) : { ...current, [roomId]: command });
  }

  function setTerminalInputForRoom(roomId: string, input: string) {
    setTerminalInputsByRoom((current) => input ? { ...current, [roomId]: input } : omitRecordKey(current, roomId));
  }

  function setTerminalErrorForRoom(roomId: string, error: string | null) {
    setTerminalErrorsByRoom((current) => error ? { ...current, [roomId]: error } : omitRecordKey(current, roomId));
  }

  function setSelectedTerminalError(error: string | null) {
    setTerminalErrorForRoom(selectedRoom.id, error);
  }

  function setBrowserUrlForRoom(roomId: string, url: string) {
    setBrowserUrlsByRoom((current) => url === defaultBrowserUrl ? omitRecordKey(current, roomId) : { ...current, [roomId]: url });
  }

  function setBrowserReasonForRoom(roomId: string, reason: string) {
    setBrowserReasonsByRoom((current) => reason === defaultBrowserReason ? omitRecordKey(current, roomId) : { ...current, [roomId]: reason });
  }

  function setBrowserMessageForRoom(roomId: string, message: string | null) {
    setBrowserMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedBrowserMessage(message: string | null) {
    setBrowserMessageForRoom(selectedRoom.id, message);
  }

  function setInviteLinkForRoom(roomId: string, link: string) {
    setInviteLinksByRoom((current) => link ? { ...current, [roomId]: link } : omitRecordKey(current, roomId));
  }

  function setInviteApprovalGateForRoom(roomId: string, enabled: boolean) {
    setInviteApprovalGatesByRoom((current) => enabled ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setInviteMessageForRoom(roomId: string, message: string | null) {
    setInviteMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedInviteMessage(message: string | null) {
    setInviteMessageForRoom(selectedRoom.id, message);
  }

  function resetFileContextForRoom(roomId: string) {
    setSelectedFileForRoom(roomId, null);
    setSelectedDiffForRoom(roomId, null);
    setFileQueryForRoom(roomId, "");
    setProjectFilesByRoom((current) => omitRecordKey(current, roomId));
    setFileBusyByRoom((current) => omitRecordKey(current, roomId));
    setFileMessagesByRoom((current) => omitRecordKey(current, roomId));
  }

  function setSelectedGitWorkflowMessage(message: string | null) {
    setGitWorkflowMessageForRoom(selectedRoom.id, message);
  }

  function appendGitWorkflowEvent(roomId: string, event: GitWorkflowEventPlaintextPayload) {
    setGitWorkflowEventsByRoom((current) => {
      const roomEvents = current[roomId] ?? [];
      if (roomEvents.some((existing) => existing.createdAt === event.createdAt && existing.status === event.status && existing.message === event.message)) {
        return current;
      }
      return {
        ...current,
        [roomId]: [...roomEvents, event].slice(-100)
      };
    });
  }

  function appendGitHubActionsEvent(roomId: string, event: GitHubActionsEventPlaintextPayload) {
    setGitHubActionsEventsByRoom((current) => {
      const roomEvents = current[roomId] ?? [];
      if (roomEvents.some((existing) => existing.checkedAt === event.checkedAt && existing.owner === event.owner && existing.repo === event.repo && existing.branch === event.branch)) {
        return current;
      }
      return {
        ...current,
        [roomId]: [...roomEvents, event].slice(-50)
      };
    });
  }

  function updateSelectedGitWorkflowDraft(patch: Partial<GitWorkflowDraft>) {
    if (!hasSelectedRoom) return;
    setGitWorkflowDraftsByRoom((current) => updateGitWorkflowDraftRecord(current, selectedRoom.id, patch));
  }

  const selectedAttachmentReview = selectedFile
    ? decideAttachmentReview(
        selectedFile.content,
        selectedFile.path,
        reviewedAttachmentPathForScope(sensitiveAttachmentReviewKey, selectedRoom.id, selectedRoom.projectPath, selectedFile.path)
      )
    : null;
  const selectedFileRisks = selectedAttachmentReview?.risks ?? [];
  const selectedFileNeedsAttachmentReview = Boolean(selectedAttachmentReview?.requiresReview);
  const selectedSensitiveFileReviewed = Boolean(selectedAttachmentReview?.reviewed);
  const terminalRisks = selectedTerminal
    ? detectSecretRisks(selectedTerminal.lines.map((line) => line.text).join("\n"))
    : detectSecretRisks(terminalLines.join("\n"));
  const terminalCommandRisks = detectTerminalCommandRisks(terminalCommand);
  const normalizedSidebarQuery = sidebarQuery.trim().toLowerCase();
  const searchActive = normalizedSidebarQuery.length > 0;
  const teamRooms = useMemo(
    () => rooms.filter((room) => room.teamId === selectedTeam),
    [rooms, selectedTeam]
  );
  const visibleTeams = useMemo(
    () =>
      searchActive
        ? teams.filter((team) => searchMatches([team.name], normalizedSidebarQuery))
        : teams,
    [normalizedSidebarQuery, searchActive, teams]
  );
  const visibleRooms = useMemo(
    () =>
      searchActive
        ? rooms.filter((room) => {
            const team = teams.find((item) => item.id === room.teamId);
            return searchMatches(
              [room.name, room.projectPath, room.host, room.hostStatus, room.codexModel, approvalPolicyLabels[room.approvalPolicy], team?.name ?? ""],
              normalizedSidebarQuery
            );
          })
        : teamRooms,
    [normalizedSidebarQuery, rooms, searchActive, teamRooms, teams]
  );
  const searchableMessagesByRoom = useMemo(() => {
    return mergeSearchableMessages(messagesByRoom, historySearchMessagesByRoom);
  }, [historySearchMessagesByRoom, messagesByRoom]);
  const visibleMessageHits = useMemo(() => {
    return searchActive ? findSidebarMessageHits(searchableMessagesByRoom, normalizedSidebarQuery) : [];
  }, [normalizedSidebarQuery, searchableMessagesByRoom, searchActive]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
  }, [selectedRoomId]);

  useEffect(() => {
    gitWorkflowDraftsRef.current = gitWorkflowDraftsByRoom;
  }, [gitWorkflowDraftsByRoom]);

  useEffect(() => {
    hostBusyRef.current = hostBusyByRoom;
  }, [hostBusyByRoom]);

  useEffect(() => {
    settingsBusyRef.current = settingsBusyByRoom;
  }, [settingsBusyByRoom]);

  useEffect(() => {
    keyRotationBusyRef.current = keyRotationBusyByRoom;
  }, [keyRotationBusyByRoom]);

  useEffect(() => {
    gitWorkflowBusyRef.current = gitWorkflowBusyByRoom;
  }, [gitWorkflowBusyByRoom]);

  useEffect(() => {
    actionsBusyRef.current = actionsBusyByRoom;
  }, [actionsBusyByRoom]);

  useEffect(() => {
    terminalBusyRef.current = terminalBusyByRoom;
  }, [terminalBusyByRoom]);

  useEffect(() => {
    fileBusyRef.current = fileBusyByRoom;
  }, [fileBusyByRoom]);

  useEffect(() => {
    browserRequestsRef.current = browserRequestsByRoom;
  }, [browserRequestsByRoom]);

  useEffect(() => {
    if (!selectedRoomId) return;
    setRooms((current) => markRoomRead(current, selectedRoomId));
  }, [selectedRoomId]);

  useEffect(() => {
    setAuthError(null);
    getAuthConfig().then(setAuthConfig).catch((error) => {
      setAuthConfig({
        provider: "github",
        configured: false,
        scopes: ["read:user"],
        mutationsRequireAuth: false,
        allowedOrigins: [],
        sessionPersistence: "memory_only"
      });
      setAuthError(String(error));
    });
    getCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, [appConfig.relayHttpUrl]);

  useEffect(() => {
    loadOrCreateDeviceIdentity()
      .then((identity) => {
        setDeviceIdentity(identity);
        setDeviceIdentityMessage(null);
      })
      .catch((error) => {
        setDeviceIdentityMessage(`Device identity unavailable: ${String(error)}`);
      });
  }, []);

  useEffect(() => {
    if (!deviceIdentity) return;
    registerDevice({
      userId: localUser.id,
      deviceId,
      displayName: localUser.name,
      publicKeyJwk: deviceIdentity.publicKeyJwk,
      publicKeyFingerprint: deviceIdentity.publicKeyFingerprint
    })
      .then(() => setDeviceIdentityMessage("Device public key registered with relay."))
      .catch((error) => setDeviceIdentityMessage(`Device public key registration pending: ${String(error)}`));
  }, [appConfig.relayHttpUrl, deviceId, deviceIdentity, localUser.id, localUser.name]);

  useEffect(() => {
    loadWorkspace()
      .then((snapshot) => {
        const nextRooms = snapshot.rooms.map(ensureRoomDefaults);
        setTeams(snapshot.teams);
        setRooms(nextRooms);
        setSelectedTeam((current) =>
          snapshot.teams.some((team) => team.id === current) ? current : snapshot.teams[0]?.id ?? ""
        );
        setSelectedRoomId((current) =>
          nextRooms.some((room) => room.id === current) ? current : nextRooms[0]?.id ?? ""
        );
        setWorkspaceError(null);
      })
      .catch((error) => {
        setWorkspaceError(`Using local starter rooms: ${String(error)}`);
      });
  }, [appConfig.relayHttpUrl]);

  const refreshTeamMembers = useCallback(async (teamId: string, showErrors = true): Promise<void> => {
    if (!teamId) return;
    try {
      const members = await loadTeamMembers(teamId);
      setTeamMembersByTeam((current) => ({ ...current, [teamId]: members }));
      setTeamMembersMessageByTeam((current) => ({ ...current, [teamId]: null }));
    } catch (error) {
      if (showErrors) {
        setTeamMembersMessageByTeam((current) => ({ ...current, [teamId]: String(error) }));
      }
    }
  }, [appConfig.relayHttpUrl]);

  useEffect(() => {
    if (!selectedTeam) return;
    void refreshTeamMembers(selectedTeam);
  }, [refreshTeamMembers, selectedTeam]);

  useEffect(() => {
    const invitePayload = readInviteUrlPayload(window.location);
    if (!invitePayload) return;
    window.history.replaceState(null, "", invitePayload.cleanupPath);
    if (invitePayload.kind === "join") {
      requestNoSecretInviteAccess(invitePayload.encoded, invitePayload.inviteId)
        .catch((error) => setSelectedInviteMessage(`Invite could not be read: ${String(error)}`));
      return;
    }

    acceptInvite(invitePayload.encoded, invitePayload.inviteId, invitePayload.approvalRequested)
      .catch((error) => setSelectedInviteMessage(`Invite could not be read: ${String(error)}`));
  }, []);

  useEffect(() => {
    if (!deviceFlow || currentUser) return;
    let cancelled = false;
    const intervalMs = Math.max(1, deviceFlow.interval) * 1000;
    const timer = window.setInterval(() => {
      pollGitHubDeviceFlow(deviceFlow.device_code)
        .then((user) => {
          if (cancelled || !user) return;
          setCurrentUser(user);
          setDeviceFlow(null);
          setAuthBusy(false);
          setAuthError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setAuthBusy(false);
          setAuthError(String(error));
          setDeviceFlow(null);
        });
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentUser, deviceFlow]);

  useEffect(() => {
    if (!selectedTeam) return;
    const teamRoomDefaults = loadTeamRoomDefaults(selectedTeam);
    setTeamHistorySettings(loadTeamHistorySettings(selectedTeam));
    setTeamDefaultApprovalPolicy(teamRoomDefaults.approvalPolicy);
    setTeamDefaultCodexModel(teamRoomDefaults.codexModel);
    setTeamDefaultBrowserAllowedOriginsDraft(teamRoomDefaults.browserAllowedOrigins.join("\n"));
    setTeamDefaultBrowserProfilePersistent(teamRoomDefaults.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(teamRoomDefaults.inviteApprovalGate);
  }, [selectedTeam]);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (forgottenRoomIds.has(selectedRoomId)) {
      setHistorySettings(loadHistorySettings(selectedRoomId));
      return;
    }
    let cancelled = false;
    const settings = hasHistorySettings(selectedRoomId)
      ? loadHistorySettings(selectedRoomId)
      : loadTeamHistorySettings(selectedRoom.teamId);
    if (!hasHistorySettings(selectedRoomId)) {
      saveHistorySettings(selectedRoomId, settings);
    }
    setHistorySettings(settings);
    loadEncryptedHistory<ChatMessage[] | LocalRoomHistoryPayload>(selectedRoomId).then((storedHistory) => {
      if (cancelled || !storedHistory) return;
      const payload = pruneLocalRoomHistory(normalizeLocalRoomHistory(storedHistory), settings.retentionDays);
      if (payload.messages.length) {
        setMessagesByRoom((current) => ({
          ...current,
          [selectedRoomId]: payload.messages
        }));
      }
      setTerminalRequestsByRoom((current) =>
        payload.terminalRequests.length
          ? { ...current, [selectedRoomId]: payload.terminalRequests }
          : current
      );
      setBrowserRequestsByRoom((current) =>
        payload.browserRequests.length
          ? { ...current, [selectedRoomId]: payload.browserRequests }
          : current
      );
      setInviteRequestsByRoom((current) =>
        payload.inviteRequests.length
          ? { ...current, [selectedRoomId]: payload.inviteRequests }
          : current
      );
      setCodexEventsByRoom((current) =>
        payload.codexEvents.length
          ? { ...current, [selectedRoomId]: payload.codexEvents }
          : current
      );
      setGitWorkflowEventsByRoom((current) =>
        payload.gitWorkflowEvents.length
          ? { ...current, [selectedRoomId]: payload.gitWorkflowEvents }
          : current
      );
      setGitHubActionsEventsByRoom((current) =>
        payload.githubActionsEvents.length
          ? { ...current, [selectedRoomId]: payload.githubActionsEvents }
          : current
      );
      const latestGitWorkflowEvent = payload.gitWorkflowEvents.at(-1);
      if (latestGitWorkflowEvent) {
        setGitWorkflowMessageForRoom(selectedRoomId, latestGitWorkflowEvent.message);
      }
      const latestGitHubActionsEvent = payload.githubActionsEvents.at(-1);
      if (latestGitHubActionsEvent) {
        setActionRunsByRoom((current) => ({
          ...current,
          [selectedRoomId]: latestGitHubActionsEvent.runs
        }));
        setActionsLastCheckedByRoom((current) => ({
          ...current,
          [selectedRoomId]: latestGitHubActionsEvent.checkedAt
        }));
        setActionsMessagesByRoom((current) => ({
          ...current,
          [selectedRoomId]: `${latestGitHubActionsEvent.summary.label}: ${latestGitHubActionsEvent.message}`
        }));
      }
      if (payload.terminalSnapshots.length) {
        setTerminals((current) => replaceRoomTerminalSnapshots(current, selectedRoomId, payload.terminalSnapshots));
        setSelectedTerminalIdsByRoom((current) => {
          const currentTerminalId = current[selectedRoomId] ?? null;
          const nextTerminalId = currentTerminalId && payload.terminalSnapshots.some((terminal) => terminal.id === currentTerminalId)
            ? currentTerminalId
            : payload.terminalSnapshots[0]?.id ?? null;
          return nextTerminalId ? { ...current, [selectedRoomId]: nextTerminalId } : current;
        });
      }
      setHostHandoffsByRoom((current) =>
        payload.hostHandoffs.length
          ? { ...current, [selectedRoomId]: payload.hostHandoffs }
          : current
      );
      setCodexThreadIdsByRoom((current) => {
        const codexThreadId = normalizeCodexThreadId(payload.codexThreadId);
        return codexThreadId ? { ...current, [selectedRoomId]: codexThreadId } : current;
      });
    }).catch((error) => {
      if (!cancelled) console.warn("Failed to load encrypted local history", error);
    }).finally(() => {
      if (!cancelled) historyLoadedRoomIds.current.add(selectedRoomId);
    });
    return () => {
      cancelled = true;
    };
  }, [forgottenRoomIds, hasSelectedRoom, selectedRoom.teamId, selectedRoomId]);

  useEffect(() => {
    if (!searchActive) {
      setHistorySearchMessagesByRoom({});
      setHistorySearchBusy(false);
      return;
    }

    let cancelled = false;
    const searchableRooms = rooms.filter((room) =>
      !forgottenRoomIds.has(room.id) &&
      !revokedRoomIds.has(room.id) &&
      !revokedTeamIds.has(room.teamId)
    );
    setHistorySearchBusy(searchableRooms.length > 0);
    Promise.all(
      searchableRooms.map(async (room) => {
        const storedHistory = await loadEncryptedHistory<ChatMessage[] | LocalRoomHistoryPayload>(room.id);
        if (!storedHistory) return [room.id, []] as const;
        const settings = loadHistorySettings(room.id);
        const payload = pruneLocalRoomHistory(normalizeLocalRoomHistory(storedHistory), settings.retentionDays);
        return [room.id, payload.messages] as const;
      })
    )
      .then((entries) => {
        if (cancelled) return;
        setHistorySearchMessagesByRoom(
          Object.fromEntries(entries.filter(([, roomMessages]) => roomMessages.length > 0))
        );
      })
      .catch((error) => {
        if (!cancelled) console.warn("Failed to search encrypted local history", error);
      })
      .finally(() => {
        if (!cancelled) setHistorySearchBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [forgottenRoomIds, revokedRoomIds, revokedTeamIds, rooms, searchActive]);

  useEffect(() => {
    let cancelled = false;
    setPresenceByRoom({});
    const client = connectRelay(
      appConfig.relayWsUrl,
      async (message) => {
        if (cancelled) return;
        if (message.type === "joined") {
          setRelayStatus("open");
          return;
        }
        if (message.type === "team.subscribed") {
          return;
        }
        if (message.type === "workspace.subscribed") {
          setRelayStatus("open");
          return;
        }
        if (message.type === "error") {
          handleRelayError(message.message);
          return;
        }
        if (message.type === "presence") {
          setPresenceByRoom((current) => {
            const roomPresence = current[message.roomId] ?? {};
            const nextRoomPresence = { ...roomPresence };
            if (message.status === "offline") {
              delete nextRoomPresence[message.deviceId];
            } else {
              nextRoomPresence[message.deviceId] = {
                userId: message.userId,
                deviceId: message.deviceId,
                displayName: message.displayName,
                avatarUrl: message.avatarUrl,
                publicKeyFingerprint: message.publicKeyFingerprint,
                status: message.status
              };
            }
            return {
              ...current,
              [message.roomId]: nextRoomPresence
            };
          });
          return;
        }
        if (message.type === "room.updated") {
          upsertRoom(ensureRoomDefaults(message.room));
          return;
        }
        if (message.type === "team.updated") {
          upsertTeam(message.team);
          void refreshTeamMembers(message.team.id, false);
          return;
        }
        if (message.type !== "envelope") {
          return;
        }
        if (seenEnvelopeIds.current.has(message.envelope.id)) {
          return;
        }
        seenEnvelopeIds.current.add(message.envelope.id);
        try {
          if (message.envelope.kind === "room.invite") {
            const plaintext = await decryptInviteEnvelope(message.envelope);
            if (plaintext) {
              await handleInviteEnvelopePlaintext(message.envelope.roomId, plaintext);
            }
            return;
          }
          if (message.envelope.payload.algorithm !== "AES-GCM-256") {
            return;
          }
          const roomPayload = message.envelope.payload;
          const secret = await loadRoomSecret(message.envelope.roomId);
          if (!secret) {
            setForgottenRoomIds((current) => new Set(current).add(message.envelope.roomId));
            return;
          }
          if (message.envelope.kind === "chat.message") {
            const plaintext = await decryptJson<ChatPlaintextPayload>(roomPayload, secret);
            const chatMessage = normalizeChatMessage(plaintext) as ChatMessage | null;
            if (!chatMessage) return;
            setRooms((current) =>
              markRoomUnreadForIncomingChat(
                current,
                message.envelope.roomId,
                selectedRoomIdRef.current,
                message.envelope.senderDeviceId,
                deviceId
              )
            );
            setMessagesByRoom((current) => {
              const roomMessages = current[message.envelope.roomId] ?? [];
              if (roomMessages.some((existing) => existing.id === chatMessage.id)) return current;
              return {
                ...current,
                [message.envelope.roomId]: [...roomMessages, chatMessage]
              };
            });
          }
          if (message.envelope.kind === "chat.reaction") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isChatReactionPlaintextPayload(plaintext)) {
              applyMessageReaction(message.envelope.roomId, plaintext);
            }
          }
          if (message.envelope.kind === "terminal.request") {
            const plaintext = await decryptJson<TerminalRequestPlaintextPayload>(roomPayload, secret);
            setTerminalRequestsByRoom((current) => {
              const roomRequests = current[message.envelope.roomId] ?? [];
              if (roomRequests.some((existing) => existing.id === plaintext.id)) return current;
              return {
                ...current,
                [message.envelope.roomId]: [...roomRequests, { ...plaintext, status: "pending" }]
              };
            });
          }
          if (message.envelope.kind === "terminal.event") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isRequestStatusPlaintextPayload(plaintext)) {
              updateTerminalRequestStatus(message.envelope.roomId, plaintext.requestId, plaintext.status);
            }
            if (isTerminalResultPlaintextPayload(plaintext)) {
              appendTerminalLinesForRoom(message.envelope.roomId, buildTerminalResultLines(plaintext));
            }
          }
          if (message.envelope.kind === "git.event") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isGitWorkflowEventPlaintextPayload(plaintext)) {
              appendGitWorkflowEvent(message.envelope.roomId, plaintext);
              appendTerminalLinesForRoom(message.envelope.roomId, buildGitWorkflowEventLines(plaintext));
              setGitWorkflowMessageForRoom(message.envelope.roomId, plaintext.message);
            }
            if (isGitHubActionsEventPlaintextPayload(plaintext)) {
              appendGitHubActionsEvent(message.envelope.roomId, plaintext);
              setActionRunsByRoom((current) => ({
                ...current,
                [message.envelope.roomId]: plaintext.runs
              }));
              setActionsLastCheckedByRoom((current) => ({
                ...current,
                [message.envelope.roomId]: plaintext.checkedAt
              }));
              setActionsMessagesByRoom((current) => ({
                ...current,
                [message.envelope.roomId]: `${plaintext.summary.label}: ${plaintext.message}`
              }));
              appendTerminalLinesForRoom(message.envelope.roomId, buildGitHubActionsEventLines(plaintext));
            }
          }
          if (message.envelope.kind === "codex.event") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isCodexEventPlaintextPayload(plaintext)) {
              appendCodexEvent(message.envelope.roomId, plaintext);
              appendTerminalLinesForRoom(message.envelope.roomId, [buildCodexEventLine(plaintext)]);
            }
          }
          if (message.envelope.kind === "browser.request") {
            const plaintext = await decryptJson<BrowserRequestPlaintextPayload>(roomPayload, secret);
            const envelopeRoom = roomsRef.current.find((room) => room.id === message.envelope.roomId);
            const status =
              envelopeRoom && shouldAutoApproveBrowserRequest(
                plaintext.url,
                envelopeRoom,
                isLocalUserActiveHostForRoom(envelopeRoom, localUser)
              )
                ? "approved"
                : "pending";
            setBrowserRequestsByRoom((current) => {
              const roomRequests = current[message.envelope.roomId] ?? [];
              if (roomRequests.some((existing) => existing.id === plaintext.id)) return current;
              return {
                ...current,
                [message.envelope.roomId]: [...roomRequests, { ...plaintext, status }]
              };
            });
            if (status === "approved" && envelopeRoom) {
              appendBrowserDecisionMessage(
                envelopeRoom.id,
                buildLocalRequestStatusPayload(plaintext.id, "approved"),
                { url: plaintext.url, requester: plaintext.requester }
              );
              publishRequestStatus("browser.event", plaintext.id, "approved", envelopeRoom).catch((error) => {
                if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, envelopeRoom.id)) setBrowserMessageForRoom(envelopeRoom.id, String(error));
              });
              if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, envelopeRoom.id)) {
                setBrowserMessageForRoom(envelopeRoom.id, `Auto-approved allowed browser site ${formatBrowserAccessLabel(plaintext.url)}.`);
              }
            }
          }
          if (message.envelope.kind === "browser.event") {
            const plaintext = await decryptJson<RequestStatusPlaintextPayload>(roomPayload, secret);
            updateBrowserRequestStatus(message.envelope.roomId, plaintext.requestId, plaintext.status);
            appendBrowserDecisionMessage(message.envelope.roomId, plaintext);
          }
          if (message.envelope.kind === "room.host") {
            const plaintext = await decryptJson<HostHandoffPlaintextPayload>(roomPayload, secret);
            if (plaintext.status === "accepted") {
              markHostHandoffAccepted(message.envelope.roomId, plaintext.id);
              setHostMessageForRoom(
                message.envelope.roomId,
                `${plaintext.acceptedBy ?? "A room member"} accepted host handoff from ${plaintext.fromHost}.`
              );
            } else {
              appendHostHandoff(message.envelope.roomId, { ...plaintext, status: "available" });
            }
          }
          if (message.envelope.kind === "room.settings") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isRoomSettingsPlaintextPayload(plaintext)) {
              appendRoomMessage(message.envelope.roomId, buildRoomSettingsSystemMessage(plaintext));
            }
          }
          if (message.envelope.kind === "room.key") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isRoomKeyRotationPlaintextPayload(plaintext)) {
              await replaceRoomSecret(message.envelope.roomId, plaintext.newSecret);
              historyLoadedRoomIds.current.add(message.envelope.roomId);
              setForgottenRoomIds((current) => withoutSetValue(current, message.envelope.roomId));
              appendRoomMessage(message.envelope.roomId, {
                id: plaintext.id,
                author: "multAIplayer",
                role: "system",
                body: `${plaintext.rotatedBy} rotated the room key. Future messages and invites use the new key.`,
                time: formatMessageTime(plaintext.rotatedAt),
                createdAt: plaintext.rotatedAt
              });
              setInviteMessageForRoom(message.envelope.roomId, `${plaintext.rotatedBy} rotated the room key for future messages.`);
            }
          }
        } catch (error) {
          console.warn("Failed to decrypt relay envelope", error);
        }
      },
      setRelayStatus,
      (openClient) => {
        openClient.publish({
          type: "subscribe.workspace",
          userId: localUser.id,
          deviceId
        });
        if (selectedTeam && !revokedTeamIds.has(selectedTeam)) {
          openClient.publish({
            type: "subscribe.team",
            teamId: selectedTeam,
            userId: localUser.id,
            deviceId
          });
        }
        if (!hasSelectedRoom || revokedRoomIds.has(selectedRoom.id) || revokedTeamIds.has(selectedRoom.teamId)) return;
        openClient.publish({
          type: "join",
          teamId: selectedRoom.teamId,
          roomId: selectedRoom.id,
          userId: localUser.id,
          deviceId,
          inviteId: inviteAdmissionsByRoom[selectedRoom.id]
        });
        openClient.publish({
          type: "presence",
          teamId: selectedRoom.teamId,
          roomId: selectedRoom.id,
          userId: localUser.id,
          deviceId,
          displayName: localUser.name,
          avatarUrl: localUser.avatarUrl,
          publicKeyFingerprint: deviceIdentity?.publicKeyFingerprint
        });
      }
    );

    relayRef.current = client;

    return () => {
      cancelled = true;
      relayRef.current = null;
      client.close();
    };
  }, [
    appConfig.relayWsUrl,
    deviceId,
    hasSelectedRoom,
    isActiveHost,
    localUser.avatarUrl,
    localUser.id,
    localUser.name,
    deviceIdentity?.publicKeyFingerprint,
    inviteAdmissionsByRoom,
    refreshTeamMembers,
    revokedRoomIds,
    revokedTeamIds,
    selectedRoom.approvalPolicy,
    selectedRoom.browserAllowedOrigins,
    selectedRoom.id,
    selectedRoom.name,
    selectedRoom.teamId,
    selectedTeam
  ]);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (forgottenRoomIds.has(selectedRoomId) || revokedRoomIds.has(selectedRoomId) || revokedTeamIds.has(selectedRoom.teamId)) return;
    if (!historyLoadedRoomIds.current.has(selectedRoomId)) return;
    const payload = pruneLocalRoomHistory({
      version: 3,
      messages,
      terminalRequests,
      browserRequests,
      inviteRequests,
      codexEvents,
      gitWorkflowEvents,
      githubActionsEvents,
      terminalSnapshots: terminalsForLocalHistory(terminals.filter((terminal) => terminal.roomId === selectedRoomId)),
      hostHandoffs,
      ...(selectedCodexThreadId ? { codexThreadId: selectedCodexThreadId } : {})
    }, historySettings.retentionDays);
    saveEncryptedHistory(selectedRoomId, payload satisfies LocalRoomHistoryPayload).catch((error) => {
      console.warn("Failed to save encrypted local history", error);
    });
  }, [
    browserRequests,
    historySettings.enabled,
    historySettings.retentionDays,
    hostHandoffs,
    inviteRequests,
    codexEvents,
    gitWorkflowEvents,
    githubActionsEvents,
    forgottenRoomIds,
    revokedRoomIds,
    revokedTeamIds,
    terminals,
    messages,
    hasSelectedRoom,
    selectedCodexThreadId,
    selectedRoomId,
    terminalRequests
  ]);

  useEffect(() => {
    if (!hasSelectedRoom) {
      return;
    }
    const roomId = selectedRoom.id;
    if (!canReadLocalWorkspace) {
      setGitStatusForRoom(roomId, null);
      return;
    }
    setGitStatusForRoom(roomId, null);
    getGitStatus(selectedRoom.projectPath)
      .then((status) => setGitStatusForRoom(roomId, status))
      .catch((error) => {
        setGitStatusForRoom(roomId, {
          branch: "unknown",
          files: [{ path: String(error), status: "error", added: 0, removed: 0 }]
        });
      });
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoom.id, selectedRoom.projectPath]);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (!canReadLocalWorkspace) return;
    const roomId = selectedRoom.id;
    const projectPath = selectedRoom.projectPath;
    let cancelled = false;
    getGitRemoteOrigin(projectPath)
      .then((remote) => {
        if (cancelled || !remote.originUrl) return;
        const repo = parseGitHubRemoteUrl(remote.originUrl);
        if (!repo) return;
        const currentDraft = resolveGitWorkflowDraft(gitWorkflowDraftsRef.current, roomId);
        const isDefaultTarget =
          currentDraft.prOwner === defaultGitWorkflowDraft.prOwner &&
          currentDraft.prRepo === defaultGitWorkflowDraft.prRepo;
        const alreadyMatches = currentDraft.prOwner === repo.owner && currentDraft.prRepo === repo.repo;
        if (!isDefaultTarget || alreadyMatches) return;
        setGitWorkflowDraftsByRoom((current) =>
          updateGitWorkflowDraftRecord(current, roomId, {
            prOwner: repo.owner,
            prRepo: repo.repo
          })
        );
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setGitWorkflowMessageForRoom(roomId, `Detected GitHub remote ${repo.owner}/${repo.repo} for PRs and Actions.`);
        }
      })
      .catch(() => {
        // Remote inference is best-effort; manual owner/repo fields remain available.
      });
    return () => {
      cancelled = true;
    };
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoom.id, selectedRoom.projectPath]);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    setActionRunsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setActionsLastCheckedByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
  }, [gitWorkflowDraft.branchName, gitWorkflowDraft.prOwner, gitWorkflowDraft.prRepo, hasSelectedRoom, selectedRoom.id]);

  useEffect(() => {
    if (!hasSelectedRoom) {
      return;
    }
    const roomId = selectedRoom.id;
    if (!canReadLocalWorkspace) {
      setProjectFilesForRoom(roomId, []);
      setSelectedFileForRoom(roomId, null);
      setSelectedDiffForRoom(roomId, null);
      setFileBusyForRoom(roomId, false);
      setFileMessageForRoom(roomId, localWorkspaceMessage);
      return;
    }
    let cancelled = false;
    setFileBusyForRoom(roomId, true);
    searchProjectFiles(selectedRoom.projectPath, fileQueriesByRoom[roomId] ?? "", 80)
      .then((files) => {
        if (cancelled) return;
        setProjectFilesForRoom(roomId, files);
        setFileMessageForRoom(roomId, null);
      })
      .catch((error) => {
        if (!cancelled) setFileMessageForRoom(roomId, String(error));
      })
      .finally(() => {
        if (!cancelled) setFileBusyForRoom(roomId, false);
      });
    return () => {
      cancelled = true;
    };
  }, [canReadLocalWorkspace, fileQueriesByRoom, hasSelectedRoom, localWorkspaceMessage, selectedRoom.id, selectedRoom.projectPath]);

  useEffect(() => {
    if (!hasSelectedRoom) {
      setTerminals([]);
      return;
    }
    const roomId = selectedRoom.id;
    if (!canReadLocalWorkspace) {
      setTerminals((current) => replaceRoomTerminalSnapshots(current, roomId, []));
      setSelectedTerminalIdForRoom(roomId, null);
      return;
    }
    let cancelled = false;
    listTerminals(roomId)
      .then((snapshots) => {
        if (cancelled) return;
        let mergedSnapshots: TerminalSnapshot[] = [];
        setTerminals((current) => {
          mergedSnapshots = mergeTerminalSnapshots(
            current.filter((terminal) => terminal.roomId === roomId),
            snapshots
          );
          return replaceRoomTerminalSnapshots(current, roomId, mergedSnapshots);
        });
        setSelectedTerminalIdsByRoom((current) => {
          const currentTerminalId = current[roomId] ?? null;
          const nextTerminalId = currentTerminalId && mergedSnapshots.some((terminal) => terminal.id === currentTerminalId)
            ? currentTerminalId
            : mergedSnapshots[0]?.id ?? null;
          return nextTerminalId ? { ...current, [roomId]: nextTerminalId } : omitRecordKey(current, roomId);
        });
      })
      .catch((error) => {
        if (!cancelled) setTerminalErrorForRoom(roomId, String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoom.id]);

  useEffect(() => {
    if (!canReadLocalWorkspace || !selectedTerminalId || !selectedTerminal?.running) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      readTerminal(selectedTerminalId)
        .then((snapshot) => {
          if (cancelled) return;
          setTerminals((current) => upsertTerminal(current, snapshot));
        })
        .catch((error) => {
          if (!cancelled && hasSelectedRoom) setTerminalErrorForRoom(selectedRoom.id, String(error));
        });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasSelectedRoom, selectedRoom.id, selectedTerminal?.running, selectedTerminalId]);

  useEffect(() => {
    probeCodex().then(setCodexProbe).catch((error) => {
      setCodexProbe({ available: false, version: null, error: String(error) });
    });
  }, []);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    setCustomCodexModelsByRoom((current) => current[selectedRoom.id] === selectedCodexModel ? omitRecordKey(current, selectedRoom.id) : current);
  }, [hasSelectedRoom, selectedCodexModel, selectedRoom.id]);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    const currentDraft = selectedBrowserAllowedOrigins.join("\n");
    setBrowserAllowedOriginsDraftsByRoom((current) => current[selectedRoom.id] === currentDraft ? omitRecordKey(current, selectedRoom.id) : current);
  }, [hasSelectedRoom, selectedBrowserAllowedOrigins, selectedRoom.id]);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    setProjectPathDraftsByRoom((current) => current[selectedRoom.id] === selectedRoom.projectPath ? omitRecordKey(current, selectedRoom.id) : current);
  }, [hasSelectedRoom, selectedRoom.id, selectedRoom.projectPath]);

  function setPendingAttachmentsForRoom(
    roomId: string,
    updater: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[])
  ) {
    setPendingAttachmentsByRoom((current) => {
      const currentAttachments = current[roomId] ?? [];
      const nextAttachments = typeof updater === "function" ? updater(currentAttachments) : updater;
      return {
        ...current,
        [roomId]: nextAttachments
      };
    });
  }

  function setDraftForRoom(roomId: string, value: string) {
    setDraftsByRoom((current) => ({
      ...current,
      [roomId]: value
    }));
  }

  function appendTerminalLinesForRoom(roomId: string, lines: string[]) {
    if (lines.length === 0) return;
    setTerminalLinesByRoom((current) => {
      const roomLines = current[roomId] ?? [];
      return {
        ...current,
        [roomId]: [...roomLines, ...lines].slice(-maxTerminalActivityLines)
      };
    });
  }

  function setTerminalBusyForRoom(roomId: string, busy: boolean) {
    terminalBusyRef.current = busy
      ? { ...terminalBusyRef.current, [roomId]: true }
      : omitRecordKey(terminalBusyRef.current, roomId);
    setTerminalBusyByRoom((current) => {
      if (busy) return { ...current, [roomId]: true };
      return omitRecordKey(current, roomId);
    });
  }

  function reportRoomTerminalActionInFlight(roomId: string): boolean {
    if (!isRoomTerminalActionInFlight(terminalBusyRef.current, roomId)) return false;
    setTerminalErrorForRoom(roomId, roomTerminalActionInFlightMessage());
    return true;
  }

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
      handleCodexInvoke(message);
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

  async function beginGitHubSignIn() {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const flow = await startGitHubDeviceFlow();
      setDeviceFlow(flow);
      window.open(flow.verification_uri, "_blank", "noopener,noreferrer");
    } catch (error) {
      setAuthError(String(error));
      setAuthBusy(false);
    }
  }

  async function signOut() {
    await logout();
    setCurrentUser(null);
    setDeviceFlow(null);
    setAuthBusy(false);
  }

  async function rotateDeviceIdentity() {
    setDeviceIdentity(null);
    setDeviceIdentityMessage("Rotating local device identity...");
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
      setDeviceIdentityMessage(`${member.displayName} has no registered device key to trust.`);
      return;
    }
    setTrustedDeviceKeys((current) =>
      trustDeviceKey(current, selectedRoom.id, member.deviceId, fingerprint)
    );
    setDeviceIdentityMessage(`Trusted ${member.displayName}'s device key for ${selectedRoom.name}.`);
  }

  function untrustRoomMemberDevice(member: RoomPresence) {
    setTrustedDeviceKeys((current) => untrustDeviceKey(current, selectedRoom.id, member.deviceId));
    setDeviceIdentityMessage(`Removed local trust for ${member.displayName}'s device key in ${selectedRoom.name}.`);
  }

  async function copyRoomMemberDeviceFingerprint(member: RoomPresence, trusted: boolean) {
    const fingerprint = member.publicKeyFingerprint;
    if (!fingerprint) {
      setDeviceIdentityMessage(`${member.displayName} has no registered device key to copy.`);
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

  function saveRelayConfiguration() {
    setAppConfigMessage(null);
    try {
      const next = saveAppConfig({
        relayHttpUrl: relayHttpDraft,
        relayWsUrl: relayWsDraft
      });
      setAppConfig(next);
      setRelayHttpDraft(next.relayHttpUrl);
      setRelayWsDraft(next.relayWsUrl);
      setAppConfigMessage("Relay configuration saved. Reconnecting rooms and reloading workspace metadata.");
    } catch (error) {
      setAppConfigMessage(String(error));
    }
  }

  function resetRelayConfiguration() {
    const next = resetAppConfig();
    setAppConfig(next);
    setRelayHttpDraft(next.relayHttpUrl);
    setRelayWsDraft(next.relayWsUrl);
    setAppConfigMessage("Relay configuration reset to the app defaults.");
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
      const updatedSettings = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        ...patch
      });
      const claimed = await updateRoomHost(updatedSettings.id, localUser.name, localUser.id, "active");
      setRooms((current) => current.map((item) => (item.id === claimed.id ? ensureRoomDefaults(claimed) : item)));
      markHostHandoffAccepted(roomId, roomHandoff.id);
      await publishHostHandoffAccepted(selectedRoom, roomHandoff);
      resetFileContextForRoom(roomId);
      resetCodexApprovalForRoom(roomId);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setProjectPathDraftForRoom(roomId, patch.projectPath);
        setCustomCodexModelForRoom(roomId, patch.codexModel);
        setSettingsMessageForRoom(
          roomId,
          `Accepted handoff from ${roomHandoff.fromHost}; inherited ${formatCodexModel(patch.codexModel)} and ${patch.projectPath}.`
        );
        setHostMessageForRoom(roomId, `You are now hosting ${claimed.name} from ${roomHandoff.fromHost}'s handoff.`);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setHostMessageForRoom(roomId, String(error));
    } finally {
      setHostBusyForRoom(roomId, false);
    }
  }

  async function publishHostHandoff(room: RoomRecord) {
    const summary = buildCodexTurnSummary(
      messages,
      room,
      terminals,
      browserRequestsByRoom[room.id] ?? [],
      room.id === selectedRoom.id ? gitStatus : null
    );
    const handoff: HostHandoffRecord = {
      id: crypto.randomUUID(),
      fromHost: localUser.name,
      fromUserId: localUser.id,
      projectPath: room.projectPath,
      codexModel: room.codexModel,
      approvalPolicy: room.approvalPolicy,
      messagesSinceLastCodex: summary.messagesSinceLastCodex,
      attachmentNames: summary.attachments.map((attachment) => attachment.name),
      terminals: summary.terminals,
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
      projectPath: handoff.projectPath,
      codexModel: handoff.codexModel,
      approvalPolicy: handoff.approvalPolicy,
      messagesSinceLastCodex: handoff.messagesSinceLastCodex,
      attachmentNames: handoff.attachmentNames,
      terminals: handoff.terminals,
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
      projectPath: handoff.projectPath,
      codexModel: handoff.codexModel,
      approvalPolicy: handoff.approvalPolicy,
      messagesSinceLastCodex: handoff.messagesSinceLastCodex,
      attachmentNames: handoff.attachmentNames,
      terminals: handoff.terminals,
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

  function appendHostHandoff(roomId: string, handoff: HostHandoffRecord) {
    setHostHandoffsByRoom((current) => {
      const roomHandoffs = current[roomId] ?? [];
      if (roomHandoffs.some((existing) => existing.id === handoff.id)) return current;
      return {
        ...current,
        [roomId]: [...roomHandoffs, handoff]
      };
    });
  }

  function appendInviteRequest(roomId: string, request: InviteJoinRequest) {
    setInviteRequestsByRoom((current) => {
      const roomRequests = current[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return current;
      return {
        ...current,
        [roomId]: [...roomRequests, request]
      };
    });
  }

  function appendCodexEvent(roomId: string, event: CodexRoomEvent) {
    setCodexEventsByRoom((current) => {
      const roomEvents = current[roomId] ?? [];
      if (roomEvents.some((existing) =>
        existing.turnId === event.turnId &&
        existing.createdAt === event.createdAt &&
        existing.status === event.status &&
        existing.message === event.message
      )) {
        return current;
      }
      return {
        ...current,
        [roomId]: [...roomEvents, event].slice(-80)
      };
    });
  }

  function updateInviteRequestStatus(
    roomId: string,
    requestId: string,
    status: InviteJoinRequest["status"]
  ) {
    setInviteRequestsByRoom((current) => ({
      ...current,
      [roomId]: (current[roomId] ?? []).map((request) =>
        request.id === requestId ? { ...request, status } : request
      )
    }));
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
            ? `${plaintext.decidedBy} approved your room join request and delivered a device-wrapped room key.`
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
        wrappedRoomSecret: wrappedRoomSecret
          ? {
              ...wrappedRoomSecret,
              ephemeralPublicKeyJwk: jsonWebKeyToRecord(wrappedRoomSecret.ephemeralPublicKeyJwk)
          }
          : undefined
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

  async function saveBrowserAllowedOrigins() {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before changing browser site permissions.");
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
    const normalized = normalizeBrowserAllowedOrigins(browserAllowedOriginsDraft);
    if (!normalized) {
      setSelectedBrowserMessage("Use one http(s) origin per line, such as https://github.com.");
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId, setBrowserMessageForRoom)) return;
    setSettingsBusyForRoom(roomId, true);
    setBrowserMessageForRoom(roomId, null);
    try {
      const previousOrigins = selectedRoom.browserAllowedOrigins ?? [];
      const room = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        browserAllowedOrigins: normalized
      });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "browserAllowedOrigins",
        previousValue: previousOrigins.join(","),
        nextValue: normalized.join(","),
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setBrowserAllowedOriginsDraftForRoom(roomId, normalized.join("\n"));
        setBrowserMessageForRoom(
          roomId,
          normalized.length
            ? `Allowed browser sites saved: ${normalized.map(formatBrowserAccessLabel).join(", ")}.`
            : "Allowed browser site list is empty. Browser requests will require manual approval."
        );
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setBrowserMessageForRoom(roomId, String(error));
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
    setTeamDefaultBrowserAllowedOriginsDraft(saved.browserAllowedOrigins.join("\n"));
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
    setTeamDefaultBrowserAllowedOriginsDraft(saved.browserAllowedOrigins.join("\n"));
    setTeamDefaultBrowserProfilePersistent(saved.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(saved.inviteApprovalGate);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      `New rooms in this team will default to ${formatCodexModel(saved.codexModel)}.`
    );
  }

  function saveTeamDefaultBrowserPolicy() {
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team defaults.");
      return;
    }
    const browserAllowedOrigins = normalizeBrowserAllowedOrigins(teamDefaultBrowserAllowedOriginsDraft);
    if (!browserAllowedOrigins) {
      setSelectedTeamHistoryMessage("Use one http(s) browser origin per line for new rooms, such as https://github.com.");
      return;
    }
    const saved = saveTeamRoomDefaults(selectedTeam, {
      ...loadTeamRoomDefaults(selectedTeam),
      browserAllowedOrigins,
      browserProfilePersistent: teamDefaultBrowserProfilePersistent
    });
    setTeamDefaultApprovalPolicy(saved.approvalPolicy);
    setTeamDefaultCodexModel(saved.codexModel);
    setTeamDefaultBrowserAllowedOriginsDraft(saved.browserAllowedOrigins.join("\n"));
    setTeamDefaultBrowserProfilePersistent(saved.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(saved.inviteApprovalGate);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      saved.browserAllowedOrigins.length
        ? `New rooms will allow ${saved.browserAllowedOrigins.map(formatBrowserAccessLabel).join(", ")} by default.`
        : "New rooms will start with an empty browser allowlist."
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
    setTeamDefaultBrowserAllowedOriginsDraft(saved.browserAllowedOrigins.join("\n"));
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
      setBrowserAllowedOriginsDraftForRoom(roomId, roomSettings.browserAllowedOrigins.join("\n"));
      if (!roomSettings.browserProfilePersistent) {
        setBrowserStatusByRoom((current) => omitRecordKey(current, roomId));
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
    setBrowserAllowedOriginsDraftsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setKeyRotationBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setApprovalVisibleByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setPendingCodexApprovalsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setCodexRunningByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
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
      `Forget ${selectedRoom.name} on this device?\n\nThis deletes the encrypted local history, local history settings, and the local room key. You will need a fresh invite or room key to read or send encrypted room messages again.`
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
    setBrowserAllowedOriginsDraftsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setKeyRotationBusyByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setApprovalVisibleByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setPendingCodexApprovalsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setCodexRunningByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
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
    setHistoryMessageForRoom(roomId, "Forgot this room on this device. Rejoin or paste a room invite key to unlock it again.");
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
            setInviteMessageForRoom(roomId, "Device key is still being prepared. Try again in a moment.");
          }
          return;
        }
        const joinFragment = encodeNoSecretRoomInvite({
          version: 1,
          teamId: room.teamId,
          roomId: room.id,
          roomName: room.name,
          hostDeviceId: deviceId,
          hostPublicKeyJwk: jsonWebKeyToRecord(deviceIdentity.publicKeyJwk),
          hostPublicKeyFingerprint: deviceIdentity.publicKeyFingerprint
        });
        const link = `${window.location.origin}${window.location.pathname}?invite=${invite.id}#multaiplayerJoin=${joinFragment}&approval=request`;
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteLinkForRoom(roomId, displayableInviteLink(link, false));
        }
        try {
          await navigator.clipboard.writeText(link);
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(roomId, "Copied gated invite link. The room key is not in the link; approval delivers it wrapped to the joiner's device key.");
          }
        } catch {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(roomId, "Gated invite generated. Copying was blocked because the app was not focused; the room key is not in the link.");
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
          setInviteMessageForRoom(roomId, "Copied direct invite link. It contains the room key, so it is not displayed in the app after copying.");
        }
      } catch {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(roomId, "Direct invite generated, but copying was blocked. Because it contains the room key, it is not displayed; focus the app and try again or use the approval gate.");
        }
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setInviteMessageForRoom(roomId, String(error));
    }
  }

  async function rotateSelectedRoomKey() {
    if (!hasSelectedRoom) {
      setSelectedInviteMessage("Create or join a room before rotating a room key.");
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
      `Rotate the room key for ${selectedRoom.name}?\n\nThis sends the new key to current room-key holders in an encrypted room event and clears stale encrypted local history on this device. It is not full member removal in the alpha.`
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
        body: `${localUser.name} rotated the room key. Future messages and invites use the new key.`,
        time: formatMessageTime(rotatedAt),
        createdAt: rotatedAt
      });
      setForgottenRoomIds((current) => withoutSetValue(current, room.id));
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        setInviteLinkForRoom(room.id, "");
        setInviteMessageForRoom(
          room.id,
          client && relayStatus !== "closed" && relayStatus !== "error"
            ? "Rotated the room key for future messages and invites. Current key holders can receive it through the encrypted room event."
            : "Rotated the local room key, but the relay is offline. Other members will need a fresh invite key."
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
      requesterPublicKeyJwk: deviceIdentity ? jsonWebKeyToRecord(deviceIdentity.publicKeyJwk) : undefined,
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
      ? `Requested access to ${acceptedRoomName}. The room key is not on this device until the host approves.`
      : `Imported ${acceptedRoomName} metadata. Send again after the relay reconnects so the host can approve access.`);
  }

  async function acceptInvite(encodedSecret: string, inviteId?: string | null, approvalRequested = false) {
    const inviteSecret = decodeRoomInviteSecret(encodedSecret);
    let acceptedRoomName = inviteSecret.roomName;

    if (inviteId) {
      const metadata = await lookupInvite(inviteId);
      if (metadata.invite.teamId !== inviteSecret.teamId || metadata.invite.roomId !== inviteSecret.roomId) {
        throw new Error("Invite metadata does not match the encrypted room key fragment.");
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
        requesterPublicKeyJwk: deviceIdentity ? jsonWebKeyToRecord(deviceIdentity.publicKeyJwk) : undefined,
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
        ? `Imported ${acceptedRoomName} and sent an encrypted join request to the active host.`
        : `Imported ${acceptedRoomName}. Send again after the relay reconnects so the host can approve access.`);
      return;
    }
    setInviteMessageForRoom(inviteSecret.roomId, `Joined ${acceptedRoomName}. The relay provided metadata only; the room key stayed in the URL fragment.`);
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
	    const input = buildCodexTurnInput(turnMessages, projectPath, model, turnSummary);
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
      setCodexRunningForRoom(roomId, false);
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

  function appendRoomMessage(roomId: string, message: ChatMessage) {
    setMessagesByRoom((current) => {
      const roomMessages = current[roomId] ?? [];
      if (roomMessages.some((existing) => existing.id === message.id)) return current;
      return {
        ...current,
        [roomId]: [...roomMessages, message]
      };
    });
  }

  function setGitStatusForRoom(roomId: string, status: GitStatusSummary | null) {
    setGitStatusByRoom((current) => ({
      ...current,
      [roomId]: status
    }));
  }

  function applyMessageReaction(roomId: string, reaction: ChatReactionPlaintextPayload) {
    setMessagesByRoom((current) => {
      const roomMessages = current[roomId] ?? [];
      return {
        ...current,
        [roomId]: roomMessages.map((message) => {
          if (message.id !== reaction.messageId) return message;
          const reactions = message.reactions ?? [];
          const existing = reactions.find((item) => item.emoji === reaction.emoji);
          const reactors = existing?.reactors.filter((reactor) => reactor.userId !== reaction.reactorUserId) ?? [];
          const nextReactors = reaction.action === "add"
            ? [...reactors, { userId: reaction.reactorUserId, name: reaction.reactor }]
            : reactors;
          const nextReactions = [
            ...reactions.filter((item) => item.emoji !== reaction.emoji),
            ...(nextReactors.length ? [{ emoji: reaction.emoji, reactors: nextReactors }] : [])
          ];
          return {
            ...message,
            reactions: nextReactions
          };
        })
      };
    });
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

  async function runApprovedTerminalCheck() {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before running terminal commands.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    const projectPath = room.projectPath;
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalBusyForRoom(roomId, true);
    const command = "git status --short";
    appendTerminalLinesForRoom(roomId, [`$ ${command}`]);
    try {
      const result = await runShellCommand(projectPath, command);
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
      appendTerminalLinesForRoom(roomId, [
        output || `Command exited with ${result.status ?? "unknown"} and no output.`
      ]);
      const status = await getGitStatus(projectPath);
      setGitStatusForRoom(roomId, status);
    } catch (error) {
      appendTerminalLinesForRoom(roomId, [String(error)]);
    } finally {
      setTerminalBusyForRoom(roomId, false);
    }
  }

  async function startNamedTerminal() {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before starting a terminal.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    const name = terminalName.trim();
    const command = terminalCommand.trim();
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalBusyForRoom(roomId, true);
    setTerminalErrorForRoom(roomId, null);
    try {
      const snapshot = await startTerminal(
        roomId,
        name,
        room.projectPath,
        command
      );
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setTerminals((current) => upsertTerminal(current, snapshot));
        setSelectedTerminalIdForRoom(roomId, snapshot.id);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
    } finally {
      setTerminalBusyForRoom(roomId, false);
    }
  }

  async function restartSelectedTerminal() {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before restarting terminals.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    if (!canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked)) {
      setSelectedTerminalError(roomTerminalControlMessage(selectedRoom, selectedTerminal, isSelectedRoomLocked));
      return;
    }
    const terminal = selectedTerminal;
    if (!terminal) return;
    const roomId = selectedRoom.id;
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalBusyForRoom(roomId, true);
    setTerminalErrorForRoom(roomId, null);
    try {
      const snapshot = await startTerminal(
        roomId,
        terminal.name,
        terminal.cwd || selectedRoom.projectPath,
        terminal.command
      );
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setTerminals((current) => upsertTerminal(current, snapshot));
        setSelectedTerminalIdForRoom(roomId, snapshot.id);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
    } finally {
      setTerminalBusyForRoom(roomId, false);
    }
  }

  async function stopSelectedTerminal() {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before stopping terminals.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    if (!canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked)) {
      setSelectedTerminalError(roomTerminalControlMessage(selectedRoom, selectedTerminal, isSelectedRoomLocked));
      return;
    }
    const terminal = selectedTerminal;
    if (!terminal) return;
    const roomId = selectedRoom.id;
    const terminalId = terminal.id;
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalBusyForRoom(roomId, true);
    setTerminalErrorForRoom(roomId, null);
    try {
      const snapshot = await stopTerminal(terminalId);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setTerminals((current) => upsertTerminal(current, snapshot));
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
    } finally {
      setTerminalBusyForRoom(roomId, false);
    }
  }

  async function sendTerminalInput() {
    const input = terminalInput.trim();
    if (!input) return;
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before sending terminal input.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    if (!canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked)) {
      setSelectedTerminalError(roomTerminalControlMessage(selectedRoom, selectedTerminal, isSelectedRoomLocked));
      return;
    }
    const terminal = selectedTerminal;
    if (!terminal) return;
    const roomId = selectedRoom.id;
    const terminalId = terminal.id;
    if (reportRoomTerminalActionInFlight(roomId)) return;
    setTerminalErrorForRoom(roomId, null);
    try {
      const snapshot = await writeTerminal(terminalId, input);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setTerminals((current) => upsertTerminal(current, snapshot));
        setTerminalInputForRoom(roomId, "");
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
    }
  }

  async function requestTerminalCommand() {
    const command = terminalCommand.trim();
    if (!command) return;
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before requesting terminal commands.");
      return;
    }
    if (!canRequestWorkspace) {
      setSelectedTerminalError(workspaceRequestMessage);
      return;
    }
    const room = selectedRoom;
    setTerminalErrorForRoom(room.id, null);
    const request: TerminalCommandRequest = {
      id: crypto.randomUUID(),
      requester: localUser.name,
      requesterUserId: localUser.id,
      command,
      cwd: room.projectPath,
      requestedAt: new Date().toISOString(),
      status: "pending"
    };

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      appendTerminalRequest(room.id, request);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        setTerminalErrorForRoom(room.id, "Saved command request locally because the relay is not connected.");
      }
      return;
    }

    try {
      const secret = await loadOrCreateRoomSecret(room.id);
      const payload: TerminalRequestPlaintextPayload = {
        id: request.id,
        requester: request.requester,
        requesterUserId: request.requesterUserId,
        command: request.command,
        cwd: request.cwd,
        requestedAt: request.requestedAt
      };
      const envelope: RelayEnvelope = {
        id: crypto.randomUUID(),
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: deviceId,
        senderUserId: localUser.id,
        createdAt: new Date().toISOString(),
        kind: "terminal.request",
        payload: await encryptJson(payload, secret)
      };
      seenEnvelopeIds.current.add(envelope.id);
      client.publish({ type: "publish", envelope });
      appendTerminalRequest(room.id, request);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setTerminalErrorForRoom(room.id, String(error));
    }
  }

  async function approveTerminalRequest(request: TerminalCommandRequest) {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before approving terminal requests.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    if (reportRoomTerminalActionInFlight(roomId)) return;
    const roomRequest = findRoomTerminalRequest(terminalRequests, request.id);
    if (!roomRequest || !canActOnRoomTerminalRequest(terminalRequests, request.id)) {
      setTerminalErrorForRoom(roomId, roomTerminalRequestMessage(terminalRequests, request.id));
      return;
    }
    setTerminalBusyForRoom(roomId, true);
    setTerminalErrorForRoom(roomId, null);
    let approvedRequest: TerminalCommandRequest;
    try {
      approvedRequest = terminalRequestForApprovedRun(roomRequest, room.projectPath);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
      setTerminalBusyForRoom(roomId, false);
      return;
    }
    updateTerminalRequestStatus(room.id, approvedRequest.id, "approved");
    publishRequestStatus("terminal.event", approvedRequest.id, "approved", room).catch((error) => {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
    });
    const projectPath = room.projectPath;
    appendTerminalLinesForRoom(roomId, [
      `${approvedRequest.requester} requested: ${approvedRequest.command}`,
      `$ ${approvedRequest.command}`,
      ...(roomRequest.cwd !== approvedRequest.cwd ? [`Running in room project: ${approvedRequest.cwd}`] : [])
    ]);
    const startedAt = new Date().toISOString();
    try {
      const result = await runShellCommand(approvedRequest.cwd, approvedRequest.command);
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
      appendTerminalLinesForRoom(roomId, [
        output || `Command exited with ${result.status ?? "unknown"} and no output.`
      ]);
      publishTerminalResult(approvedRequest, {
        startedAt,
        finishedAt: new Date().toISOString(),
        exitStatus: result.status ?? null,
        stdout: result.stdout,
        stderr: result.stderr
      }, room).catch((error) => {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
      });
      const status = await getGitStatus(projectPath);
      setGitStatusForRoom(roomId, status);
    } catch (error) {
      appendTerminalLinesForRoom(roomId, [String(error)]);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(error));
      publishTerminalResult(approvedRequest, {
        startedAt,
        finishedAt: new Date().toISOString(),
        exitStatus: null,
        stdout: "",
        stderr: "",
        error: String(error)
      }, room).catch((publishError) => {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setTerminalErrorForRoom(roomId, String(publishError));
      });
    } finally {
      setTerminalBusyForRoom(roomId, false);
    }
  }

  function denyTerminalRequest(requestId: string) {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before denying terminal requests.");
      return;
    }
    if (!isActiveHost) {
      setSelectedTerminalError(hostGateMessage);
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    if (!canActOnRoomTerminalRequest(terminalRequests, requestId)) {
      setTerminalErrorForRoom(room.id, roomTerminalRequestMessage(terminalRequests, requestId));
      return;
    }
    updateTerminalRequestStatus(room.id, requestId, "denied");
    publishRequestStatus("terminal.event", requestId, "denied", room).catch((error) => {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setTerminalErrorForRoom(room.id, String(error));
    });
  }

  function appendTerminalRequest(roomId: string, request: TerminalCommandRequest) {
    setTerminalRequestsByRoom((current) => {
      const roomRequests = current[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return current;
      return {
        ...current,
        [roomId]: [...roomRequests, request]
      };
    });
  }

  function updateTerminalRequestStatus(
    roomId: string,
    requestId: string,
    status: TerminalCommandRequest["status"]
  ) {
    setTerminalRequestsByRoom((current) => ({
      ...current,
      [roomId]: (current[roomId] ?? []).map((request) =>
        request.id === requestId ? { ...request, status } : request
      )
    }));
  }

  async function requestBrowserAccess() {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before requesting browser access.");
      return;
    }
    const room = selectedRoom;
    const activeHost = isActiveHost;
    if (!canRequestBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const roomId = room.id;
    const rawUrl = browserUrl.trim();
    if (!rawUrl) return;
    setBrowserMessageForRoom(roomId, null);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      setBrowserMessageForRoom(roomId, "Enter a valid browser URL.");
      return;
    }

    const autoApproved = shouldAutoApproveBrowserRequest(parsedUrl.toString(), room, activeHost);
    const request: BrowserAccessRequest = {
      id: crypto.randomUUID(),
      requester: localUser.name,
      requesterUserId: localUser.id,
      url: parsedUrl.toString(),
      reason: browserReason.trim() || "No reason provided.",
      requestedAt: new Date().toISOString(),
      status: autoApproved ? "approved" : "pending"
    };

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      appendBrowserRequest(room.id, request);
      if (autoApproved) {
        appendBrowserDecisionMessage(
          room.id,
          buildLocalRequestStatusPayload(request.id, "approved"),
          request
        );
      }
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setBrowserMessageForRoom(
          roomId,
          autoApproved
            ? `Auto-approved allowed browser site ${formatBrowserAccessLabel(request.url)} locally because the relay is not connected.`
            : "Saved browser request locally because the relay is not connected."
        );
      }
      return;
    }

    try {
      const payload: BrowserRequestPlaintextPayload = {
        id: request.id,
        requester: request.requester,
        requesterUserId: request.requesterUserId,
        url: request.url,
        reason: request.reason,
        requestedAt: request.requestedAt
      };
      const secret = await loadOrCreateRoomSecret(room.id);
      const envelope: RelayEnvelope = {
        id: crypto.randomUUID(),
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: deviceId,
        senderUserId: localUser.id,
        createdAt: new Date().toISOString(),
        kind: "browser.request",
        payload: await encryptJson(payload, secret)
      };
      seenEnvelopeIds.current.add(envelope.id);
      client.publish({ type: "publish", envelope });
      appendBrowserRequest(room.id, request);
      if (autoApproved) {
        appendBrowserDecisionMessage(
          room.id,
          buildLocalRequestStatusPayload(request.id, "approved"),
          request
        );
        await publishRequestStatus("browser.event", request.id, "approved", room);
      }
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setBrowserMessageForRoom(
          roomId,
          autoApproved
            ? `Auto-approved allowed browser site ${formatBrowserAccessLabel(request.url)}.`
            : `Requested browser access to ${formatBrowserAccessLabel(request.url)}.`
        );
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setBrowserMessageForRoom(roomId, String(error));
    }
  }

  function approveBrowserRequest(request: BrowserAccessRequest) {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before approving browser access.");
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(hostGateMessage);
      return;
    }
    if (!canHostBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const roomId = selectedRoom.id;
    const roomRequest = findRoomBrowserRequest(browserRequests, request.id);
    if (!roomRequest || !canActOnRoomBrowserRequest(browserRequests, request.id, "pending")) {
      setBrowserMessageForRoom(roomId, roomBrowserRequestMessage(browserRequests, request.id, "pending"));
      return;
    }
    const decision = buildLocalRequestStatusPayload(roomRequest.id, "approved");
    updateBrowserRequestStatus(roomId, roomRequest.id, "approved");
    appendBrowserDecisionMessage(roomId, decision);
    publishRequestStatus("browser.event", roomRequest.id, "approved").catch((error) => {
      setBrowserMessageForRoom(roomId, String(error));
    });
    setBrowserMessageForRoom(roomId, `Approved browser access to ${formatBrowserAccessLabel(roomRequest.url)}.`);
  }

  function denyBrowserRequest(requestId: string) {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before denying browser access.");
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(hostGateMessage);
      return;
    }
    if (!canHostBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (!canActOnRoomBrowserRequest(browserRequests, requestId, "pending")) {
      setBrowserMessageForRoom(roomId, roomBrowserRequestMessage(browserRequests, requestId, "pending"));
      return;
    }
    const decision = buildLocalRequestStatusPayload(requestId, "denied");
    updateBrowserRequestStatus(roomId, requestId, "denied");
    appendBrowserDecisionMessage(roomId, decision);
    publishRequestStatus("browser.event", requestId, "denied").catch((error) => {
      setBrowserMessageForRoom(roomId, String(error));
    });
    setBrowserMessageForRoom(roomId, "Denied browser access request.");
  }

  async function openApprovedBrowserRequest(request: BrowserAccessRequest) {
    if (request.status !== "approved") return;
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before opening the room browser.");
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(hostGateMessage);
      return;
    }
    if (!canHostBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const room = selectedRoom;
    const roomRequest = findRoomBrowserRequest(browserRequests, request.id);
    if (!roomRequest || !canActOnRoomBrowserRequest(browserRequests, request.id, "approved")) {
      setBrowserMessageForRoom(room.id, roomBrowserRequestMessage(browserRequests, request.id, "approved"));
      return;
    }
    setBrowserMessageForRoom(room.id, null);
    try {
      const result = await openBrowserView(
        room.id,
        room.projectPath,
        roomRequest.url,
        `${room.name} - ${formatBrowserAccessLabel(roomRequest.url)}`,
        room.browserProfilePersistent
      );
      setBrowserStatusByRoom((current) => ({
        ...current,
        [room.id]: {
          profilePath: result.profilePath,
          downloadsBlocked: result.downloadsBlocked,
          clipboardBlocked: result.clipboardBlocked,
          fileUploadsBlocked: result.fileUploadsBlocked
        }
      }));
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        setBrowserMessageForRoom(
          room.id,
          result.reused
            ? `Reused isolated room browser for ${formatBrowserAccessLabel(result.url)}.`
            : room.browserProfilePersistent
              ? `Opened isolated room browser for ${formatBrowserAccessLabel(result.url)}.`
              : `Opened fresh isolated room browser for ${formatBrowserAccessLabel(result.url)}.`
        );
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setBrowserMessageForRoom(room.id, String(error));
    }
  }

  async function resetRoomBrowserProfile() {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before resetting browser state.");
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(hostGateMessage);
      return;
    }
    if (!canHostBrowser) {
      setSelectedBrowserMessage(browserAccessMessage);
      return;
    }
    const room = selectedRoom;
    setBrowserMessageForRoom(room.id, null);
    try {
      const result = await resetBrowserProfile(room.id, room.projectPath);
      setBrowserStatusByRoom((current) => ({
        ...current,
        [room.id]: {
          ...defaultBrowserStatus,
          profilePath: result.profilePath
        }
      }));
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        setBrowserMessageForRoom(room.id, "Reset isolated room browser state. The next approved page opens with a fresh profile.");
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setBrowserMessageForRoom(room.id, String(error));
    }
  }

  function acknowledgeRoomVisibilityWarning() {
    if (!hasSelectedRoom) {
      return;
    }
    saveRoomVisibilityWarningAcknowledgement(selectedRoom.id);
    setSecretWarningVisibleForRoom(selectedRoom.id, false);
  }

  function appendBrowserRequest(roomId: string, request: BrowserAccessRequest) {
    setBrowserRequestsByRoom((current) => {
      const roomRequests = current[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return current;
      return {
        ...current,
        [roomId]: [...roomRequests, request]
      };
    });
  }

  function updateBrowserRequestStatus(
    roomId: string,
    requestId: string,
    status: BrowserAccessRequest["status"]
  ) {
    setBrowserRequestsByRoom((current) => ({
      ...current,
      [roomId]: (current[roomId] ?? []).map((request) =>
        request.id === requestId ? { ...request, status } : request
      )
    }));
  }

  function appendBrowserDecisionMessage(
    roomId: string,
    decision: RequestStatusPlaintextPayload,
    requestOverride?: Pick<BrowserAccessRequest, "url" | "requester">
  ) {
    const request = requestOverride ?? (browserRequestsRef.current[roomId] ?? []).find((item) => item.id === decision.requestId);
    appendRoomMessage(roomId, {
      id: browserDecisionMessageId(decision),
      author: "multAIplayer",
      role: "system",
      body: buildBrowserDecisionMessage(decision, request, formatBrowserAccessLabel),
      time: formatMessageTime(decision.decidedAt),
      createdAt: decision.decidedAt
    });
  }

  function buildLocalRequestStatusPayload(
    requestId: string,
    status: RequestStatusPlaintextPayload["status"]
  ): RequestStatusPlaintextPayload {
    return {
      requestId,
      status,
      decidedBy: localUser.name,
      decidedByUserId: localUser.id,
      decidedAt: new Date().toISOString()
    };
  }

  async function publishRequestStatus(
    kind: "terminal.event" | "browser.event",
    requestId: string,
    status: RequestStatusPlaintextPayload["status"],
    room: RoomRecord = selectedRoom
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const payload = buildLocalRequestStatusPayload(requestId, status);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.decidedAt,
      kind,
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishTerminalResult(
    request: TerminalCommandRequest,
    result: {
      startedAt: string;
      finishedAt: string;
      exitStatus: number | null;
      stdout: string;
      stderr: string;
      error?: string;
    },
    room: RoomRecord = selectedRoom
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const payload: TerminalResultPlaintextPayload = {
      eventType: "terminal.result",
      requestId: request.id,
      command: request.command,
      cwd: request.cwd,
      exitStatus: result.exitStatus,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
      ranBy: localUser.name,
      ranByUserId: localUser.id,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt
    };
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.finishedAt,
      kind: "terminal.event",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishGitWorkflowEvent(
    event: Omit<GitWorkflowEventPlaintextPayload, "eventType" | "runner" | "runnerUserId" | "createdAt">,
    room: RoomRecord = selectedRoom
  ) {
    const payload: GitWorkflowEventPlaintextPayload = {
      eventType: "git.workflow",
      runner: localUser.name,
      runnerUserId: localUser.id,
      createdAt: new Date().toISOString(),
      ...event
    };
    appendGitWorkflowEvent(room.id, payload);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.createdAt,
      kind: "git.event",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishCodexEvent(
    event: Omit<CodexEventPlaintextPayload, "eventType" | "host" | "hostUserId" | "createdAt">,
    room: RoomRecord = selectedRoom
  ) {
    const payload: CodexEventPlaintextPayload = {
      eventType: "codex.turn",
      host: localUser.name,
      hostUserId: localUser.id,
      createdAt: new Date().toISOString(),
      ...event
    };
    appendCodexEvent(room.id, payload);
    appendTerminalLinesForRoom(room.id, [buildCodexEventLine(payload)]);

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.createdAt,
      kind: "codex.event",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishRoomSettingsEvent(
    room: RoomRecord,
    event: Omit<RoomSettingsPlaintextPayload, "eventType" | "changedBy" | "changedByUserId">
  ) {
    const payload: RoomSettingsPlaintextPayload = {
      eventType: "room.settings",
      changedBy: localUser.name,
      changedByUserId: localUser.id,
      ...event
    };
    appendRoomMessage(room.id, buildRoomSettingsSystemMessage(payload));

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.changedAt,
      kind: "room.settings",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishGitHubActionsEvent(
    event: Omit<GitHubActionsEventPlaintextPayload, "eventType" | "checkedBy" | "checkedByUserId">,
    room: RoomRecord = selectedRoom
  ) {
    const payload: GitHubActionsEventPlaintextPayload = {
      eventType: "github.actions",
      checkedBy: localUser.name,
      checkedByUserId: localUser.id,
      ...event
    };
    appendGitHubActionsEvent(room.id, payload);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.checkedAt,
      kind: "git.event",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function openProjectFile(path: string, preferredPreview: FilePreviewTab = "file") {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before opening project files.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedFileMessage(localWorkspaceMessage);
      return;
    }
    const room = selectedRoom;
    if (reportRoomFileActionInFlight(room.id)) return;
    setFileBusyForRoom(room.id, true);
    setFileMessageForRoom(room.id, null);
    try {
      const [file, diff] = await Promise.all([
        readProjectFile(room.projectPath, path),
        getGitDiff(room.projectPath, path).catch(() => null)
      ]);
      if (selectedRoomIdRef.current !== room.id) return;
      setSelectedFileForRoom(room.id, file);
      setSelectedDiffForRoom(room.id, diff);
      setFilePreviewTabForRoom(room.id, resolveFilePreviewTab(preferredPreview, Boolean(diff?.diff.trim())));
      setSensitiveAttachmentReviewKey(null);
    } catch (error) {
      if (selectedRoomIdRef.current === room.id) setFileMessageForRoom(room.id, String(error));
    } finally {
      setFileBusyForRoom(room.id, false);
    }
  }

  async function copyProjectMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before copying project context.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedFileMessage(localWorkspaceMessage);
      return;
    }
    const roomId = selectedRoom.id;
    const markdown = buildProjectMarkdown(
      selectedRoom.name,
      selectedRoom.projectPath,
      gitStatus?.files ?? [],
      selectedFile,
      selectedDiff,
      selectedFile
        ? selectedFileRisks
        : selectedDiff
          ? detectSecretRisks(selectedDiff.diff, selectedDiff.path)
          : []
    );
    await copyMarkdownWithFallback("project context", markdown, (message) => setFileMessageForRoom(roomId, message), roomId);
  }

  async function attachSelectedFileToMessage() {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before attaching project files.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedFileMessage(localWorkspaceMessage);
      return;
    }
    if (!canStageRoomChatAttachment(selectedRoom, isSelectedRoomLocked)) {
      setSelectedFileMessage(roomChatGateMessage(selectedRoom, isSelectedRoomLocked));
      return;
    }
    if (!selectedFile) {
      setSelectedFileMessage("Select a project file before attaching it to the room.");
      return;
    }
    const roomId = selectedRoom.id;
    const teamId = selectedRoom.teamId;
    const fileToAttach = selectedFile;
    const roomPendingAttachments = pendingAttachmentsByRoom[roomId] ?? [];
    const review = decideAttachmentReview(
      fileToAttach.content,
      fileToAttach.path,
      reviewedAttachmentPathForScope(sensitiveAttachmentReviewKey, roomId, selectedRoom.projectPath, fileToAttach.path)
    );
    if (!review.canAttach) {
      setSensitiveAttachmentReviewKey(attachmentReviewScopeKey(roomId, selectedRoom.projectPath, fileToAttach.path));
      setFileMessageForRoom(roomId, attachmentReviewMessage(fileToAttach.path, review.risks));
      return;
    }
    const attachment: ChatAttachment = {
      id: crypto.randomUUID(),
      name: fileToAttach.path,
      type: attachmentTypeFromName(fileToAttach.path),
      size: fileToAttach.size,
      content: fileToAttach.content,
      truncated: fileToAttach.truncated
    };
    if (roomPendingAttachments.some((item) => item.name === attachment.name)) {
      setFileMessageForRoom(roomId, `${attachment.name} is already attached to the next room message.`);
      return;
    }
    const selectedContentBytes = encodedBytes(attachment.content ?? "");
    const shouldUploadBlob = selectedContentBytes > maxEmbeddedAttachmentBytes ||
      embeddedAttachmentBytes(roomPendingAttachments) + selectedContentBytes > maxEmbeddedAttachmentBytesPerMessage;
    if (shouldUploadBlob) {
      if (reportRoomFileActionInFlight(roomId)) return;
      try {
        setFileBusyForRoom(roomId, true);
        const secret = await loadOrCreateRoomSecret(roomId);
        const blob = await createAttachmentBlob({
          teamId,
          roomId,
          name: fileToAttach.path,
          type: attachment.type,
          size: fileToAttach.size,
          payload: await encryptJson({
            name: fileToAttach.path,
            type: attachment.type,
            size: fileToAttach.size,
            content: fileToAttach.content,
            truncated: fileToAttach.truncated
          }, secret)
        });
        attachment.content = undefined;
        attachment.blobId = blob.id;
        attachment.blobBytes = selectedContentBytes;
        attachment.truncated = fileToAttach.truncated || selectedContentBytes > maxEmbeddedAttachmentBytes;
      } catch (error) {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setFileMessageForRoom(roomId, `Could not upload encrypted attachment blob: ${String(error)}`);
        }
        return;
      } finally {
        setFileBusyForRoom(roomId, false);
      }
    }
    setPendingAttachmentsForRoom(roomId, (current) => {
      if (current.some((item) => item.name === attachment.name)) {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setFileMessageForRoom(roomId, `${attachment.name} is already attached to the next room message.`);
        }
        return current;
      }
      const next = [...current, attachment];
      const validationError = validatePendingAttachments(next);
      if (validationError) {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setFileMessageForRoom(roomId, validationError);
        return current;
      }
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSensitiveAttachmentReviewKey(null);
        setFileMessageForRoom(roomId, attachment.blobId
          ? `Attached ${fileToAttach.path} as an encrypted blob for the next room message.`
          : `Attached ${fileToAttach.path} to the next room message.`);
      }
      return next;
    });
  }

  function removePendingAttachment(attachmentId: string) {
    setPendingAttachmentsForRoom(selectedRoom.id, (current) =>
      current.filter((attachment) => attachment.id !== attachmentId)
    );
  }

  async function openEncryptedAttachmentBlob(attachment: ChatAttachment) {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before opening encrypted attachments.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedFileMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const room = selectedRoom;
    if (!attachment.blobId) {
      if (attachment.content) {
        if (selectedRoomIdRef.current !== room.id) return;
        setSelectedDiffForRoom(room.id, null);
        setSelectedFileForRoom(room.id, {
          path: attachment.name,
          size: attachment.size,
          truncated: Boolean(attachment.truncated),
          content: attachment.content
        });
        setFileMessageForRoom(room.id, `Opened inline attachment ${attachment.name}.`);
      }
      return;
    }
    if (reportRoomFileActionInFlight(room.id)) return;
    setFileBusyForRoom(room.id, true);
    setFileMessageForRoom(room.id, null);
    try {
      const [blob, secret] = await Promise.all([
        loadAttachmentBlob(attachment.blobId, room.teamId, room.id),
        loadOrCreateRoomSecret(room.id)
      ]);
      if (blob.roomId !== room.id || blob.teamId !== room.teamId) {
        throw new Error("Attachment blob belongs to a different room.");
      }
      const decrypted = await decryptJson<unknown>(blob.payload, secret);
      if (!isAttachmentBlobContent(decrypted)) {
        throw new Error("Attachment blob payload was not a supported file preview.");
      }
      if (selectedRoomIdRef.current !== room.id) return;
      setSelectedDiffForRoom(room.id, null);
      setSelectedFileForRoom(room.id, {
        path: decrypted.name || attachment.name,
        size: decrypted.size ?? attachment.size,
        truncated: Boolean(decrypted.truncated),
        content: decrypted.content
      });
      setFileMessageForRoom(room.id, `Opened encrypted attachment ${decrypted.name || attachment.name}.`);
    } catch (error) {
      if (selectedRoomIdRef.current === room.id) {
        setFileMessageForRoom(room.id, `Could not open encrypted attachment: ${String(error)}`);
      }
    } finally {
      setFileBusyForRoom(room.id, false);
    }
  }

  async function copyMarkdownWithFallback(
    title: string,
    markdown: string,
    onMessage: (message: string) => void,
    roomId = selectedRoom.id
  ) {
    const result = await copyTextToClipboard(markdown);
    if (result.status === "copied") {
      setMarkdownCopyFallbackForRoom(roomId, null);
      onMessage(`Copied ${title} as Markdown.`);
      return;
    }
    setMarkdownCopyFallbackForRoom(roomId, { title, markdown });
    onMessage(`${title} Markdown is ready below because copying was blocked.`);
  }

  async function copyRoomMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedChatMessage("Create or join a room before copying room chat.");
      return;
    }
    const roomId = selectedRoom.id;
    const markdown = buildRoomMarkdown(selectedRoom, teams.find((team) => team.id === selectedRoom.teamId)?.name ?? "Unknown team", messages);
    await copyMarkdownWithFallback("room chat", markdown, (message) => setChatMessageForRoom(roomId, message), roomId);
  }

  function toggleMessageSelection(messageId: string) {
    if (!hasSelectedRoom) return;
    setSelectedMessageIdsByRoom((current) => {
      const roomIds = current[selectedRoom.id] ?? [];
      const nextIds = roomIds.includes(messageId)
        ? roomIds.filter((id) => id !== messageId)
        : [...roomIds, messageId];
      return {
        ...current,
        [selectedRoom.id]: nextIds
      };
    });
  }

  function clearSelectedMessages() {
    setSelectedMessageIdsByRoom((current) => omitRecordKey(current, selectedRoom.id));
  }

  async function copySelectedMessagesMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedChatMessage("Create or join a room before copying selected messages.");
      return;
    }
    const roomId = selectedRoom.id;
    if (selectedMessages.length === 0) {
      setChatMessageForRoom(roomId, "Select one or more messages to copy.");
      return;
    }
    const markdown = buildSelectedMessagesMarkdown(selectedRoom, selectedMessages);
    await copyMarkdownWithFallback("selected messages", markdown, (message) => setChatMessageForRoom(roomId, message), roomId);
  }

  async function copyMessageMarkdown(message: ChatMessage) {
    const roomId = selectedRoom.id;
    const markdown = buildMessageMarkdown(message);
    await copyMarkdownWithFallback("message", markdown, (copyMessage) => setChatMessageForRoom(roomId, copyMessage), roomId);
  }

  async function copyCodexOutputMarkdown(message: ChatMessage) {
    if (!hasSelectedRoom) {
      setSelectedChatMessage("Create or join a room before copying Codex output.");
      return;
    }
    const roomId = selectedRoom.id;
    const markdown = buildCodexOutputMarkdown(selectedRoom, message, messages);
    await copyMarkdownWithFallback("Codex turn output", markdown, (copyMessage) => setChatMessageForRoom(roomId, copyMessage), roomId);
  }

  async function copyTerminalMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedTerminalError("Create or join a room before copying terminal output.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedTerminalError(localWorkspaceMessage);
      return;
    }
    const roomId = selectedRoom.id;
    const lines = selectedTerminal?.lines ?? terminalLines.map((line) => ({ stream: "system", text: line }));
    const markdown = buildTerminalMarkdown(selectedRoom, selectedTerminal, lines, terminalRisks);
    await copyMarkdownWithFallback("terminal output", markdown, (message) => setTerminalErrorForRoom(roomId, message), roomId);
  }

  async function copyDiffSummaryMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedFileMessage("Create or join a room before copying a diff summary.");
      return;
    }
    if (!canReadLocalWorkspace) {
      setSelectedFileMessage(localWorkspaceMessage);
      return;
    }
    const roomId = selectedRoom.id;
    const markdown = buildDiffSummaryMarkdown(
      selectedRoom,
      gitStatus?.branch ?? "unknown",
      gitStatus?.files ?? [],
      selectedDiff,
      selectedDiff ? detectSecretRisks(selectedDiff.diff, selectedDiff.path) : []
    );
    await copyMarkdownWithFallback("diff summary", markdown, (message) => setFileMessageForRoom(roomId, message), roomId);
  }

  async function copyPullRequestDraftMarkdown() {
    if (!hasSelectedRoom) {
      setSelectedGitWorkflowMessage("Create or join a room before copying a PR draft.");
      return;
    }
    const roomId = selectedRoom.id;
    if (!canReadLocalWorkspace) {
      setGitWorkflowMessageForRoom(roomId, localWorkspaceMessage);
      return;
    }
    const markdown = buildPullRequestBody(messages, gitStatus?.files ?? []);
    await copyMarkdownWithFallback("PR description draft", markdown, (message) => setGitWorkflowMessageForRoom(roomId, message), roomId);
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

  async function refreshGitHubActions(roomArg?: RoomRecord, targetArg?: GitHubActionsTarget) {
    const room = roomArg ?? (hasSelectedRoom ? selectedRoom : null);
    if (!room) {
      return;
    }
    const roomId = room.id;
    if (isGitHubActionsRefreshInFlight(actionsBusyRef.current, roomId)) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: gitHubActionsRefreshInFlightMessage()
      }));
      return;
    }
    if (!roomsRef.current.some((item) => item.id === roomId)) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: "This room is no longer available for GitHub Actions refresh."
      }));
      return;
    }
    const roomRevoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    const roomLocked = forgottenRoomIds.has(room.id) || roomRevoked;
    const roomActiveHost = isLocalUserActiveHostForRoom(room, localUser);
    const roomCanReadLocalWorkspace = canUseLocalWorkspace(room, localUser, roomLocked);
    if (!roomActiveHost) {
      const roomHostGateMessage =
        room.hostStatus === "active"
          ? `Only ${room.host} can refresh GitHub Actions in this room.`
          : "Claim host before refreshing GitHub Actions in this room.";
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: roomHostGateMessage
      }));
      return;
    }
    if (!roomCanReadLocalWorkspace) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: localWorkspaceGateMessage(room, roomLocked)
      }));
      return;
    }
    const workflowDraft = resolveGitWorkflowDraft(gitWorkflowDraftsRef.current, roomId);
    const readiness = checkGitHubActionsReadiness({
      authConfig,
      currentUser,
      owner: targetArg?.owner ?? workflowDraft.prOwner,
      repo: targetArg?.repo ?? workflowDraft.prRepo,
      branch: targetArg?.branch ?? workflowDraft.branchName
    });
    if (!readiness.ready) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: readiness.messages.join(" ")
      }));
      return;
    }
    const actionsTarget = readiness.normalizedTarget;
    if (!actionsTarget) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: "GitHub Actions target could not be normalized."
      }));
      return;
    }
    setActionsBusyForRoom(roomId, true);
    setActionsMessagesByRoom((current) => omitRecordKey(current, roomId));
    try {
      const result = await listGitHubActionRuns(actionsTarget.owner, actionsTarget.repo, actionsTarget.branch);
      const checkedAt = new Date().toISOString();
      setActionRunsByRoom((current) => ({
        ...current,
        [roomId]: result.runs
      }));
      setActionsLastCheckedByRoom((current) => ({
        ...current,
        [roomId]: checkedAt
      }));
      const summary = summarizeActionRuns(result.runs);
      const message = result.runs.length
        ? `Loaded ${result.runs.length} workflow runs for ${actionsTarget.branch}.`
        : `No workflow runs found for ${actionsTarget.branch}. GitHub may still be scheduling the branch.`;
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: `${summary.label}: ${message}`
      }));
      publishGitHubActionsEvent({
        owner: actionsTarget.owner,
        repo: actionsTarget.repo,
        branch: actionsTarget.branch,
        summary,
        message,
        checkedAt,
        runs: result.runs
      }, room).catch((error) => {
        console.warn("Failed to publish GitHub Actions event", error);
      });
    } catch (error) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: String(error)
      }));
    } finally {
      setActionsBusyForRoom(roomId, false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">AI</div>
          <div>
            <strong>multAIplayer</strong>
            <span>honest alpha</span>
          </div>
        </div>

        {currentUser ? (
          <div className="profile-card">
            {currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt="" /> : <Github size={18} />}
            <div>
              <strong>{currentUser.name ?? currentUser.login}</strong>
              <span>@{currentUser.login}</span>
            </div>
            <button onClick={signOut}>Sign out</button>
          </div>
        ) : (
          <button className="github-button" onClick={beginGitHubSignIn} disabled={authBusy || authConfig?.configured === false}>
            <Github size={16} />
            {authConfig?.configured === false ? "GitHub OAuth not configured" : authBusy ? "Waiting for GitHub" : "Sign in with GitHub"}
          </button>
        )}

        {deviceFlow && (
          <div className="device-flow">
            <span>Enter this code on GitHub</span>
            <strong>{deviceFlow.user_code}</strong>
            <a href={deviceFlow.verification_uri} target="_blank" rel="noreferrer">
              Open GitHub <ExternalLink size={13} />
            </a>
          </div>
        )}
        {authError && <div className="auth-error">{authError}</div>}

        <label className="search-box">
          <Search size={16} />
          <input
            placeholder="Search rooms, projects, chats"
            value={sidebarQuery}
            onChange={(event) => setSidebarQuery(event.target.value)}
          />
          {sidebarQuery && (
            <button onClick={() => setSidebarQuery("")} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>
        {workspaceError && <div className="workspace-error">{workspaceError}</div>}

        <section className="sidebar-section">
          <div className="section-title">
            <span>{searchActive ? "Matching teams" : "Teams"}</span>
            <button onClick={addTeam} aria-label="Create team" disabled={!newTeamName.trim()}><Plus size={15} /></button>
          </div>
          {!searchActive && (
            <div className="sidebar-create-form">
              <input
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newTeamName.trim()) {
                    event.preventDefault();
                    addTeam();
                  }
                }}
                placeholder="Team name"
              />
            </div>
          )}
          <div className="team-list">
            {visibleTeams.map((team) => (
              <button
                className={`team-button ${team.id === selectedTeam ? "active" : ""}`}
                key={team.id}
                onClick={() => {
                  setSelectedTeam(team.id);
                  setSelectedRoomId(rooms.find((room) => room.teamId === team.id)?.id ?? rooms[0]?.id ?? "");
                }}
              >
                <UsersRound size={16} />
                <span>{team.name}</span>
                <small>{formatTeamMeta(team)}</small>
              </button>
            ))}
            {visibleTeams.length === 0 && (
              <div className="sidebar-empty">
                {searchActive ? "No teams found." : "No teams yet. Create one to start."}
              </div>
            )}
          </div>
        </section>

        <section className="sidebar-section rooms">
          <div className="section-title">
            <span>{searchActive ? "Matching rooms" : "Rooms"}</span>
            <button onClick={addRoom} aria-label="Create room" disabled={!selectedTeam || !newRoomName.trim() || !newRoomProjectPath.trim()}><Plus size={15} /></button>
          </div>
          {!searchActive && (
            <div className="sidebar-create-form room-create-form">
              <input
                value={newRoomName}
                onChange={(event) => setNewRoomName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newRoomName.trim() && newRoomProjectPath.trim()) {
                    event.preventDefault();
                    addRoom();
                  }
                }}
                placeholder="Room name"
                disabled={!selectedTeam}
              />
              <div className="path-create-row">
                <input
                  value={newRoomProjectPath}
                  onChange={(event) => setNewRoomProjectPath(event.target.value)}
                  placeholder={defaultProjectPath}
                  disabled={!selectedTeam}
                />
                <button onClick={chooseNewRoomProjectPath} disabled={!selectedTeam} aria-label="Choose project folder">
                  <FolderGit2 size={14} />
                </button>
              </div>
            </div>
          )}
          {visibleRooms.map((room) => {
            const roomAttention = inspectorAttentionCounts({
              approvalVisible: approvalVisibleByRoom[room.id] ?? false,
              terminalRequests: terminalRequestsByRoom[room.id] ?? [],
              browserRequests: browserRequestsByRoom[room.id] ?? []
            });
            const roomAttentionTotal = roomAttention.work + roomAttention.browser;

            return (
              <button
                key={room.id}
                className={`room-button ${room.id === selectedRoomId ? "active" : ""}`}
                onClick={() => {
                  setSelectedTeam(room.teamId);
                  setSelectedRoomId(room.id);
                }}
              >
                <div>
                  <strong>{room.name}</strong>
                  <span>{searchActive ? teams.find((team) => team.id === room.teamId)?.name : room.projectPath.split("/").slice(-1)[0]}</span>
                </div>
                <div className="room-indicators">
                  {roomAttentionTotal > 0 && <b className="attention">{roomAttentionTotal}</b>}
                  {room.unread > 0 ? <b>{room.unread}</b> : roomAttentionTotal === 0 ? <Circle size={8} /> : null}
                </div>
              </button>
            );
          })}
          {visibleRooms.length === 0 && (
            <div className="sidebar-empty">
              {searchActive
                ? "No rooms or projects found."
                : selectedTeam
                  ? "No rooms yet. Create one for this team."
                  : "Create a team before adding rooms."}
            </div>
          )}
        </section>

        {searchActive && (
          <section className="sidebar-section">
            <div className="section-title">
              <span>Chat hits</span>
            </div>
            <div className="message-hit-list">
              {visibleMessageHits.map((hit) => {
                const room = rooms.find((item) => item.id === hit.roomId);
                return (
                <button
                  key={`${hit.roomId}-${hit.message.id}`}
                  onClick={() => {
                    if (room) setSelectedTeam(room.teamId);
                    setSelectedRoomId(hit.roomId);
                  }}
                >
                  <strong>{hit.message.author}</strong>
                  <span>{room?.name ?? "Room"} · {hit.message.body}</span>
                </button>
                );
              })}
              {visibleMessageHits.length === 0 && (
                <div className="sidebar-empty">
                  {historySearchBusy ? "Searching encrypted local history..." : "No chat or local history matches."}
                </div>
              )}
            </div>
          </section>
        )}

        <div className="sidebar-footer">
          <button
            className={activeSidebarPanel === "settings" ? "active" : ""}
            onClick={() => setActiveSidebarPanel((current) => current === "settings" ? null : "settings")}
          >
            <Settings size={16} /> Settings
          </button>
          <button
            className={activeSidebarPanel === "profile" ? "active" : ""}
            onClick={() => setActiveSidebarPanel((current) => current === "profile" ? null : "profile")}
          >
            <UserRoundCheck size={16} /> Profile
          </button>
        </div>
      </aside>

      {activeSidebarPanel && (
        <aside className="sidebar-drawer">
          <div className="drawer-header">
            <div>
              <span>{activeSidebarPanel === "profile" ? "Account" : "Room settings"}</span>
              <strong>{activeSidebarPanel === "profile" ? localUser.name : selectedRoom.name}</strong>
            </div>
            <button onClick={() => setActiveSidebarPanel(null)} aria-label="Close panel">
              <X size={16} />
            </button>
          </div>

          {activeSidebarPanel === "profile" ? (
            <div className="drawer-content">
              <section className="drawer-section account-section">
                {currentUser?.avatarUrl ? (
                  <img src={currentUser.avatarUrl} alt="" />
                ) : (
                  <div className="drawer-avatar">
                    {currentUser ? currentUser.login.slice(0, 1).toUpperCase() : <Github size={24} />}
                  </div>
                )}
                <div>
                  <strong>{currentUser?.name ?? currentUser?.login ?? "Not signed in"}</strong>
                  <span>{currentUser ? `@${currentUser.login}` : "GitHub required for PRs and Actions"}</span>
                </div>
              </section>

              <section className="drawer-section">
                <InfoRow label="GitHub OAuth" value={authConfig?.configured === false ? "Not configured" : "Configured"} />
                <InfoRow label="OAuth scopes" value={authConfig?.scopes.join(", ") || "Unavailable"} />
                <InfoRow label="Allowed origins" value={authConfig?.allowedOrigins.join(", ") || "Local/default"} />
                <InfoRow label="Workspace edits" value={authConfig?.mutationsRequireAuth ? "Sign-in required" : "Local permissive"} />
                <InfoRow label="Relay sessions" value={formatSessionPersistence(authConfig?.sessionPersistence)} />
                <InfoRow label="Session" value={currentUser ? "Signed in" : "Signed out"} />
                <InfoRow label="Device" value={deviceId} />
                <InfoRow label="Device key" value={deviceIdentity?.publicKeyFingerprint ?? "Generating"} />
                <InfoRow label="Key algorithm" value={deviceIdentity?.algorithm ?? "Unavailable"} />
                {currentUser && <InfoRow label="User id" value={currentUser.id} />}
              </section>

              <button className="ghost-wide" onClick={rotateDeviceIdentity}>
                <KeyRound size={15} />
                Rotate device key
              </button>
              {deviceIdentityMessage && <div className="workflow-message">{deviceIdentityMessage}</div>}

              {currentUser ? (
                <button className="ghost-wide" onClick={signOut}>
                  <X size={15} />
                  Sign out
                </button>
              ) : (
                <button
                  className="primary-wide"
                  onClick={beginGitHubSignIn}
                  disabled={authBusy || authConfig?.configured === false}
                >
                  <Github size={15} />
                  {authConfig?.configured === false ? "GitHub OAuth not configured" : authBusy ? "Waiting for GitHub" : "Sign in with GitHub"}
                </button>
              )}

              {deviceFlow && (
                <div className="device-flow drawer-flow">
                  <span>GitHub code</span>
                  <strong>{deviceFlow.user_code}</strong>
                  <a href={deviceFlow.verification_uri} target="_blank" rel="noreferrer">
                    Open GitHub <ExternalLink size={13} />
                  </a>
                </div>
              )}
              {authError && <div className="auth-error">{authError}</div>}
            </div>
          ) : (
            <div className="drawer-content">
              <RoomSettingsOverview
                relay={`${relayStatus} · ${appConfig.relayWsUrl}`}
                relayApi={appConfig.relayHttpUrl}
                codex={codexProbe?.available ? codexProbe.version ?? "Available" : codexProbe?.error ?? "Not connected"}
                project={selectedRoom.projectPath}
                model={formatCodexModel(selectedCodexModel)}
                approval={approvalPolicyLabels[selectedRoom.approvalPolicy]}
                roomKeys={roomSecretStorageLabel()}
                posture={roomPosture}
                chooseProjectDisabled={!hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost}
                onChooseProject={chooseProjectPath}
              />

              <section className="drawer-section relay-config-section">
                <div className="drawer-section-title">Relay connection</div>
                <label>
                  <span>HTTP API URL</span>
                  <input
                    value={relayHttpDraft}
                    onChange={(event) => setRelayHttpDraft(event.target.value)}
                    placeholder={defaultRelayHttpUrl}
                  />
                </label>
                <label>
                  <span>WebSocket rooms URL</span>
                  <input
                    value={relayWsDraft}
                    onChange={(event) => setRelayWsDraft(event.target.value)}
                    placeholder={defaultRelayWsUrl}
                  />
                </label>
                <div className="drawer-button-row">
                  <button className="ghost-wide" onClick={resetRelayConfiguration}>
                    <RefreshCw size={15} />
                    Defaults
                  </button>
                  <button
                    className="primary-wide"
                    onClick={saveRelayConfiguration}
                    disabled={!relayHttpDraft.trim() || !relayWsDraft.trim()}
                  >
                    <Check size={15} />
                    Save relay
                  </button>
                </div>
              </section>

              <section className="drawer-section">
                <div className="drawer-section-title">Room modes</div>
                <div className="mode-options drawer-modes">
                  {(Object.keys(roomModeLabels) as Array<keyof RoomMode>).map((key) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={selectedRoom.mode[key]}
                        disabled={!hasSelectedRoom || isSelectedRoomLocked || settingsBusy || !isActiveHost}
                        onChange={() => toggleRoomMode(key)}
                      />
                      <span>{roomModeLabels[key]}</span>
                    </label>
                  ))}
                </div>
                {!isActiveHost && hasSelectedRoom && (
                  <div className="workflow-message">{roomSettingsGateMessage}</div>
                )}
              </section>

              <section className="drawer-section">
                <div className="drawer-section-title">Encrypted history</div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={historySettings.enabled}
                    disabled={!hasSelectedRoom}
                    onChange={(event) =>
                      updateLocalHistorySettings({
                        ...historySettings,
                        enabled: event.target.checked
                      })
                    }
                  />
                  <span>Save local history</span>
                </label>
                <label className="history-retention">
                  <span>Retention days</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={historySettings.retentionDays}
                    disabled={!hasSelectedRoom || !historySettings.enabled}
                    onChange={(event) =>
                      updateLocalHistorySettings({
                        ...historySettings,
                        retentionDays: Number(event.target.value)
                      })
                    }
                  />
                </label>
	                <button className="ghost-wide" onClick={clearRoomHistory} disabled={!hasSelectedRoom}>
	                  <X size={15} />
	                  Clear local history
	                </button>
	                <button className="ghost-wide danger" onClick={forgetSelectedRoomLocalData} disabled={!hasSelectedRoom}>
	                  <KeyRound size={15} />
	                  Forget room on this device
	                </button>
	                <div className="drawer-section-title">Team default</div>
	                <label className="checkbox-row">
	                  <input
	                    type="checkbox"
	                    checked={teamHistorySettings.enabled}
	                    disabled={!selectedTeam}
	                    onChange={(event) =>
	                      updateTeamHistoryDefaults({
	                        ...teamHistorySettings,
	                        enabled: event.target.checked
	                      })
	                    }
	                  />
	                  <span>Save history in new team rooms</span>
	                </label>
	                <label className="history-retention">
	                  <span>Team retention days</span>
	                  <input
	                    type="number"
	                    min={1}
	                    max={365}
	                    value={teamHistorySettings.retentionDays}
	                    disabled={!selectedTeam || !teamHistorySettings.enabled}
	                    onChange={(event) =>
	                      updateTeamHistoryDefaults({
	                        ...teamHistorySettings,
	                        retentionDays: Number(event.target.value)
	                      })
	                    }
	                  />
	                </label>
	                <label className="history-retention">
	                  <span>New room approval</span>
	                  <select
	                    value={teamDefaultApprovalPolicy}
	                    disabled={!selectedTeam}
	                    onChange={(event) => updateTeamDefaultApprovalPolicy(event.target.value as ApprovalPolicy)}
	                  >
	                    {(Object.keys(approvalPolicyLabels) as ApprovalPolicy[]).map((policy) => (
	                      <option key={policy} value={policy}>{approvalPolicyLabels[policy]}</option>
	                    ))}
	                  </select>
	                </label>
	                <label className="history-retention">
	                  <span>New room model</span>
	                  <select
	                    value={codexModelOptions.some((option) => option.id === teamDefaultCodexModel) ? teamDefaultCodexModel : defaultCodexModel}
	                    disabled={!selectedTeam}
	                    onChange={(event) => updateTeamDefaultCodexModel(event.target.value)}
	                  >
	                    {codexModelOptions.map((option) => (
	                      <option key={option.id} value={option.id}>{option.label}</option>
	                    ))}
	                  </select>
	                </label>
	                <label className="checkbox-row">
	                  <input
	                    type="checkbox"
	                    checked={teamDefaultBrowserProfilePersistent}
	                    disabled={!selectedTeam}
	                    onChange={(event) => setTeamDefaultBrowserProfilePersistent(event.target.checked)}
	                  />
	                  <span>Persist browser profiles in new team rooms</span>
	                </label>
	                <div className="browser-allowlist">
	                  <label>
	                    <span>New room allowed browser sites</span>
	                    <textarea
	                      value={teamDefaultBrowserAllowedOriginsDraft}
	                      disabled={!selectedTeam}
	                      onChange={(event) => setTeamDefaultBrowserAllowedOriginsDraft(event.target.value)}
	                      placeholder="https://github.com"
	                    />
	                  </label>
	                  <button className="ghost-wide" onClick={saveTeamDefaultBrowserPolicy} disabled={!selectedTeam}>
	                    <Check size={15} />
	                    Save browser defaults
	                  </button>
	                </div>
	                <label className="checkbox-row">
	                  <input
	                    type="checkbox"
	                    checked={teamDefaultInviteApprovalGate}
	                    disabled={!selectedTeam}
	                    onChange={(event) => updateTeamDefaultInviteApprovalGate(event.target.checked)}
	                  />
	                  <span>Require host approval for new room invites</span>
	                </label>
	                <button className="ghost-wide" onClick={applyTeamDefaultsToRoom} disabled={!hasSelectedRoom || settingsBusy}>
	                  <Check size={15} />
	                  Apply team default to room
	                </button>
	              </section>

              {(appConfigMessage || settingsMessage || visibleHistoryMessage) && (
                <div className="workflow-message">{appConfigMessage ?? settingsMessage ?? visibleHistoryMessage}</div>
              )}
            </div>
          )}
        </aside>
      )}

      <main className="room">
        <RoomHeader
          teamName={selectedTeamName}
          roomName={selectedRoom.name}
          relayStatus={relayStatus}
          onlineCount={roomMembers.length || 1}
          hostStatus={selectedRoom.hostStatus}
          hostStatusLabel={hostStatusLabel}
          hostBusy={hostBusy}
          isActiveHost={isActiveHost}
          roomLocked={isSelectedRoomLocked}
          hasRoom={hasSelectedRoom}
          selectedModel={selectedCodexModel}
          modelLabel={formatCodexModel(selectedCodexModel)}
          modelOptions={codexModelOptions}
          settingsBusy={settingsBusy}
          browserEnabled={selectedRoom.mode.browser}
          projectLabel={selectedRoom.projectPath.split("/").slice(-1)[0]}
          selectedCount={selectedMessages.length}
          onSetHost={setRoomHost}
          onSelectModel={setCodexModel}
          onCopyRoomMarkdown={copyRoomMarkdown}
          onCopySelectedMarkdown={copySelectedMessagesMarkdown}
          onClearSelectedMessages={clearSelectedMessages}
        />

        {hostMessage && <div className="host-message">{hostMessage}</div>}
        {chatMessage && <div className="host-message">{chatMessage}</div>}

        {secretWarningVisible && (
          <div className="warning-banner">
            <ShieldAlert size={18} />
            <span>Everyone in this room can see Codex events, terminal output, diffs, and tool logs. Secrets may be exposed.</span>
            <button onClick={acknowledgeRoomVisibilityWarning} aria-label="Acknowledge room visibility warning">
              <Check size={16} />
              <span>I understand</span>
            </button>
          </div>
        )}

        {isSelectedRoomLocked && (
          <div className="warning-banner local-lock-banner">
            <Lock size={18} />
            <span>{roomLockMessage(selectedRoom, isSelectedRoomRevoked)}</span>
          </div>
        )}

        {markdownCopyFallback && (
          <section className="markdown-fallback">
            <div>
              <strong>{markdownCopyFallback.title} Markdown ready</strong>
              <span>Copying was blocked, so the generated Markdown is available here.</span>
            </div>
            <textarea readOnly value={markdownCopyFallback.markdown} aria-label={`${markdownCopyFallback.title} Markdown fallback`} />
            <div className="markdown-fallback-actions">
              <button
                onClick={() => copyMarkdownWithFallback(
                  markdownCopyFallback.title,
                  markdownCopyFallback.markdown,
                  (message) => setChatMessageForRoom(selectedRoom.id, message),
                  selectedRoom.id
                )}
              >
                <Copy size={14} /> Retry copy
              </button>
              <button onClick={() => setMarkdownCopyFallbackForRoom(selectedRoom.id, null)}>
                <X size={14} /> Dismiss
              </button>
            </div>
          </section>
        )}

        <div className="chat-scroll">
          {messages.map((message) => (
            <article className={`message ${message.role} ${selectedMessageIds.includes(message.id) ? "selected" : ""}`} key={message.id}>
              <div className="avatar">{message.role === "codex" ? <Bot size={17} /> : message.author.slice(0, 1)}</div>
              <div className="bubble">
                <div className="message-meta">
                  <label className="message-select" title="Select message for Markdown copy">
                    <input
                      type="checkbox"
                      checked={selectedMessageIds.includes(message.id)}
                      onChange={() => toggleMessageSelection(message.id)}
                      aria-label={`Select message from ${message.author} at ${message.time}`}
                    />
                  </label>
                  <strong>{message.author}</strong>
                  <span>{message.time}</span>
                  <button onClick={() => copyMessageMarkdown(message)} title="Copy message as Markdown">
                    <Copy size={13} />
                  </button>
                  {message.role === "codex" && (
                    <button onClick={() => copyCodexOutputMarkdown(message)} title="Copy Codex turn output as Markdown">
                      <Bot size={13} />
                    </button>
                  )}
                </div>
                <p>{message.body}</p>
		                {message.attachments?.map((attachment) => (
		                  <div className="attachment" key={attachment.id}>
		                    <FileCode2 size={15} />
		                    <span>{attachment.name}</span>
		                    <small>{formatAttachmentMeta(attachment)}</small>
		                    {(attachment.blobId || attachment.content) && (
		                      <button
		                        onClick={() => openEncryptedAttachmentBlob(attachment)}
		                        title={attachment.blobId ? "Decrypt and preview encrypted attachment" : "Preview inline attachment"}
		                        disabled={isSelectedRoomLocked}
		                      >
		                        <ExternalLink size={12} />
		                      </button>
		                    )}
		                  </div>
		                ))}
                <div className="reaction-row">
                  {["👍", "✅", "👀"].map((emoji) => {
                    const reaction = message.reactions?.find((item) => item.emoji === emoji);
                    const reacted = reaction?.reactors.some((reactor) => reactor.userId === localUser.id) ?? false;
                    return (
                      <button
                        className={reacted ? "active" : ""}
                        key={emoji}
                        onClick={() => toggleMessageReaction(message, emoji)}
                        title={reaction?.reactors.map((reactor) => reactor.name).join(", ") || "React"}
                        disabled={!canUseRoomChat(selectedRoom, isSelectedRoomLocked)}
                      >
                        <span>{emoji}</span>
                        {reaction?.reactors.length ? <small>{reaction.reactors.length}</small> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </article>
          ))}

          {approvalVisible && (
            <CodexApprovalCard
              summary={codexApprovalSummaryDisplay}
              isActiveHost={isActiveHost}
              codexRunning={codexRunning}
              canApprove={hasSelectedRoom && canApproveCodexTurn(selectedRoom, localUser, isSelectedRoomLocked)}
              onDeny={() => {
                setPendingCodexApprovalForRoom(selectedRoom.id, null);
                setApprovalVisibleForRoom(selectedRoom.id, false);
              }}
              onApprove={() => approveCodexTurn()}
            />
          )}
        </div>

        <footer className="composer">
	          <button title="Invoke Codex" onClick={() => handleCodexInvoke()} disabled={!canUseRoomChat(selectedRoom, isSelectedRoomLocked)}>
            <Bot size={18} />
          </button>
          <div className="composer-body">
            {pendingAttachments.length > 0 && (
              <div className="pending-attachments">
	                {pendingAttachments.map((attachment) => (
	                  <span key={attachment.id}>
	                    <FileCode2 size={13} />
	                    {attachment.name}{attachment.blobId ? " (encrypted blob)" : ""}
	                    <button onClick={() => removePendingAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <small>
                  {pendingAttachments.length}/{maxMessageAttachments} files · {formatBytes(pendingAttachmentBytes)}/{formatBytes(maxEmbeddedAttachmentBytesPerMessage)}
                </small>
              </div>
            )}
            <textarea
              placeholder={
                isSelectedRoomLocked
                  ? roomLockMessage(selectedRoom, isSelectedRoomRevoked)
                  : selectedRoom.mode.chat
                    ? "Message the room, or type @Codex to invoke the active host..."
                    : "Chat mode is disabled for this room"
              }
              value={draft}
              disabled={!canUseRoomChat(selectedRoom, isSelectedRoomLocked)}
              onChange={(event) => setDraftForRoom(selectedRoom.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />
          </div>
          <button className="send" onClick={sendMessage} disabled={!canUseRoomChat(selectedRoom, isSelectedRoomLocked)}>
            <Send size={18} />
          </button>
        </footer>
      </main>

      <aside className="inspector">
        <InspectorTabs
          activeTab={inspectorTab}
          workAttentionCount={inspectorAttention.work}
          browserAttentionCount={inspectorAttention.browser}
          onSelectTab={(tab) => setInspectorTabsByRoom((current) => ({ ...current, [selectedRoom.id]: tab }))}
        />

        <BrowserAccessPanel
          hidden={inspectorTab !== "browser"}
          browserEnabled={selectedRoom.mode.browser}
          browserStatus={browserStatus}
          browserProfilePersistent={selectedRoom.browserProfilePersistent}
          browserProfileDisabled={!hasSelectedRoom || isSelectedRoomLocked || !isActiveHost || settingsBusy}
          browserAllowedOriginsDraft={browserAllowedOriginsDraft}
          browserAllowedOriginsDisabled={!hasSelectedRoom || isSelectedRoomLocked || !isActiveHost || settingsBusy}
          browserUrl={browserUrl}
          browserReason={browserReason}
          canRequestBrowser={canRequestBrowser}
          canHostBrowser={canHostBrowser}
          browserRequests={browserRequests}
          browserMessage={browserMessage}
          formatBrowserAccessLabel={formatBrowserAccessLabel}
          detectBrowserSecretRisks={detectBrowserSecretRisks}
          onResetBrowserProfile={resetRoomBrowserProfile}
          onBrowserProfilePersistenceChange={setBrowserProfilePersistence}
          onBrowserAllowedOriginsDraftChange={(draft) => setBrowserAllowedOriginsDraftForRoom(selectedRoom.id, draft)}
          onSaveBrowserAllowedOrigins={saveBrowserAllowedOrigins}
          onBrowserUrlChange={(url) => setBrowserUrlForRoom(selectedRoom.id, url)}
          onBrowserReasonChange={(reason) => setBrowserReasonForRoom(selectedRoom.id, reason)}
          onRequestBrowserAccess={requestBrowserAccess}
          onApproveBrowserRequest={approveBrowserRequest}
          onDenyBrowserRequest={denyBrowserRequest}
          onOpenApprovedBrowserRequest={openApprovedBrowserRequest}
        />

        <div className="inspector-panel-group" hidden={inspectorTab !== "work"}>
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
          teamDefaultBrowserAllowedOriginsDraft={teamDefaultBrowserAllowedOriginsDraft}
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
          onTeamDefaultBrowserAllowedOriginsDraftChange={setTeamDefaultBrowserAllowedOriginsDraft}
          onSaveTeamDefaultBrowserPolicy={saveTeamDefaultBrowserPolicy}
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

        <section className="panel terminal-panel">
          <div className="panel-title">
            <span>Terminals</span>
            <div className="panel-title-actions">
              <button className="ghost" onClick={copyTerminalMarkdown} disabled={!canReadLocalWorkspace}>
                <Copy size={14} /> Markdown
              </button>
              <button className="ghost" onClick={runApprovedTerminalCheck} disabled={!canReadLocalWorkspace || terminalBusy || !isActiveHost}>
                <Play size={14} /> {terminalBusy ? "running" : "git status"}
              </button>
            </div>
          </div>
          <div className="terminal-launcher">
            <input
              value={terminalName}
              onChange={(event) => setTerminalNameForRoom(selectedRoom.id, event.target.value)}
              placeholder="name"
            />
            <input
              value={terminalCommand}
              onChange={(event) => setTerminalCommandForRoom(selectedRoom.id, event.target.value)}
              placeholder="command"
            />
            <button onClick={startNamedTerminal} disabled={!canReadLocalWorkspace || terminalBusy || !isActiveHost || !terminalName.trim() || !terminalCommand.trim()}>
              <Play size={14} />
            </button>
            <button onClick={requestTerminalCommand} disabled={!canRequestWorkspace || !terminalCommand.trim()}>
              <MessageSquare size={14} />
            </button>
            {terminalCommandRisks.length > 0 && (
              <InlineSecretWarning
                risks={terminalCommandRisks}
                detail="Review before requesting or running it on the host machine."
                compact
              />
            )}
          </div>
          <div className="terminal-requests">
            {codexEvents.slice(-5).reverse().map((event) => (
              <div className={`terminal-request ${event.status === "failed" ? "denied" : event.status === "completed" ? "approved" : "pending"}`} key={`${event.turnId}-${event.createdAt}-${event.status}`}>
                <div>
                  <strong>{formatCodexEventStatus(event.status)}</strong>
                  <span>{event.message}</span>
                  <small>{event.threadId ?? formatCodexModel(event.model)} · {formatTimestamp(event.createdAt)}</small>
                </div>
                <small>{event.host}</small>
              </div>
            ))}
            {codexEvents.length === 0 && (
              <div className="empty-state compact">No Codex events in this room.</div>
            )}
          </div>
          <div className="terminal-requests">
            {terminalRequests.map((request) => {
              const requestRisks = detectTerminalCommandRisks(request.command);

              return (
                <div className={`terminal-request ${request.status}`} key={request.id}>
                  <div>
                    <strong>{request.command}</strong>
                    <span>{request.requester} · {request.cwd}</span>
                  </div>
                  <small>{request.status}</small>
                  {request.status === "pending" && (
                    <div>
                      <button onClick={() => approveTerminalRequest(request)} disabled={!canReadLocalWorkspace || terminalBusy || !isActiveHost}>
                        <Check size={13} />
                      </button>
                      <button onClick={() => denyTerminalRequest(request.id)} disabled={!canReadLocalWorkspace || terminalBusy || !isActiveHost}>
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  {requestRisks.length > 0 && (
                    <div className="terminal-request-warning">
                      <InlineSecretWarning
                        risks={requestRisks}
                        detail="Review before approving this command on the host machine."
                        compact
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {terminalRequests.length === 0 && (
              <div className="empty-state compact">No command requests in this room.</div>
            )}
          </div>
          {roomTerminals.length > 0 && (
            <div className="terminal-tabs">
              {roomTerminals.map((terminal) => (
                <button
                  key={terminal.id}
                  className={terminal.id === selectedTerminalId ? "active" : ""}
                  onClick={() => setSelectedTerminalIdForRoom(selectedRoom.id, terminal.id)}
                >
                  <Terminal size={13} />
                  {terminal.name}
                  <span>{terminal.running ? "live" : terminal.exitStatus ?? "done"}</span>
                </button>
              ))}
            </div>
          )}
          <div className="terminal-output">
            {terminalRisks.length > 0 && <InlineSecretWarning risks={terminalRisks} compact />}
            {(selectedTerminal?.lines ?? terminalLines.map((line) => ({ stream: "system", text: line }))).map((line, index) => {
              const lineRisks = detectSecretRisks(line.text);
              return (
                <div className={`terminal-line ${line.stream} ${lineRisks.length ? "sensitive" : ""}`} key={`${line.stream}-${index}-${line.text}`}>
                  {line.stream !== "stdout" && <span>{line.stream}</span>}
                  {line.text}
                </div>
              );
            })}
            {codexRunning && <div className="terminal-active">Codex is preparing a foreground terminal...</div>}
          </div>
          {selectedTerminal && (
            <div className="terminal-input-row">
              <input
                value={terminalInput}
                onChange={(event) => setTerminalInputForRoom(selectedRoom.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    sendTerminalInput();
                  }
                }}
                placeholder={`Send input to ${selectedTerminal.name}`}
                disabled={!canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked) || !selectedTerminal.running}
              />
              <button onClick={sendTerminalInput} disabled={!canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked) || !selectedTerminal.running || !terminalInput.trim()}>
                <Send size={14} />
              </button>
              {selectedTerminalCanRestart && (
                <button
                  onClick={restartSelectedTerminal}
                  disabled={!canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked) || terminalBusy}
                  title={`Restart ${selectedTerminal.name}`}
                >
                  <Play size={14} />
                </button>
              )}
              <button onClick={stopSelectedTerminal} disabled={!canControlRoomTerminal(selectedRoom, localUser, selectedTerminal, isSelectedRoomLocked) || !selectedTerminal.running || terminalBusy}>
                <X size={14} />
              </button>
            </div>
          )}
          {terminalError && <div className="workflow-message">{terminalError}</div>}
        </section>
        </div>
      </aside>
    </div>
  );
}

function loadOrCreateDeviceId(): string {
  const key = "multaiplayer:device-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = `device_${crypto.randomUUID()}`;
  localStorage.setItem(key, created);
  return created;
}

function ensureRoomDefaults(room: RoomRecord): RoomRecord {
  return {
    ...room,
    codexModel: room.codexModel || defaultCodexModel,
    browserAllowedOrigins: normalizeBrowserAllowedOrigins(room.browserAllowedOrigins ?? defaultBrowserAllowedOrigins) ?? defaultBrowserAllowedOrigins,
    browserProfilePersistent: typeof room.browserProfilePersistent === "boolean"
      ? room.browserProfilePersistent
      : defaultBrowserProfilePersistent
  };
}

function formatCodexModel(model: string): string {
  return codexModelOptions.find((option) => option.id === model)?.label ?? model;
}

function formatTeamMeta(team: TeamRecord): string {
  const members = `${team.members} ${team.members === 1 ? "member" : "members"}`;
  return team.role ? `${formatTeamRole(team.role)} · ${members}` : members;
}

function formatTeamRole(role: NonNullable<TeamRecord["role"]>): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

function formatTeamMemberInitial(userId: string): string {
  return userId.replace(/^github:/, "").slice(0, 1).toUpperCase() || "?";
}

function formatTeamMemberName(userId: string, currentUser: SignedInUser | null): string {
  if (currentUser?.id === userId) return currentUser.name ?? currentUser.login;
  return userId.replace(/^github:/, "");
}

function formatTeamMemberJoinedAt(joinedAt: string): string {
  const timestamp = Date.parse(joinedAt);
  if (Number.isNaN(timestamp)) return "joined";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function canPromoteTeamMember(team: TeamRecord | null, member: TeamMemberRecord): boolean {
  return team?.role === "owner" && member.role === "member";
}

function canDemoteTeamMember(team: TeamRecord | null, member: TeamMemberRecord): boolean {
  return team?.role === "owner" && member.role === "admin";
}

function canRemoveTeamMember(team: TeamRecord | null, member: TeamMemberRecord): boolean {
  if (member.role === "owner") return false;
  if (team?.role === "owner") return true;
  return team?.role === "admin" && member.role === "member";
}

function canTransferTeamOwnership(
  team: TeamRecord | null,
  member: TeamMemberRecord,
  localUserId: string
): boolean {
  return team?.role === "owner" && member.role !== "owner" && member.userId !== localUserId;
}

function roomLockMessage(room: RoomRecord, revoked: boolean): string {
  if (revoked) return membershipRemovedRoomMessage(room.name);
  return "This room was forgotten on this device. Paste a room invite key or get approved through a gated invite to unlock encrypted messages again.";
}

function formatCodexThreadId(threadId: string | null): string {
  if (!threadId) return "New room thread";
  if (threadId.length <= 28) return threadId;
  return `${threadId.slice(0, 12)}...${threadId.slice(-8)}`;
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const rest = { ...record };
  delete rest[key];
  return rest;
}

function summarizeActionRuns(runs: GitHubActionRun[]): {
  label: string;
  detail: string;
  tone: "green" | "yellow" | "red" | "dark" | "muted";
} {
  if (runs.length === 0) {
    return {
      label: "Unknown",
      detail: "No workflow runs loaded for this branch.",
      tone: "muted"
    };
  }

  const failed = runs.filter((run) =>
    ["failure", "timed_out", "cancelled", "action_required"].includes(run.conclusion ?? "")
  );
  if (failed.length > 0) {
    return {
      label: "Failing",
      detail: `${failed.length} workflow run${failed.length === 1 ? "" : "s"} need attention.`,
      tone: "red"
    };
  }

  const running = runs.filter((run) =>
    ["queued", "in_progress", "requested", "waiting", "pending"].includes(run.status)
  );
  if (running.length > 0) {
    return {
      label: "Running",
      detail: `${running.length} workflow run${running.length === 1 ? "" : "s"} still in progress.`,
      tone: "yellow"
    };
  }

  if (runs.every((run) => run.conclusion === "success")) {
    return {
      label: "Passing",
      detail: "Latest loaded workflow runs are passing.",
      tone: "green"
    };
  }

  return {
    label: "Review",
    detail: "Workflow runs loaded with mixed or neutral conclusions.",
    tone: "yellow"
  };
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "unknown time";
  return timestamp.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatMessageTime(value = new Date().toISOString()): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "now";
  return timestamp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function buildTerminalResultLines(result: TerminalResultPlaintextPayload): string[] {
  const output = [result.stdout.trim(), result.stderr.trim(), result.error?.trim()]
    .filter(Boolean)
    .join("\n");
  return [
    `${result.ranBy} ran approved terminal request: ${result.command}`,
    output || `Command exited with ${result.exitStatus ?? "unknown"} and no output.`
  ];
}

function buildGitWorkflowEventLines(event: GitWorkflowEventPlaintextPayload): string[] {
  const header = `${event.runner} ${formatGitWorkflowStatus(event.status)}: ${event.message}`;
  const commandLines = (event.results ?? [])
    .flatMap((result) => [
      `$ ${result.command}`,
      result.stdout.trim(),
      result.stderr.trim()
    ])
    .filter(Boolean);
  return [header, ...commandLines];
}

function buildGitHubActionsEventLines(event: GitHubActionsEventPlaintextPayload): string[] {
  const runSummary = event.runs
    .slice(0, 4)
    .map((run) => {
      const status = run.conclusion ? `${run.status}/${run.conclusion}` : run.status;
      return `- ${run.displayTitle ?? run.name}: ${status}`;
    });
  return [
    `${event.checkedBy} refreshed GitHub Actions for ${event.owner}/${event.repo}@${event.branch}: ${event.summary.label}`,
    event.summary.detail,
    ...runSummary
  ];
}

function buildCodexEventLine(event: CodexEventPlaintextPayload): string {
  const thread = event.threadId ? ` · ${event.threadId}` : "";
  return `Codex ${formatCodexEventStatus(event.status)} by ${event.host}${thread}: ${event.message}`;
}

function formatCodexEventStatus(status: CodexEventPlaintextPayload["status"]): string {
  switch (status) {
    case "started":
      return "started";
    case "event":
      return "event";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

function formatGitWorkflowStatus(status: GitWorkflowEventPlaintextPayload["status"]): string {
  switch (status) {
    case "started":
      return "started Git workflow";
    case "completed":
      return "completed Git workflow";
    case "failed":
      return "reported Git workflow failure";
    case "pr_opened":
      return "opened a draft PR";
  }
}

function roomSecretStorageLabel(): string {
  return "__TAURI_INTERNALS__" in window ? "macOS Keychain" : "web preview localStorage";
}

function pruneLocalRoomHistory(payload: LocalRoomHistoryPayload, retentionDays: number): LocalRoomHistoryPayload {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return {
    version: 3,
    messages: payload.messages.filter((message) => isWithinRetention(message.createdAt ?? message.time, cutoffMs)),
    terminalRequests: payload.terminalRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    browserRequests: payload.browserRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    inviteRequests: payload.inviteRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    codexEvents: payload.codexEvents.filter((event) => isWithinRetention(event.createdAt, cutoffMs)),
    gitWorkflowEvents: payload.gitWorkflowEvents.filter((event) => isWithinRetention(event.createdAt, cutoffMs)),
    githubActionsEvents: payload.githubActionsEvents.filter((event) => isWithinRetention(event.checkedAt, cutoffMs)),
    terminalSnapshots: terminalsForLocalHistory(
      payload.terminalSnapshots.filter((terminal) => isWithinRetention(terminal.startedAt, cutoffMs))
    ),
    hostHandoffs: payload.hostHandoffs.filter((handoff) => isWithinRetention(handoff.createdAt, cutoffMs)),
    ...(payload.codexThreadId ? { codexThreadId: payload.codexThreadId } : {})
  };
}

function isWithinRetention(value: string | undefined, cutoffMs: number): boolean {
  if (!value) return true;
  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) return true;
  return timestampMs >= cutoffMs;
}

function normalizeLocalRoomHistory(value: ChatMessage[] | LocalRoomHistoryPayload): LocalRoomHistoryPayload {
  if (Array.isArray(value)) {
    return {
      version: 3,
      messages: value.map((message) => normalizeChatMessage(message) as ChatMessage | null).filter((message): message is ChatMessage => message !== null),
      terminalRequests: [],
      browserRequests: [],
      inviteRequests: [],
      codexEvents: [],
      gitWorkflowEvents: [],
      githubActionsEvents: [],
      terminalSnapshots: [],
      hostHandoffs: []
    };
  }

  const codexThreadId = normalizeCodexThreadId(value.codexThreadId);
  return {
    version: 3,
    messages: Array.isArray(value.messages)
      ? value.messages.map((message) => normalizeChatMessage(message) as ChatMessage | null).filter((message): message is ChatMessage => message !== null)
      : [],
    terminalRequests: Array.isArray(value.terminalRequests)
      ? value.terminalRequests.filter(isTerminalCommandRequest)
      : [],
    browserRequests: Array.isArray(value.browserRequests)
      ? value.browserRequests.filter(isBrowserAccessRequest)
      : [],
    inviteRequests: Array.isArray(value.inviteRequests)
      ? value.inviteRequests.filter(isInviteJoinRequest)
      : [],
    codexEvents: Array.isArray(value.codexEvents)
      ? value.codexEvents.filter(isCodexEventPlaintextPayload)
      : [],
    gitWorkflowEvents: Array.isArray(value.gitWorkflowEvents)
      ? value.gitWorkflowEvents.filter(isGitWorkflowEventPlaintextPayload)
      : [],
    githubActionsEvents: Array.isArray(value.githubActionsEvents)
      ? value.githubActionsEvents.filter(isGitHubActionsEventPlaintextPayload)
      : [],
    terminalSnapshots: Array.isArray(value.terminalSnapshots)
      ? terminalsForLocalHistory(value.terminalSnapshots.filter(isTerminalSnapshot))
      : [],
    hostHandoffs: Array.isArray(value.hostHandoffs)
      ? value.hostHandoffs.filter(isHostHandoffRecord)
      : [],
    ...(codexThreadId ? { codexThreadId } : {})
  };
}

function isChatMessage(value: unknown): value is ChatMessage {
  const normalized = normalizeChatMessage(value);
  return Boolean(
    normalized &&
    (normalized.reactions === undefined || (Array.isArray(normalized.reactions) && normalized.reactions.every(isChatReaction)))
  );
}

function isChatReaction(value: unknown): value is ChatReaction {
  if (!isRecord(value)) return false;
  return (
    typeof value.emoji === "string" &&
    Array.isArray(value.reactors) &&
    value.reactors.every((reactor) =>
      isRecord(reactor) &&
      typeof reactor.userId === "string" &&
      typeof reactor.name === "string"
    )
  );
}

function isChatReactionPlaintextPayload(value: unknown): value is ChatReactionPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.messageId === "string" &&
    typeof value.emoji === "string" &&
    (value.action === "add" || value.action === "remove") &&
    typeof value.reactor === "string" &&
    typeof value.reactorUserId === "string" &&
    typeof value.createdAt === "string"
  );
}

function isAttachmentBlobContent(value: unknown): value is {
  name: string;
  type: string;
  size: number;
  content: string;
  truncated?: boolean;
} {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    typeof value.content === "string" &&
    (value.truncated === undefined || typeof value.truncated === "boolean")
  );
}

function isTerminalCommandRequest(value: unknown): value is TerminalCommandRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.requester === "string" &&
    typeof value.requesterUserId === "string" &&
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    typeof value.requestedAt === "string" &&
    isWorkflowStatus(value.status)
  );
}

function isTerminalSnapshot(value: unknown): value is TerminalSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.roomId === "string" &&
    typeof value.name === "string" &&
    typeof value.cwd === "string" &&
    typeof value.command === "string" &&
    typeof value.running === "boolean" &&
    (typeof value.exitStatus === "number" || value.exitStatus === null) &&
    typeof value.startedAt === "string" &&
    Array.isArray(value.lines) &&
    value.lines.every(isTerminalLine)
  );
}

function isTerminalLine(value: unknown): value is { stream: string; text: string } {
  return isRecord(value) && typeof value.stream === "string" && typeof value.text === "string";
}

function isRequestStatusPlaintextPayload(value: unknown): value is RequestStatusPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.requestId === "string" &&
    (value.status === "approved" || value.status === "denied") &&
    typeof value.decidedBy === "string" &&
    typeof value.decidedByUserId === "string" &&
    typeof value.decidedAt === "string"
  );
}

function isInviteJoinRequestPlaintextPayload(value: unknown): value is InviteJoinRequestPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "invite.request" &&
    typeof value.id === "string" &&
    (value.inviteId === undefined || typeof value.inviteId === "string") &&
    typeof value.requester === "string" &&
    typeof value.requesterUserId === "string" &&
    typeof value.requesterDeviceId === "string" &&
    (value.requesterPublicKeyJwk === undefined || isRecord(value.requesterPublicKeyJwk)) &&
    (value.requesterPublicKeyFingerprint === undefined || typeof value.requesterPublicKeyFingerprint === "string") &&
    typeof value.requestedAt === "string" &&
    (value.note === undefined || typeof value.note === "string")
  );
}

function isInviteJoinStatusPlaintextPayload(value: unknown): value is InviteJoinStatusPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "invite.status" &&
    typeof value.requestId === "string" &&
    (value.status === "approved" || value.status === "denied") &&
    typeof value.decidedBy === "string" &&
    typeof value.decidedByUserId === "string" &&
    typeof value.decidedAt === "string" &&
    (value.recipientDeviceId === undefined || typeof value.recipientDeviceId === "string") &&
    (value.recipientPublicKeyFingerprint === undefined || typeof value.recipientPublicKeyFingerprint === "string") &&
    (value.wrappedRoomSecret === undefined || isWrappedRoomSecretPayload(value.wrappedRoomSecret))
  );
}

function isWrappedRoomSecretPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    value.algorithm === "ECDH-P256-HKDF-SHA256-AES-GCM-256" &&
    isRecord(value.ephemeralPublicKeyJwk) &&
    typeof value.nonce === "string" &&
    typeof value.ciphertext === "string"
  );
}

function isDeviceSealedPayload(value: unknown): value is {
  algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256";
  ephemeralPublicKeyJwk: Record<string, unknown>;
  nonce: string;
  ciphertext: string;
} {
  if (!isRecord(value)) return false;
  return (
    value.algorithm === "ECDH-P256-HKDF-SHA256-AES-GCM-256" &&
    isRecord(value.ephemeralPublicKeyJwk) &&
    typeof value.nonce === "string" &&
    typeof value.ciphertext === "string"
  );
}

function isRoomKeyRotationPlaintextPayload(value: unknown): value is RoomKeyRotationPlaintextPayload {
  return RoomKeyRotationPlaintextPayloadSchema.safeParse(value).success;
}

function isCodexEventPlaintextPayload(value: unknown): value is CodexEventPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "codex.turn" &&
    typeof value.turnId === "string" &&
    (value.status === "started" || value.status === "event" || value.status === "completed" || value.status === "failed") &&
    typeof value.message === "string" &&
    typeof value.model === "string" &&
    (value.threadId === undefined || typeof value.threadId === "string") &&
    (value.eventName === undefined || typeof value.eventName === "string") &&
    typeof value.host === "string" &&
    typeof value.hostUserId === "string" &&
    typeof value.createdAt === "string"
  );
}

function isInviteJoinRequest(value: unknown): value is InviteJoinRequest {
  if (!isRecord(value)) return false;
  const status = value.status;
  return isInviteJoinRequestPlaintextPayload(value) && isWorkflowStatus(status);
}

function isTerminalResultPlaintextPayload(value: unknown): value is TerminalResultPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "terminal.result" &&
    typeof value.requestId === "string" &&
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    (typeof value.exitStatus === "number" || value.exitStatus === null) &&
    typeof value.stdout === "string" &&
    typeof value.stderr === "string" &&
    (value.error === undefined || typeof value.error === "string") &&
    typeof value.ranBy === "string" &&
    typeof value.ranByUserId === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.finishedAt === "string"
  );
}

function isGitWorkflowEventPlaintextPayload(value: unknown): value is GitWorkflowEventPlaintextPayload {
  if (!isRecord(value)) return false;
  const results = value.results;
  const pullRequest = value.pullRequest;
  return (
    value.eventType === "git.workflow" &&
    (value.status === "started" || value.status === "completed" || value.status === "failed" || value.status === "pr_opened") &&
    typeof value.branch === "string" &&
    typeof value.push === "boolean" &&
    typeof value.message === "string" &&
    typeof value.runner === "string" &&
    typeof value.runnerUserId === "string" &&
    typeof value.createdAt === "string" &&
    (results === undefined || (Array.isArray(results) && results.every(isGitWorkflowResult))) &&
    (pullRequest === undefined ||
      (isRecord(pullRequest) &&
        typeof pullRequest.number === "number" &&
        typeof pullRequest.url === "string"))
  );
}

function isGitHubActionsEventPlaintextPayload(value: unknown): value is GitHubActionsEventPlaintextPayload {
  if (!isRecord(value)) return false;
  const summary = value.summary;
  return (
    value.eventType === "github.actions" &&
    typeof value.owner === "string" &&
    typeof value.repo === "string" &&
    typeof value.branch === "string" &&
    isRecord(summary) &&
    typeof summary.label === "string" &&
    typeof summary.detail === "string" &&
    isStatusTone(summary.tone) &&
    typeof value.message === "string" &&
    typeof value.checkedBy === "string" &&
    typeof value.checkedByUserId === "string" &&
    typeof value.checkedAt === "string" &&
    Array.isArray(value.runs) &&
    value.runs.every(isGitHubActionRun)
  );
}

function isRoomSettingsPlaintextPayload(value: unknown): value is RoomSettingsPlaintextPayload {
  if (!isRecord(value)) return false;
  return (
    value.eventType === "room.settings" &&
    typeof value.id === "string" &&
    isRoomSettingsName(value.setting) &&
    typeof value.previousValue === "string" &&
    typeof value.nextValue === "string" &&
    typeof value.changedBy === "string" &&
    typeof value.changedByUserId === "string" &&
    typeof value.changedAt === "string"
  );
}

function isRoomSettingsName(value: unknown): value is RoomSettingsPlaintextPayload["setting"] {
  return (
    value === "approvalPolicy" ||
    value === "roomMode" ||
    value === "codexModel" ||
    value === "projectPath" ||
    value === "browserAllowedOrigins" ||
    value === "browserProfilePersistent"
  );
}

function isGitWorkflowResult(value: unknown): value is GitWorkflowResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    (typeof value.status === "number" || value.status === null) &&
    typeof value.stdout === "string" &&
    typeof value.stderr === "string"
  );
}

function isGitHubActionRun(value: unknown): value is GitHubActionRun {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.name === "string" &&
    (value.displayTitle === undefined || typeof value.displayTitle === "string") &&
    (value.runNumber === undefined || typeof value.runNumber === "number") &&
    (value.workflowId === undefined || typeof value.workflowId === "number") &&
    typeof value.status === "string" &&
    (typeof value.conclusion === "string" || value.conclusion === null) &&
    (value.branch === undefined || typeof value.branch === "string") &&
    (value.headSha === undefined || typeof value.headSha === "string") &&
    (value.event === undefined || typeof value.event === "string") &&
    typeof value.url === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isStatusTone(value: unknown): value is "green" | "yellow" | "red" | "dark" | "muted" {
  return value === "green" || value === "yellow" || value === "red" || value === "dark" || value === "muted";
}

function isBrowserAccessRequest(value: unknown): value is BrowserAccessRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.requester === "string" &&
    typeof value.requesterUserId === "string" &&
    typeof value.url === "string" &&
    typeof value.reason === "string" &&
    typeof value.requestedAt === "string" &&
    isWorkflowStatus(value.status)
  );
}

function isHostHandoffRecord(value: unknown): value is HostHandoffRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.fromHost === "string" &&
    typeof value.fromUserId === "string" &&
    typeof value.projectPath === "string" &&
    typeof value.codexModel === "string" &&
    typeof value.approvalPolicy === "string" &&
    typeof value.messagesSinceLastCodex === "number" &&
    Array.isArray(value.attachmentNames) &&
    Array.isArray(value.terminals) &&
    typeof value.createdAt === "string" &&
    (value.status === "available" || value.status === "accepted")
  );
}

function isWorkflowStatus(value: unknown): value is "pending" | "approved" | "denied" {
  return value === "pending" || value === "approved" || value === "denied";
}

function buildRoomSettingsSystemMessage(event: RoomSettingsPlaintextPayload): ChatMessage {
  return {
    id: event.id,
    author: "multAIplayer",
    role: "system",
    body: buildRoomSettingsMessageBody(event),
    time: formatMessageTime(event.changedAt),
    createdAt: event.changedAt
  };
}

function buildRoomSettingsMessageBody(event: RoomSettingsPlaintextPayload): string {
  switch (event.setting) {
    case "approvalPolicy":
      return `${event.changedBy} changed the approval policy from ${formatApprovalPolicy(event.previousValue)} to ${formatApprovalPolicy(event.nextValue)}.`;
    case "roomMode":
      return `${event.changedBy} ${formatRoomModeChange(event.nextValue)}.`;
    case "codexModel":
      return `${event.changedBy} changed the Codex model from ${formatCodexModel(event.previousValue)} to ${formatCodexModel(event.nextValue)}.`;
    case "projectPath":
      return `${event.changedBy} changed the project folder from ${event.previousValue} to ${event.nextValue}.`;
    case "browserAllowedOrigins":
      return `${event.changedBy} changed allowed browser sites from ${formatOriginList(event.previousValue)} to ${formatOriginList(event.nextValue)}.`;
    case "browserProfilePersistent":
      return `${event.changedBy} changed browser profile mode from ${formatBrowserProfilePersistence(event.previousValue)} to ${formatBrowserProfilePersistence(event.nextValue)}.`;
  }
}

function formatApprovalPolicy(value: string): string {
  return approvalPolicyLabels[value as ApprovalPolicy] ?? value;
}

function formatRoomModeChange(value: string): string {
  const [mode, state] = value.split(":");
  const label = roomModeLabels[mode as keyof RoomMode] ?? mode;
  return `${state === "enabled" ? "enabled" : "disabled"} ${label} mode`;
}

function formatOriginList(value: string): string {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length) return "no sites";
  return origins.map(formatBrowserAccessLabel).join(", ");
}

function formatBrowserProfilePersistence(value: string): string {
  return value === "true" ? "persistent profile" : "refresh before each approved open";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function jsonWebKeyToRecord(key: JsonWebKey): Record<string, unknown> {
  return JSON.parse(JSON.stringify(key)) as Record<string, unknown>;
}

function encodeNoSecretRoomInvite(invite: NoSecretRoomInvite): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(invite)));
}

function decodeNoSecretRoomInvite(value: string): NoSecretRoomInvite {
  const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Partial<NoSecretRoomInvite>;
  if (
    decoded.version !== 1 ||
    typeof decoded.teamId !== "string" ||
    typeof decoded.roomId !== "string" ||
    typeof decoded.roomName !== "string" ||
    typeof decoded.hostDeviceId !== "string" ||
    !isRecord(decoded.hostPublicKeyJwk) ||
    typeof decoded.hostPublicKeyFingerprint !== "string"
  ) {
    throw new Error("No-secret invite is missing required metadata");
  }
  return {
    version: decoded.version,
    teamId: decoded.teamId,
    roomId: decoded.roomId,
    roomName: decoded.roomName,
    hostDeviceId: decoded.hostDeviceId,
    hostPublicKeyJwk: decoded.hostPublicKeyJwk,
    hostPublicKeyFingerprint: decoded.hostPublicKeyFingerprint
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function formatBrowserAccessLabel(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function formatSessionPersistence(value: GitHubAuthConfig["sessionPersistence"] | undefined): string {
  if (value === "encrypted") return "Encrypted at rest";
  if (value === "memory_only") return "Memory-only";
  return "Unavailable";
}

function attachmentTypeFromName(name: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (!extension) return "file";
  if (["png", "jpg", "jpeg", "gif", "webp", "sketch"].includes(extension)) return "image";
  if (["ts", "tsx", "js", "jsx", "rs", "py", "go", "md", "json"].includes(extension)) return "code";
  return "file";
}

function formatHostStatus(room: RoomRecord): string {
  if (room.hostStatus === "active") return `Hosted by ${room.host}`;
  if (room.hostStatus === "handoff") return `Handoff from ${room.host}`;
  return "No active host";
}

function formatCodexGitSummary(git: CodexTurnSummary["git"]): string {
  if (!git) return "Disabled or unavailable";
  if (git.totalFiles === 0) return `${git.branch}, clean`;
  const suffix = git.truncated ? `, showing ${git.files.length}` : "";
  return `${git.branch}, ${git.totalFiles} changed${suffix}`;
}

function formatCodexAttachmentSummary(attachments: CodexTurnSummary["attachments"]): string {
  if (attachments.length === 0) return "None";
  return attachments.map((attachment) => {
    if (attachment.contentIncluded) return `${attachment.name} (inline)`;
    if (attachment.storage === "encrypted_blob") return `${attachment.name} (encrypted blob reference only)`;
    return `${attachment.name} (metadata only)`;
  }).join(", ");
}

function formatMemberDeviceLabel(member: RoomPresence, localDeviceId: string, trusted = false): string {
  const localLabel = member.deviceId === localDeviceId ? "This device" : "Online";
  const fingerprint = member.publicKeyFingerprint ? shortFingerprint(member.publicKeyFingerprint) : "unregistered device key";
  return `${localLabel} · ${fingerprint}${trusted ? " · locally trusted" : ""}`;
}

function shortFingerprint(fingerprint: string): string {
  if (fingerprint.length <= 18) return fingerprint;
  return `${fingerprint.slice(0, 10)}...${fingerprint.slice(-6)}`;
}

function isRoomHostMember(member: RoomPresence, room: RoomRecord): boolean {
  if (room.hostStatus !== "active") return false;
  if (room.hostUserId) return member.userId === room.hostUserId;
  return member.displayName === room.host;
}

function upsertTerminal(current: TerminalSnapshot[], snapshot: TerminalSnapshot): TerminalSnapshot[] {
  const next = current.some((terminal) => terminal.id === snapshot.id)
    ? current.map((terminal) => (terminal.id === snapshot.id ? snapshot : terminal))
    : [...current, snapshot];
  return next.sort((left, right) => left.name.localeCompare(right.name));
}

function mergeTerminalSnapshots(remembered: TerminalSnapshot[], live: TerminalSnapshot[]): TerminalSnapshot[] {
  const liveIds = new Set(live.map((terminal) => terminal.id));
  return [
    ...remembered
      .filter((terminal) => !liveIds.has(terminal.id))
      .map(terminalForLocalHistory),
    ...live
  ].sort((left, right) => left.name.localeCompare(right.name));
}

function terminalsForLocalHistory(terminals: TerminalSnapshot[]): TerminalSnapshot[] {
  return terminals
    .map(terminalForLocalHistory)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function terminalForLocalHistory(terminal: TerminalSnapshot): TerminalSnapshot {
  return {
    ...terminal,
    running: false,
    lines: terminal.lines.slice(-1000)
  };
}

function withoutSetValue<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  next.delete(value);
  return next;
}

function validatePendingAttachments(attachments: ChatAttachment[]): string | null {
  if (attachments.length > maxMessageAttachments) {
    return `Attach up to ${maxMessageAttachments} files per message in the alpha.`;
  }
  const oversized = attachments.find((attachment) =>
    attachment.content ? encodedBytes(attachment.content) > maxEmbeddedAttachmentBytes : false
  );
  if (oversized) {
    return `${oversized.name} is too large to embed. Limit: ${formatBytes(maxEmbeddedAttachmentBytes)} per file.`;
  }
  const totalBytes = embeddedAttachmentBytes(attachments);
  if (totalBytes > maxEmbeddedAttachmentBytesPerMessage) {
    return `Attachment previews are ${formatBytes(totalBytes)}. Limit: ${formatBytes(maxEmbeddedAttachmentBytesPerMessage)} per message.`;
  }
  return null;
}

function embeddedAttachmentBytes(attachments: ChatAttachment[]): number {
  return attachments.reduce((total, attachment) => total + encodedBytes(attachment.content ?? ""), 0);
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function formatAttachmentMeta(attachment: ChatAttachment): string {
  const blobNote = attachment.blobId ? `, encrypted blob${attachment.blobBytes ? ` preview ${formatBytes(attachment.blobBytes)}` : ""}` : "";
  return `${attachment.type}, ${formatBytes(attachment.size)}${blobNote}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
