import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  Circle,
  Code2,
  Copy,
  FileCode2,
  FolderGit2,
  GitBranch,
  Github,
  Globe2,
  KeyRound,
  Lock,
  MessageSquare,
  ExternalLink,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Wifi,
  WifiOff,
  Terminal,
  UserRoundCheck,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  RoomRecord,
  RoomMode,
  TeamRecord,
  TerminalResultPlaintextPayload,
  TerminalRequestPlaintextPayload,
  ApprovalPolicy
} from "@multaiplayer/protocol";
import {
  codexModelOptions,
  defaultBrowserAllowedOrigins,
  defaultCodexModel,
  defaultRoomMode,
  maxEmbeddedAttachmentBytes,
  maxEmbeddedAttachmentBytesPerMessage,
  maxMessageAttachments
} from "@multaiplayer/protocol";
import {
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
  type LocalHistorySettings,
  saveEncryptedHistory
} from "./lib/localHistory";
import { loadOrCreateDeviceIdentity, resetDeviceIdentity, type DeviceIdentity } from "./lib/deviceIdentity";
import {
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
  loadWorkspace,
  lookupInvite,
  registerDevice,
  updateRoomHost,
  updateRoomSettings
} from "./lib/workspaceClient";
import { defaultRelayHttpUrl, defaultRelayWsUrl, loadAppConfig, resetAppConfig, saveAppConfig, type AppConfig } from "./lib/appConfig";
import { shouldAutoApproveChatOnlyTurn } from "./lib/codexApproval";
import { buildCodexTurnInput, buildCodexTurnSummary, messagesSinceLastCodex } from "./lib/codexTurn";
import { normalizeCodexThreadId } from "./lib/codexThread";
import {
  buildCodexOutputMarkdown,
  buildDiffSummaryMarkdown,
  buildMessageMarkdown,
  buildProjectMarkdown,
  buildPullRequestBody,
  buildRoomMarkdown,
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
import { createHandoffSettingsPatch } from "./lib/hostHandoff";
import { detectBrowserSecretRisks, detectSecretRisks, detectTerminalCommandRisks } from "./lib/secretRisks";
import { createGitWorkflowApprovalPlan, formatGitWorkflowApprovalPreview } from "@multaiplayer/git";
import { normalizeGitHubBranchName } from "@multaiplayer/github";
import { terminalRequestForApprovedRun } from "./lib/terminalApproval";
import { readInviteUrlPayload } from "./lib/inviteUrl";
import { displayableInviteLink } from "./lib/invitePrivacy";
import { normalizeBrowserAllowedOrigins, shouldAutoApproveBrowserRequest } from "./lib/browserPolicy";
import { attachmentReviewMessage, decideAttachmentReview } from "./lib/attachmentPolicy";
import { isLocalUserActiveHostForRoom } from "./lib/roomHost";
import { normalizeChatMessage } from "./lib/chatSanitizer";
import { copyTextToClipboard } from "./lib/clipboard";
import { checkGitHubWorkflowReadiness } from "./lib/githubWorkflowReadiness";
import {
  acknowledgeRoomVisibilityWarning as saveRoomVisibilityWarningAcknowledgement,
  clearRoomVisibilityWarningAcknowledgement,
  hasAcknowledgedRoomVisibilityWarning
} from "./lib/roomVisibilityWarning";

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
  version: 2;
  messages: ChatMessage[];
  terminalRequests: TerminalCommandRequest[];
  browserRequests: BrowserAccessRequest[];
  inviteRequests: InviteJoinRequest[];
  codexEvents: CodexRoomEvent[];
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
  { id: "team-core", name: "Core Team", members: 4 },
  { id: "team-labs", name: "Labs", members: 2 }
];

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

export function App() {
  const [teams, setTeams] = useState<TeamRecord[]>(seededTeams);
  const [rooms, setRooms] = useState<RoomRecord[]>(seededRooms);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<SidebarPanel>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>(() => loadAppConfig());
  const [relayHttpDraft, setRelayHttpDraft] = useState(() => loadAppConfig().relayHttpUrl);
  const [relayWsDraft, setRelayWsDraft] = useState(() => loadAppConfig().relayWsUrl);
  const [appConfigMessage, setAppConfigMessage] = useState<string | null>(null);
  const [hostBusy, setHostBusy] = useState(false);
  const [hostMessage, setHostMessage] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [customCodexModel, setCustomCodexModel] = useState(defaultCodexModel);
  const [projectPathDraft, setProjectPathDraft] = useState(defaultProjectPath);
  const [historySettings, setHistorySettings] = useState<LocalHistorySettings>({
    enabled: true,
    retentionDays: 30
  });
  const [teamHistorySettings, setTeamHistorySettings] = useState<LocalHistorySettings>({
    enabled: true,
    retentionDays: 30
  });
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomProjectPath, setNewRoomProjectPath] = useState(defaultProjectPath);
  const [selectedTeam, setSelectedTeam] = useState(seededTeams[0].id);
  const [selectedRoomId, setSelectedRoomId] = useState("room-desktop");
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, ChatMessage[]>>(initialMessagesByRoom);
  const [forgottenRoomIds, setForgottenRoomIds] = useState<Set<string>>(() => new Set());
  const [presenceByRoom, setPresenceByRoom] = useState<Record<string, Record<string, RoomPresence>>>({});
  const [hostHandoffsByRoom, setHostHandoffsByRoom] = useState<Record<string, HostHandoffRecord[]>>({});
  const [inviteRequestsByRoom, setInviteRequestsByRoom] = useState<Record<string, InviteJoinRequest[]>>({});
  const [codexEventsByRoom, setCodexEventsByRoom] = useState<Record<string, CodexRoomEvent[]>>({});
  const [draftsByRoom, setDraftsByRoom] = useState<Record<string, string>>({});
  const [pendingAttachmentsByRoom, setPendingAttachmentsByRoom] = useState<Record<string, ChatAttachment[]>>({});
  const [approvalVisible, setApprovalVisible] = useState(true);
  const [codexRunning, setCodexRunning] = useState(false);
  const [secretWarningVisible, setSecretWarningVisible] = useState(true);
  const [gitStatusByRoom, setGitStatusByRoom] = useState<Record<string, GitStatusSummary | null>>({});
  const [codexProbe, setCodexProbe] = useState<CodexProbe | null>(null);
  const [terminalLinesByRoom, setTerminalLinesByRoom] = useState<Record<string, string[]>>(initialTerminalLinesByRoom);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminals, setTerminals] = useState<TerminalSnapshot[]>([]);
  const [terminalRequestsByRoom, setTerminalRequestsByRoom] = useState<Record<string, TerminalCommandRequest[]>>({});
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [terminalName, setTerminalName] = useState("dev-server");
  const [terminalCommand, setTerminalCommand] = useState("npm run dev:desktop");
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [browserRequestsByRoom, setBrowserRequestsByRoom] = useState<Record<string, BrowserAccessRequest[]>>({});
  const [browserUrl, setBrowserUrl] = useState("https://github.com/maddiedreese/multAIplayer");
  const [browserReason, setBrowserReason] = useState("Use this page as Codex browser context.");
  const [browserMessage, setBrowserMessage] = useState<string | null>(null);
  const [browserStatusByRoom, setBrowserStatusByRoom] = useState<Record<string, BrowserStatus>>({});
  const [browserAllowedOriginsDraft, setBrowserAllowedOriginsDraft] = useState(defaultBrowserAllowedOrigins.join("\n"));
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("closed");
  const [authConfig, setAuthConfig] = useState<GitHubAuthConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<SignedInUser | null>(null);
  const [deviceFlow, setDeviceFlow] = useState<GitHubDeviceStart | null>(null);
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceIdentityMessage, setDeviceIdentityMessage] = useState<string | null>(null);
  const [trustedDeviceKeys, setTrustedDeviceKeys] = useState<TrustedDeviceKey[]>(() => loadTrustedDeviceKeys());
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [gitWorkflowBusy, setGitWorkflowBusy] = useState(false);
  const [gitWorkflowMessage, setGitWorkflowMessage] = useState<string | null>(null);
  const [actionsBusy, setActionsBusy] = useState(false);
  const [actionsMessagesByRoom, setActionsMessagesByRoom] = useState<Record<string, string | null>>({});
  const [actionRunsByRoom, setActionRunsByRoom] = useState<Record<string, GitHubActionRun[]>>({});
  const [actionsLastCheckedByRoom, setActionsLastCheckedByRoom] = useState<Record<string, string | null>>({});
  const [gitBranchName, setGitBranchName] = useState("multaiplayer/alpha-codex-room");
  const [gitCommitMessage, setGitCommitMessage] = useState("Build multAIplayer alpha room workflow");
  const [gitPushEnabled, setGitPushEnabled] = useState(false);
  const [prOwner, setPrOwner] = useState("maddiedreese");
  const [prRepo, setPrRepo] = useState("multAIplayer");
  const [prBase, setPrBase] = useState("main");
  const [fileQuery, setFileQuery] = useState("");
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<ProjectFileContent | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<GitDiffResult | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [markdownCopyFallback, setMarkdownCopyFallback] = useState<MarkdownCopyFallback | null>(null);
  const [sensitiveAttachmentReviewPath, setSensitiveAttachmentReviewPath] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [inviteSecretInput, setInviteSecretInput] = useState("");
  const [inviteApprovalGate, setInviteApprovalGate] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviteAdmissionsByRoom, setInviteAdmissionsByRoom] = useState<Record<string, string>>({});
  const [codexThreadIdsByRoom, setCodexThreadIdsByRoom] = useState<Record<string, string>>({});
  const relayRef = useRef<RelayClient | null>(null);
  const seenEnvelopeIds = useRef(new Set<string>());
  const historyLoadedRoomIds = useRef(new Set<string>());
  const roomsRef = useRef<RoomRecord[]>(rooms);
  const selectedRoomIdRef = useRef(selectedRoomId);
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
  const selectedTeamName = teams.find((team) => team.id === selectedTeam)?.name ?? (teams.length ? "No team selected" : "No teams yet");
  const selectedCodexModel = selectedRoom?.codexModel ?? defaultCodexModel;
  const selectedBrowserAllowedOrigins = selectedRoom.browserAllowedOrigins ?? defaultBrowserAllowedOrigins;
  const messages = messagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const draft = draftsByRoom[selectedRoom?.id ?? selectedRoomId] ?? "";
  const pendingAttachments = pendingAttachmentsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const pendingAttachmentBytes = embeddedAttachmentBytes(pendingAttachments);
  const browserRequests = browserRequestsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const browserStatus = browserStatusByRoom[selectedRoom?.id ?? selectedRoomId] ?? defaultBrowserStatus;
  const gitStatus = gitStatusByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const actionRuns = actionRunsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const actionsLastChecked = actionsLastCheckedByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const actionsMessage = actionsMessagesByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const terminalLines = terminalLinesByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const actionsSummary = useMemo(() => summarizeActionRuns(actionRuns), [actionRuns]);
  const githubWorkflowReadiness = useMemo(() => checkGitHubWorkflowReadiness({
    pushEnabled: gitPushEnabled,
    authConfig,
    currentUser,
    owner: prOwner,
    repo: prRepo,
    head: gitBranchName,
    base: prBase
  }), [authConfig, currentUser, gitBranchName, gitPushEnabled, prBase, prOwner, prRepo]);
  const gitApprovalPreview = useMemo(() => {
    try {
      const plan = createGitWorkflowApprovalPlan(
        selectedRoom.projectPath,
        gitBranchName,
        gitCommitMessage,
        gitPushEnabled
      );
      const normalizedBase = gitPushEnabled ? normalizeGitHubBranchName(prBase.trim() || "main") : prBase.trim();
      return {
        plan,
        normalizedBase,
        steps: formatGitWorkflowApprovalPreview(plan),
        error: null
      };
    } catch (error) {
      return {
        plan: null,
        normalizedBase: prBase.trim(),
        steps: [],
        error: String(error)
      };
    }
  }, [gitBranchName, gitCommitMessage, gitPushEnabled, prBase, selectedRoom.projectPath]);
  const codexTurnSummary = useMemo(
    () => buildCodexTurnSummary(messages, selectedRoom, terminals, browserRequests, gitStatus),
    [messages, selectedRoom, terminals, browserRequests, gitStatus]
  );
  const roomMembers = Object.values(presenceByRoom[selectedRoom?.id ?? selectedRoomId] ?? {})
    .filter((member) => member.status === "online")
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const selectedTerminal = terminals.find((terminal) => terminal.id === selectedTerminalId) ?? null;
  const hostHandoffs = hostHandoffsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const terminalRequests = terminalRequestsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const inviteRequests = inviteRequestsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const codexEvents = codexEventsByRoom[selectedRoom?.id ?? selectedRoomId] ?? [];
  const selectedCodexThreadId = codexThreadIdsByRoom[selectedRoom?.id ?? selectedRoomId] ?? null;
  const hostStatusLabel = formatHostStatus(selectedRoom);
  const isActiveHost = isLocalUserActiveHostForRoom(selectedRoom, localUser);
  const isSelectedRoomForgotten = forgottenRoomIds.has(selectedRoom.id);
  const hostGateMessage =
    selectedRoom.hostStatus === "active"
      ? `Only ${selectedRoom.host} can approve host-side actions in this room.`
      : "Claim host before approving host-side actions in this room.";
  const roomSettingsGateMessage =
    selectedRoom.hostStatus === "active"
      ? `Only ${selectedRoom.host} can change room host settings.`
      : "Claim host before changing room host settings.";
  const selectedAttachmentReview = selectedFile
    ? decideAttachmentReview(selectedFile.content, selectedFile.path, sensitiveAttachmentReviewPath)
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
  const visibleMessageHits = useMemo(() => {
    if (!searchActive) return [];
    return Object.entries(messagesByRoom)
      .flatMap(([roomId, roomMessages]) =>
        roomMessages
          .filter((message) => searchMatches([message.author, message.body, message.attachments?.map((attachment) => attachment.name).join(" ") ?? ""], normalizedSidebarQuery))
          .map((message) => ({ roomId, message }))
      )
      .slice(-8);
  }, [messagesByRoom, normalizedSidebarQuery, searchActive]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
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

  useEffect(() => {
    const invitePayload = readInviteUrlPayload(window.location);
    if (!invitePayload) return;
    window.history.replaceState(null, "", invitePayload.cleanupPath);
    if (invitePayload.kind === "join") {
      requestNoSecretInviteAccess(invitePayload.encoded, invitePayload.inviteId)
        .catch((error) => setInviteMessage(`Invite could not be read: ${String(error)}`));
      return;
    }

    acceptInvite(invitePayload.encoded, invitePayload.inviteId, invitePayload.approvalRequested)
      .catch((error) => setInviteMessage(`Invite could not be read: ${String(error)}`));
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
    setTeamHistorySettings(loadTeamHistorySettings(selectedTeam));
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
    setSecretWarningVisible(hasSelectedRoom && !hasAcknowledgedRoomVisibilityWarning(selectedRoomId));
  }, [hasSelectedRoom, selectedRoomId]);

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
          console.warn("Relay error", message.message);
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
              appendTerminalLinesForRoom(message.envelope.roomId, buildGitWorkflowEventLines(plaintext));
              setGitWorkflowMessage(plaintext.message);
            }
            if (isGitHubActionsEventPlaintextPayload(plaintext)) {
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
              publishRequestStatus("browser.event", plaintext.id, "approved", envelopeRoom).catch((error) => {
                setBrowserMessage(String(error));
              });
              setBrowserMessage(`Auto-approved allowed browser site ${formatBrowserAccessLabel(plaintext.url)}.`);
            }
          }
          if (message.envelope.kind === "browser.event") {
            const plaintext = await decryptJson<RequestStatusPlaintextPayload>(roomPayload, secret);
            updateBrowserRequestStatus(message.envelope.roomId, plaintext.requestId, plaintext.status);
          }
          if (message.envelope.kind === "room.host") {
            const plaintext = await decryptJson<HostHandoffPlaintextPayload>(roomPayload, secret);
            setHostHandoffsByRoom((current) => {
              const roomHandoffs = current[message.envelope.roomId] ?? [];
              if (roomHandoffs.some((existing) => existing.id === plaintext.id)) return current;
              return {
                ...current,
                [message.envelope.roomId]: [...roomHandoffs, { ...plaintext, status: "available" }]
              };
            });
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
        if (!hasSelectedRoom) return;
        openClient.publish({
          type: "join",
          teamId: selectedRoom.teamId,
          roomId: selectedRoom.id,
          userId: localUser.id,
          deviceId,
          inviteId: inviteAdmissionsByRoom[selectedRoom.id]
        });
        if (selectedTeam) {
          openClient.publish({
            type: "subscribe.team",
            teamId: selectedTeam,
            userId: localUser.id,
            deviceId
          });
        }
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
    selectedRoom.approvalPolicy,
    selectedRoom.browserAllowedOrigins,
    selectedRoom.id,
    selectedRoom.teamId,
    selectedTeam
  ]);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    if (forgottenRoomIds.has(selectedRoomId)) return;
    if (!historyLoadedRoomIds.current.has(selectedRoomId)) return;
    const payload = pruneLocalRoomHistory({
      version: 2,
      messages,
      terminalRequests,
      browserRequests,
      inviteRequests,
      codexEvents,
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
    forgottenRoomIds,
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
    setGitStatusForRoom(roomId, null);
    getGitStatus(selectedRoom.projectPath)
      .then((status) => setGitStatusForRoom(roomId, status))
      .catch((error) => {
        setGitStatusForRoom(roomId, {
          branch: "unknown",
          files: [{ path: String(error), status: "error", added: 0, removed: 0 }]
        });
      });
  }, [hasSelectedRoom, selectedRoom.id, selectedRoom.projectPath]);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    setActionRunsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setActionsLastCheckedByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
  }, [gitBranchName, hasSelectedRoom, prOwner, prRepo, selectedRoom.id]);

  useEffect(() => {
    if (!hasSelectedRoom) {
      setProjectFiles([]);
      setFileBusy(false);
      return;
    }
    let cancelled = false;
    setFileBusy(true);
    searchProjectFiles(selectedRoom.projectPath, fileQuery, 80)
      .then((files) => {
        if (cancelled) return;
        setProjectFiles(files);
        setFileMessage(null);
      })
      .catch((error) => {
        if (!cancelled) setFileMessage(String(error));
      })
      .finally(() => {
        if (!cancelled) setFileBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileQuery, hasSelectedRoom, selectedRoom.projectPath]);

  useEffect(() => {
    if (!hasSelectedRoom) {
      setTerminals([]);
      setSelectedTerminalId(null);
      return;
    }
    let cancelled = false;
    listTerminals(selectedRoom.id)
      .then((snapshots) => {
        if (cancelled) return;
        setTerminals(snapshots);
        setSelectedTerminalId((current) =>
          current && snapshots.some((terminal) => terminal.id === current)
            ? current
            : snapshots[0]?.id ?? null
        );
      })
      .catch((error) => {
        if (!cancelled) setTerminalError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [hasSelectedRoom, selectedRoom.id]);

  useEffect(() => {
    if (!selectedTerminalId) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      readTerminal(selectedTerminalId)
        .then((snapshot) => {
          if (cancelled) return;
          setTerminals((current) => upsertTerminal(current, snapshot));
        })
        .catch((error) => {
          if (!cancelled) setTerminalError(String(error));
        });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedTerminalId]);

  useEffect(() => {
    probeCodex().then(setCodexProbe).catch((error) => {
      setCodexProbe({ available: false, version: null, error: String(error) });
    });
  }, []);

  useEffect(() => {
    setCustomCodexModel(selectedCodexModel);
  }, [selectedCodexModel]);

  useEffect(() => {
    setBrowserAllowedOriginsDraft(selectedBrowserAllowedOrigins.join("\n"));
  }, [selectedRoom.id, selectedBrowserAllowedOrigins]);

  useEffect(() => {
    setProjectPathDraft(selectedRoom.projectPath);
    setSelectedFile(null);
    setSelectedDiff(null);
    setFileQuery("");
  }, [selectedRoom.id, selectedRoom.projectPath]);

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

  async function sendMessage() {
    if (!hasSelectedRoom) {
      setChatMessage("Create or join a room before sending messages.");
      return;
    }
    if (isSelectedRoomForgotten) {
      setChatMessage("This room was forgotten on this device. Rejoin or paste a room invite key before sending.");
      return;
    }
    const roomId = selectedRoom.id;
    const attachments = pendingAttachments;
    const body = draft.trim();
    if (!body && attachments.length === 0) return;
    const attachmentError = validatePendingAttachments(attachments);
    if (attachmentError) {
      setChatMessage(attachmentError);
      return;
    }
    const createdAt = new Date().toISOString();
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      author: localUser.name,
      role: body.includes("@Codex") ? "system" : "human",
      body: body || "Attached files.",
      time: formatMessageTime(createdAt),
      createdAt,
      attachments: attachments.length ? attachments : undefined
    };
	    await publishChatMessage(message);
	    if (body.includes("@Codex")) {
	      handleCodexInvoke(message);
	    }
	    setDraftForRoom(roomId, "");
	    setPendingAttachmentsForRoom(roomId, []);
	  }

	  function handleCodexInvoke(pendingMessage?: ChatMessage) {
    if (!hasSelectedRoom) {
      setHostMessage("Create or join a room before invoking Codex.");
      setApprovalVisible(false);
      return;
    }
    if (isSelectedRoomForgotten) {
      setHostMessage("This room was forgotten on this device. Rejoin or paste a room invite key before invoking Codex.");
      setApprovalVisible(false);
      return;
    }
    if (!selectedRoom.mode.code) {
      setHostMessage("Code mode is disabled for this room.");
      setApprovalVisible(false);
      return;
    }
    if (selectedRoom.approvalPolicy === "never_host") {
      setHostMessage("This room is set to never host Codex turns.");
	      setApprovalVisible(false);
	      return;
	    }
	    if (selectedRoom.approvalPolicy === "auto_chat_only") {
	      const turnMessages = pendingMessage ? [...messages, pendingMessage] : messages;
	      const turnSummary = buildCodexTurnSummary(turnMessages, selectedRoom, terminals, browserRequests, gitStatus);
      if (shouldAutoApproveChatOnlyTurn(turnSummary, isActiveHost)) {
	        setApprovalVisible(false);
	        setHostMessage("Auto-approved chat-only Codex turn.");
	        approveCodexTurn(turnMessages, turnSummary).catch((error) => setHostMessage(String(error)));
	        return;
	      }
	      setApprovalVisible(true);
	      setHostMessage(
	        isActiveHost
	          ? "This turn includes workspace, browser, terminal, or attachment context, so host approval is required."
	          : hostGateMessage
	      );
	      return;
	    }
	    setApprovalVisible(true);
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
      const room = await createRoom(
        plan.teamId,
        plan.name,
        plan.projectPath
	      );
      upsertRoom(ensureRoomDefaults(room));
      setForgottenRoomIds((current) => withoutSetValue(current, room.id));
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
  }

  function upsertRoom(room: RoomRecord) {
    setRooms((current) => {
      if (current.some((item) => item.id === room.id)) {
        return current.map((item) => (item.id === room.id ? room : item));
      }
      return [...current, room];
    });
  }

  async function setRoomHost(hostStatus: RoomRecord["hostStatus"]) {
    if (!hasSelectedRoom) {
      setHostMessage("Create or join a room before changing the host.");
      return;
    }
    if (hostStatus !== "active" && !isActiveHost) {
      setHostMessage(hostGateMessage);
      return;
    }
    setHostBusy(true);
    setHostMessage(null);
    try {
      const host = hostStatus === "active" ? localUser.name : hostStatus === "handoff" ? selectedRoom.host : "No host";
      const hostUserId = hostStatus === "active" ? localUser.id : selectedRoom.hostUserId ?? localUser.id;
      const room = await updateRoomHost(selectedRoom.id, host, hostUserId, hostStatus);
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      setHostMessage(
        hostStatus === "active"
          ? `You are hosting ${room.name}.`
          : hostStatus === "handoff"
            ? `${room.name} is ready for host handoff.`
            : `${room.name} no longer has an active host.`
      );
      if (hostStatus === "handoff") {
        await publishHostHandoff(room);
      }
      if (hostStatus === "active") {
        markLatestHostHandoffAccepted(room.id);
      }
    } catch (error) {
      setHostMessage(String(error));
    } finally {
      setHostBusy(false);
    }
  }

  async function acceptHostHandoff(handoff: HostHandoffRecord) {
    if (!hasSelectedRoom) {
      setHostMessage("Create or join a room before accepting a host handoff.");
      return;
    }
    if (handoff.status !== "available") {
      setHostMessage("This host handoff has already been accepted.");
      return;
    }
    setHostBusy(true);
    setHostMessage(null);
    try {
      const patch = createHandoffSettingsPatch(handoff);
      const updatedSettings = await updateRoomSettings(selectedRoom.id, {
        ...roomSettingsActor(),
        ...patch
      });
      const claimed = await updateRoomHost(updatedSettings.id, localUser.name, localUser.id, "active");
      setRooms((current) => current.map((item) => (item.id === claimed.id ? ensureRoomDefaults(claimed) : item)));
      markHostHandoffAccepted(selectedRoom.id, handoff.id);
      setProjectPathDraft(patch.projectPath);
      setCustomCodexModel(patch.codexModel);
      setSettingsMessage(
        `Accepted handoff from ${handoff.fromHost}; inherited ${formatCodexModel(patch.codexModel)} and ${patch.projectPath}.`
      );
      setHostMessage(`You are now hosting ${claimed.name} from ${handoff.fromHost}'s handoff.`);
    } catch (error) {
      setHostMessage(String(error));
    } finally {
      setHostBusy(false);
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
      setHostMessage("Host handoff package saved locally because the relay is not connected.");
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
    setInviteMessage(
      plaintext.status === "approved"
        ? plaintext.wrappedRoomSecret
          ? `${plaintext.decidedBy} approved your room join request and delivered a device-wrapped room key.`
          : `${plaintext.decidedBy} approved your room join request.`
        : `${plaintext.decidedBy} denied your room join request.`
    );
  }

  async function decideInviteJoinRequest(request: InviteJoinRequest, status: InviteJoinRequest["status"]) {
    if (!hasSelectedRoom) {
      setInviteMessage("Create or join a room before deciding invite requests.");
      return;
    }
    if (!isActiveHost) {
      setInviteMessage(hostGateMessage);
      return;
    }
    if (status === "pending") return;
    updateInviteRequestStatus(selectedRoom.id, request.id, status);
    setInviteMessage(`${status === "approved" ? "Approved" : "Denied"} ${request.requester}'s join request.`);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(selectedRoom.id);
    const wrappedRoomSecret = status === "approved" && request.requesterPublicKeyJwk
      ? await wrapRoomSecretForDevice(secret, request.requesterPublicKeyJwk)
      : undefined;
    const payload: InviteJoinStatusPlaintextPayload = {
      eventType: "invite.status",
      requestId: request.id,
      status,
      decidedBy: localUser.name,
      decidedByUserId: localUser.id,
      decidedAt: new Date().toISOString(),
      recipientDeviceId: request.requesterDeviceId,
      recipientPublicKeyFingerprint: request.requesterPublicKeyFingerprint,
      wrappedRoomSecret: wrappedRoomSecret
        ? {
            ...wrappedRoomSecret,
            ephemeralPublicKeyJwk: jsonWebKeyToRecord(wrappedRoomSecret.ephemeralPublicKeyJwk)
        }
        : undefined
    };
    const envelopePayload = request.requesterPublicKeyJwk
      ? await sealJsonToDevice(payload, request.requesterPublicKeyJwk)
      : await encryptJson(payload, secret);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: selectedRoom.teamId,
      roomId: selectedRoom.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.decidedAt,
      kind: "room.invite",
      payload: envelopePayload
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
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
      setSettingsMessage("Create or join a room before changing room settings.");
      return;
    }
    if (!isActiveHost) {
      setSettingsMessage(roomSettingsGateMessage);
      return;
    }
    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      const room = await updateRoomSettings(selectedRoom.id, { ...roomSettingsActor(), approvalPolicy });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      setSettingsMessage(`Approval policy set to ${approvalPolicyLabels[approvalPolicy]}.`);
      if (approvalPolicy === "never_host") {
        setApprovalVisible(false);
      }
    } catch (error) {
      setSettingsMessage(String(error));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function toggleRoomMode(key: keyof RoomMode) {
    if (!hasSelectedRoom) {
      setSettingsMessage("Create or join a room before changing room settings.");
      return;
    }
    if (!isActiveHost) {
      setSettingsMessage(roomSettingsGateMessage);
      return;
    }
    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      const nextMode: RoomMode = {
        ...selectedRoom.mode,
        [key]: !selectedRoom.mode[key]
      };
      const room = await updateRoomSettings(selectedRoom.id, { ...roomSettingsActor(), mode: nextMode });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      setSettingsMessage(`${roomModeLabels[key]} mode ${nextMode[key] ? "enabled" : "disabled"}.`);
    } catch (error) {
      setSettingsMessage(String(error));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function setCodexModel(codexModel: string) {
    const nextModel = normalizeCodexModel(codexModel);
    if (!nextModel) {
      setSettingsMessage(`Use a known Codex model or a model-like id up to ${maxCodexModelChars} characters.`);
      return;
    }
    if (nextModel === selectedCodexModel) return;
    if (!hasSelectedRoom) {
      setSettingsMessage("Create or join a room before changing the Codex model.");
      return;
    }
    if (!isActiveHost) {
      setSettingsMessage(roomSettingsGateMessage);
      return;
    }
    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      const room = await updateRoomSettings(selectedRoom.id, { ...roomSettingsActor(), codexModel: nextModel });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      setSettingsMessage(`Codex model set to ${formatCodexModel(nextModel)}.`);
    } catch (error) {
      setSettingsMessage(String(error));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function saveBrowserAllowedOrigins() {
    if (!hasSelectedRoom) {
      setBrowserMessage("Create or join a room before changing browser site permissions.");
      return;
    }
    if (!isActiveHost) {
      setBrowserMessage(roomSettingsGateMessage);
      return;
    }
    const normalized = normalizeBrowserAllowedOrigins(browserAllowedOriginsDraft);
    if (!normalized) {
      setBrowserMessage("Use one http(s) origin per line, such as https://github.com.");
      return;
    }
    setSettingsBusy(true);
    setBrowserMessage(null);
    try {
      const room = await updateRoomSettings(selectedRoom.id, {
        ...roomSettingsActor(),
        browserAllowedOrigins: normalized
      });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      setBrowserAllowedOriginsDraft(normalized.join("\n"));
      setBrowserMessage(
        normalized.length
          ? `Allowed browser sites saved: ${normalized.map(formatBrowserAccessLabel).join(", ")}.`
          : "Allowed browser site list is empty. Browser requests will require manual approval."
      );
    } catch (error) {
      setBrowserMessage(String(error));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function updateProjectPath() {
    const nextProjectPath = normalizeProjectPath(projectPathDraft);
    if (!nextProjectPath) {
      setSettingsMessage(`Enter a local project folder up to ${maxRoomProjectPathChars} characters without control characters.`);
      return;
    }
    if (!hasSelectedRoom) {
      setSettingsMessage("Create or join a room before attaching a project folder.");
      return;
    }
    if (nextProjectPath === selectedRoom.projectPath) return;
    if (!isActiveHost) {
      setSettingsMessage(roomSettingsGateMessage);
      return;
    }
    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      const room = await updateRoomSettings(selectedRoom.id, { ...roomSettingsActor(), projectPath: nextProjectPath });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      setSettingsMessage(`Project folder set to ${nextProjectPath}.`);
    } catch (error) {
      setSettingsMessage(String(error));
    } finally {
      setSettingsBusy(false);
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
      setSettingsMessage("Create or join a room before choosing a project folder.");
      return;
    }
    setSettingsMessage(null);
    try {
      const selectedPath = await chooseProjectFolder(projectPathDraft || selectedRoom.projectPath);
      if (!selectedPath) {
        setSettingsMessage("Native folder picker is available in the Tauri app. In web preview, paste a local folder path.");
        return;
      }
      setProjectPathDraft(selectedPath);
      setSettingsMessage(`Selected project folder: ${selectedPath}`);
    } catch (error) {
      setSettingsMessage(String(error));
    }
  }

  function updateLocalHistorySettings(next: LocalHistorySettings) {
    if (!hasSelectedRoom) {
      setHistoryMessage("Create or join a room before changing encrypted history settings.");
      return;
    }
    const saved = saveHistorySettings(selectedRoom.id, next);
    setHistorySettings(saved);
    if (saved.enabled) {
      const payload = pruneLocalRoomHistory({
        version: 2,
        messages,
        terminalRequests,
        browserRequests,
        inviteRequests,
        codexEvents,
        hostHandoffs
      }, saved.retentionDays);
      setMessagesByRoom((current) => ({ ...current, [selectedRoom.id]: payload.messages }));
      setTerminalRequestsByRoom((current) => ({ ...current, [selectedRoom.id]: payload.terminalRequests }));
      setBrowserRequestsByRoom((current) => ({ ...current, [selectedRoom.id]: payload.browserRequests }));
      setInviteRequestsByRoom((current) => ({ ...current, [selectedRoom.id]: payload.inviteRequests }));
      setCodexEventsByRoom((current) => ({ ...current, [selectedRoom.id]: payload.codexEvents }));
      setHostHandoffsByRoom((current) => ({ ...current, [selectedRoom.id]: payload.hostHandoffs }));
    }
    setHistoryMessage(
      saved.enabled
        ? `Encrypted local history retention set to ${saved.retentionDays} days.`
        : "Encrypted local history is disabled for this room."
	    );
	  }

  function updateTeamHistoryDefaults(next: LocalHistorySettings) {
    if (!selectedTeam) {
      setHistoryMessage("Create or select a team before changing team history defaults.");
      return;
    }
    const saved = saveTeamHistorySettings(selectedTeam, next);
    setTeamHistorySettings(saved);
    setHistoryMessage(
      saved.enabled
        ? `Team default local history retention set to ${saved.retentionDays} days for new rooms.`
        : "Team default local history is disabled for new rooms."
    );
  }

  function applyTeamHistoryDefaultsToRoom() {
    if (!hasSelectedRoom) {
      setHistoryMessage("Create or join a room before applying team history defaults.");
      return;
    }
    updateLocalHistorySettings(teamHistorySettings);
  }

  async function clearRoomHistory() {
    if (!hasSelectedRoom) {
      setHistoryMessage("Create or join a room before clearing local history.");
      return;
    }
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
    setHostHandoffsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setCodexThreadIdsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionRunsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsLastCheckedByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setGitStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setPendingAttachmentsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalLinesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setDraftsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHistoryMessage("Cleared encrypted local history for this room.");
  }

  async function forgetSelectedRoomLocalData() {
    if (!hasSelectedRoom) {
      setHistoryMessage("Create or join a room before forgetting local room data.");
      return;
    }
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
    setHostHandoffsByRoom((current) => ({
      ...current,
      [selectedRoom.id]: []
    }));
    setCodexThreadIdsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionRunsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsLastCheckedByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setActionsMessagesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setBrowserStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setGitStatusByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setPendingAttachmentsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setTerminalLinesByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setDraftsByRoom((current) => omitRecordKey(current, selectedRoom.id));
    setHistorySettings(loadHistorySettings(selectedRoom.id));
    setSecretWarningVisible(true);
    setHistoryMessage("Forgot this room on this device. Rejoin or paste a room invite key to unlock it again.");
  }

  async function copyInviteLink() {
    if (!hasSelectedRoom) {
      setInviteMessage("Create or join a room before copying an invite.");
      return;
    }
    setInviteMessage(null);
    setInviteLink("");
    try {
      const invite = await createInvite(selectedRoom.teamId, selectedRoom.id);
      if (inviteApprovalGate) {
        if (!deviceIdentity) {
          setInviteMessage("Device key is still being prepared. Try again in a moment.");
          return;
        }
        const joinFragment = encodeNoSecretRoomInvite({
          version: 1,
          teamId: selectedRoom.teamId,
          roomId: selectedRoom.id,
          roomName: selectedRoom.name,
          hostDeviceId: deviceId,
          hostPublicKeyJwk: jsonWebKeyToRecord(deviceIdentity.publicKeyJwk),
          hostPublicKeyFingerprint: deviceIdentity.publicKeyFingerprint
        });
        const link = `${window.location.origin}${window.location.pathname}?invite=${invite.id}#multaiplayerJoin=${joinFragment}&approval=request`;
        setInviteLink(displayableInviteLink(link, false));
        try {
          await navigator.clipboard.writeText(link);
          setInviteMessage("Copied gated invite link. The room key is not in the link; approval delivers it wrapped to the joiner's device key.");
        } catch {
          setInviteMessage("Gated invite generated. Copying was blocked because the app was not focused; the room key is not in the link.");
        }
        return;
      }
      const secret = await exportRoomSecret(selectedRoom.id);
      const secretFragment = encodeRoomInviteSecret({
        version: 1,
        teamId: selectedRoom.teamId,
        roomId: selectedRoom.id,
        roomName: selectedRoom.name,
        secret
      });
      const link = `${window.location.origin}${window.location.pathname}?invite=${invite.id}#multaiplayerInvite=${secretFragment}`;
      setInviteLink(displayableInviteLink(link, true));
      try {
        await navigator.clipboard.writeText(link);
        setInviteMessage("Copied direct invite link. It contains the room key, so it is not displayed in the app after copying.");
      } catch {
        setInviteMessage("Direct invite generated, but copying was blocked. Because it contains the room key, it is not displayed; focus the app and try again or use the approval gate.");
      }
    } catch (error) {
      setInviteMessage(String(error));
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
    setInviteMessage(published
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
      setInviteMessage(published
        ? `Imported ${acceptedRoomName} and sent an encrypted join request to the active host.`
        : `Imported ${acceptedRoomName}. Send again after the relay reconnects so the host can approve access.`);
      return;
    }
    setInviteMessage(`Joined ${acceptedRoomName}. The relay provided metadata only; the room key stayed in the URL fragment.`);
  }

  async function joinInviteSecret() {
    const raw = inviteSecretInput.trim();
    if (!raw) return;
    setInviteMessage(null);
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
      setInviteMessage(`Invite could not be imported: ${String(error)}`);
    }
  }

	  async function approveCodexTurn(
	    turnMessages: ChatMessage[] = messages,
	    turnSummary: CodexTurnSummary = codexTurnSummary
	  ) {
	    if (!hasSelectedRoom) {
	      setHostMessage("Create or join a room before approving a Codex turn.");
	      setApprovalVisible(false);
      return;
    }
    if (!isActiveHost) {
      setHostMessage(hostGateMessage);
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    const model = selectedCodexModel;
    const projectPath = room.projectPath;
    setApprovalVisible(false);
    setCodexRunning(true);
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
      setCodexRunning(false);
    }
  }

  async function publishChatMessage(message: ChatMessage, room: RoomRecord = selectedRoom) {
    if (forgottenRoomIds.has(room.id)) {
      setChatMessage("This room was forgotten on this device. Rejoin or paste a room invite key before sending.");
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
      setChatMessage("Create or join a room before reacting to messages.");
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
    applyMessageReaction(selectedRoom.id, payload);

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      setChatMessage("Saved reaction locally because the relay is not connected.");
      return;
    }
    const secret = await loadOrCreateRoomSecret(selectedRoom.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: selectedRoom.teamId,
      roomId: selectedRoom.id,
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
      setTerminalError("Create or join a room before running terminal commands.");
      return;
    }
    if (!isActiveHost) {
      setTerminalError(hostGateMessage);
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    const projectPath = room.projectPath;
    setTerminalBusy(true);
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
      setTerminalBusy(false);
    }
  }

  async function startNamedTerminal() {
    if (!hasSelectedRoom) {
      setTerminalError("Create or join a room before starting a terminal.");
      return;
    }
    if (!isActiveHost) {
      setTerminalError(hostGateMessage);
      return;
    }
    setTerminalBusy(true);
    setTerminalError(null);
    try {
      const snapshot = await startTerminal(
        selectedRoom.id,
        terminalName.trim(),
        selectedRoom.projectPath,
        terminalCommand.trim()
      );
      setTerminals((current) => upsertTerminal(current, snapshot));
      setSelectedTerminalId(snapshot.id);
    } catch (error) {
      setTerminalError(String(error));
    } finally {
      setTerminalBusy(false);
    }
  }

  async function stopSelectedTerminal() {
    if (!selectedTerminalId) return;
    if (!hasSelectedRoom) {
      setTerminalError("Create or join a room before stopping terminals.");
      return;
    }
    if (!isActiveHost) {
      setTerminalError(hostGateMessage);
      return;
    }
    setTerminalBusy(true);
    setTerminalError(null);
    try {
      const snapshot = await stopTerminal(selectedTerminalId);
      setTerminals((current) => upsertTerminal(current, snapshot));
    } catch (error) {
      setTerminalError(String(error));
    } finally {
      setTerminalBusy(false);
    }
  }

  async function sendTerminalInput() {
    const input = terminalInput.trim();
    if (!selectedTerminalId || !input) return;
    if (!hasSelectedRoom) {
      setTerminalError("Create or join a room before sending terminal input.");
      return;
    }
    if (!isActiveHost) {
      setTerminalError(hostGateMessage);
      return;
    }
    setTerminalError(null);
    try {
      const snapshot = await writeTerminal(selectedTerminalId, input);
      setTerminals((current) => upsertTerminal(current, snapshot));
      setTerminalInput("");
    } catch (error) {
      setTerminalError(String(error));
    }
  }

  async function requestTerminalCommand() {
    const command = terminalCommand.trim();
    if (!command) return;
    if (!hasSelectedRoom) {
      setTerminalError("Create or join a room before requesting terminal commands.");
      return;
    }
    const room = selectedRoom;
    setTerminalError(null);
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
      setTerminalError("Saved command request locally because the relay is not connected.");
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
      setTerminalError(String(error));
    }
  }

  async function approveTerminalRequest(request: TerminalCommandRequest) {
    if (!hasSelectedRoom) {
      setTerminalError("Create or join a room before approving terminal requests.");
      return;
    }
    if (!isActiveHost) {
      setTerminalError(hostGateMessage);
      return;
    }
    setTerminalBusy(true);
    setTerminalError(null);
    const room = selectedRoom;
    let approvedRequest: TerminalCommandRequest;
    try {
      approvedRequest = terminalRequestForApprovedRun(request, room.projectPath);
    } catch (error) {
      setTerminalError(String(error));
      setTerminalBusy(false);
      return;
    }
    updateTerminalRequestStatus(room.id, approvedRequest.id, "approved");
    publishRequestStatus("terminal.event", approvedRequest.id, "approved", room).catch((error) => {
      setTerminalError(String(error));
    });
    const roomId = room.id;
    const projectPath = room.projectPath;
    appendTerminalLinesForRoom(roomId, [
      `${approvedRequest.requester} requested: ${approvedRequest.command}`,
      `$ ${approvedRequest.command}`,
      ...(request.cwd !== approvedRequest.cwd ? [`Running in room project: ${approvedRequest.cwd}`] : [])
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
        setTerminalError(String(error));
      });
      const status = await getGitStatus(projectPath);
      setGitStatusForRoom(roomId, status);
    } catch (error) {
      appendTerminalLinesForRoom(roomId, [String(error)]);
      setTerminalError(String(error));
      publishTerminalResult(approvedRequest, {
        startedAt,
        finishedAt: new Date().toISOString(),
        exitStatus: null,
        stdout: "",
        stderr: "",
        error: String(error)
      }, room).catch((publishError) => {
        setTerminalError(String(publishError));
      });
    } finally {
      setTerminalBusy(false);
    }
  }

  function denyTerminalRequest(requestId: string) {
    if (!hasSelectedRoom) {
      setTerminalError("Create or join a room before denying terminal requests.");
      return;
    }
    if (!isActiveHost) {
      setTerminalError(hostGateMessage);
      return;
    }
    updateTerminalRequestStatus(selectedRoom.id, requestId, "denied");
    publishRequestStatus("terminal.event", requestId, "denied").catch((error) => {
      setTerminalError(String(error));
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
      setBrowserMessage("Create or join a room before requesting browser access.");
      return;
    }
    const room = selectedRoom;
    const activeHost = isActiveHost;
    if (!room.mode.browser) {
      setBrowserMessage("Browser mode is disabled for this room.");
      return;
    }
    const rawUrl = browserUrl.trim();
    if (!rawUrl) return;
    setBrowserMessage(null);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      setBrowserMessage("Enter a valid browser URL.");
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
      setBrowserMessage(
        autoApproved
          ? `Auto-approved allowed browser site ${formatBrowserAccessLabel(request.url)} locally because the relay is not connected.`
          : "Saved browser request locally because the relay is not connected."
      );
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
        await publishRequestStatus("browser.event", request.id, "approved", room);
      }
      setBrowserMessage(
        autoApproved
          ? `Auto-approved allowed browser site ${formatBrowserAccessLabel(request.url)}.`
          : `Requested browser access to ${formatBrowserAccessLabel(request.url)}.`
      );
    } catch (error) {
      setBrowserMessage(String(error));
    }
  }

  function approveBrowserRequest(request: BrowserAccessRequest) {
    if (!hasSelectedRoom) {
      setBrowserMessage("Create or join a room before approving browser access.");
      return;
    }
    if (!isActiveHost) {
      setBrowserMessage(hostGateMessage);
      return;
    }
    updateBrowserRequestStatus(selectedRoom.id, request.id, "approved");
    publishRequestStatus("browser.event", request.id, "approved").catch((error) => {
      setBrowserMessage(String(error));
    });
    setBrowserMessage(`Approved browser access to ${formatBrowserAccessLabel(request.url)}.`);
  }

  function denyBrowserRequest(requestId: string) {
    if (!hasSelectedRoom) {
      setBrowserMessage("Create or join a room before denying browser access.");
      return;
    }
    if (!isActiveHost) {
      setBrowserMessage(hostGateMessage);
      return;
    }
    updateBrowserRequestStatus(selectedRoom.id, requestId, "denied");
    publishRequestStatus("browser.event", requestId, "denied").catch((error) => {
      setBrowserMessage(String(error));
    });
    setBrowserMessage("Denied browser access request.");
  }

  async function openApprovedBrowserRequest(request: BrowserAccessRequest) {
    if (request.status !== "approved") return;
    if (!hasSelectedRoom) {
      setBrowserMessage("Create or join a room before opening the room browser.");
      return;
    }
    if (!isActiveHost) {
      setBrowserMessage(hostGateMessage);
      return;
    }
    setBrowserMessage(null);
    try {
      const result = await openBrowserView(
        selectedRoom.id,
        selectedRoom.projectPath,
        request.url,
        `${selectedRoom.name} - ${formatBrowserAccessLabel(request.url)}`
      );
      setBrowserStatusByRoom((current) => ({
        ...current,
        [selectedRoom.id]: {
          profilePath: result.profilePath,
          downloadsBlocked: result.downloadsBlocked,
          clipboardBlocked: result.clipboardBlocked,
          fileUploadsBlocked: result.fileUploadsBlocked
        }
      }));
      setBrowserMessage(
        result.reused
          ? `Reused isolated room browser for ${formatBrowserAccessLabel(result.url)}.`
          : `Opened isolated room browser for ${formatBrowserAccessLabel(result.url)}.`
      );
    } catch (error) {
      setBrowserMessage(String(error));
    }
  }

  async function resetRoomBrowserProfile() {
    if (!hasSelectedRoom) {
      setBrowserMessage("Create or join a room before resetting browser state.");
      return;
    }
    if (!isActiveHost) {
      setBrowserMessage(hostGateMessage);
      return;
    }
    setBrowserMessage(null);
    try {
      const result = await resetBrowserProfile(selectedRoom.id, selectedRoom.projectPath);
      setBrowserStatusByRoom((current) => ({
        ...current,
        [selectedRoom.id]: {
          ...defaultBrowserStatus,
          profilePath: result.profilePath
        }
      }));
      setBrowserMessage("Reset isolated room browser state. The next approved page opens with a fresh profile.");
    } catch (error) {
      setBrowserMessage(String(error));
    }
  }

  function acknowledgeRoomVisibilityWarning() {
    if (!hasSelectedRoom) {
      setSecretWarningVisible(false);
      return;
    }
    saveRoomVisibilityWarningAcknowledgement(selectedRoom.id);
    setSecretWarningVisible(false);
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

  async function publishRequestStatus(
    kind: "terminal.event" | "browser.event",
    requestId: string,
    status: RequestStatusPlaintextPayload["status"],
    room: RoomRecord = selectedRoom
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const payload: RequestStatusPlaintextPayload = {
      requestId,
      status,
      decidedBy: localUser.name,
      decidedByUserId: localUser.id,
      decidedAt: new Date().toISOString()
    };
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
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const payload: GitWorkflowEventPlaintextPayload = {
      eventType: "git.workflow",
      runner: localUser.name,
      runnerUserId: localUser.id,
      createdAt: new Date().toISOString(),
      ...event
    };
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

  async function publishGitHubActionsEvent(
    event: Omit<GitHubActionsEventPlaintextPayload, "eventType" | "checkedBy" | "checkedByUserId">,
    room: RoomRecord = selectedRoom
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    const secret = await loadOrCreateRoomSecret(room.id);
    const payload: GitHubActionsEventPlaintextPayload = {
      eventType: "github.actions",
      checkedBy: localUser.name,
      checkedByUserId: localUser.id,
      ...event
    };
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

  async function openProjectFile(path: string) {
    if (!hasSelectedRoom) {
      setFileMessage("Create or join a room before opening project files.");
      return;
    }
    const room = selectedRoom;
    setFileBusy(true);
    setFileMessage(null);
    try {
      const [file, diff] = await Promise.all([
        readProjectFile(room.projectPath, path),
        getGitDiff(room.projectPath, path).catch(() => null)
      ]);
      if (selectedRoomIdRef.current !== room.id) return;
      setSelectedFile(file);
      setSelectedDiff(diff);
      setSensitiveAttachmentReviewPath(null);
    } catch (error) {
      if (selectedRoomIdRef.current === room.id) setFileMessage(String(error));
    } finally {
      if (selectedRoomIdRef.current === room.id) setFileBusy(false);
    }
  }

  async function copyProjectMarkdown() {
    if (!hasSelectedRoom) {
      setFileMessage("Create or join a room before copying project context.");
      return;
    }
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
    await copyMarkdownWithFallback("project context", markdown, setFileMessage);
  }

  async function attachSelectedFileToMessage() {
    if (!hasSelectedRoom) {
      setFileMessage("Create or join a room before attaching project files.");
      return;
    }
    if (!selectedFile) {
      setFileMessage("Select a project file before attaching it to the room.");
      return;
    }
    const roomId = selectedRoom.id;
    const teamId = selectedRoom.teamId;
    const fileToAttach = selectedFile;
    const roomPendingAttachments = pendingAttachmentsByRoom[roomId] ?? [];
    const review = decideAttachmentReview(fileToAttach.content, fileToAttach.path, sensitiveAttachmentReviewPath);
    if (!review.canAttach) {
      setSensitiveAttachmentReviewPath(fileToAttach.path);
      setFileMessage(attachmentReviewMessage(fileToAttach.path, review.risks));
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
      setFileMessage(`${attachment.name} is already attached to the next room message.`);
      return;
    }
    const selectedContentBytes = encodedBytes(attachment.content ?? "");
    const shouldUploadBlob = selectedContentBytes > maxEmbeddedAttachmentBytes ||
      embeddedAttachmentBytes(roomPendingAttachments) + selectedContentBytes > maxEmbeddedAttachmentBytesPerMessage;
    if (shouldUploadBlob) {
      try {
        setFileBusy(true);
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
        setFileMessage(`Could not upload encrypted attachment blob: ${String(error)}`);
        setFileBusy(false);
        return;
      } finally {
        setFileBusy(false);
      }
    }
    setPendingAttachmentsForRoom(roomId, (current) => {
      if (current.some((item) => item.name === attachment.name)) {
        setFileMessage(`${attachment.name} is already attached to the next room message.`);
        return current;
      }
      const next = [...current, attachment];
      const validationError = validatePendingAttachments(next);
      if (validationError) {
        setFileMessage(validationError);
        return current;
      }
      setSensitiveAttachmentReviewPath(null);
      setFileMessage(attachment.blobId
        ? `Attached ${fileToAttach.path} as an encrypted blob for the next room message.`
        : `Attached ${fileToAttach.path} to the next room message.`);
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
      setFileMessage("Create or join a room before opening encrypted attachments.");
      return;
    }
    const room = selectedRoom;
    if (!attachment.blobId) {
      if (attachment.content) {
        if (selectedRoomIdRef.current !== room.id) return;
        setSelectedDiff(null);
        setSelectedFile({
          path: attachment.name,
          size: attachment.size,
          truncated: Boolean(attachment.truncated),
          content: attachment.content
        });
        setFileMessage(`Opened inline attachment ${attachment.name}.`);
      }
      return;
    }
    setFileBusy(true);
    setFileMessage(null);
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
      setSelectedDiff(null);
      setSelectedFile({
        path: decrypted.name || attachment.name,
        size: decrypted.size ?? attachment.size,
        truncated: Boolean(decrypted.truncated),
        content: decrypted.content
      });
      setFileMessage(`Opened encrypted attachment ${decrypted.name || attachment.name}.`);
    } catch (error) {
      if (selectedRoomIdRef.current === room.id) {
        setFileMessage(`Could not open encrypted attachment: ${String(error)}`);
      }
    } finally {
      if (selectedRoomIdRef.current === room.id) setFileBusy(false);
    }
  }

  async function copyMarkdownWithFallback(
    title: string,
    markdown: string,
    onMessage: (message: string) => void
  ) {
    const result = await copyTextToClipboard(markdown);
    if (result.status === "copied") {
      setMarkdownCopyFallback(null);
      onMessage(`Copied ${title} as Markdown.`);
      return;
    }
    setMarkdownCopyFallback({ title, markdown });
    onMessage(`${title} Markdown is ready below because copying was blocked.`);
  }

  async function copyRoomMarkdown() {
    const markdown = buildRoomMarkdown(selectedRoom, teams.find((team) => team.id === selectedRoom.teamId)?.name ?? "Unknown team", messages);
    await copyMarkdownWithFallback("room chat", markdown, setChatMessage);
  }

  async function copyMessageMarkdown(message: ChatMessage) {
    const markdown = buildMessageMarkdown(message);
    await copyMarkdownWithFallback("message", markdown, setChatMessage);
  }

  async function copyCodexOutputMarkdown(message: ChatMessage) {
    if (!hasSelectedRoom) {
      setChatMessage("Create or join a room before copying Codex output.");
      return;
    }
    const markdown = buildCodexOutputMarkdown(selectedRoom, message, messages);
    await copyMarkdownWithFallback("Codex turn output", markdown, setChatMessage);
  }

  async function copyTerminalMarkdown() {
    if (!hasSelectedRoom) {
      setTerminalError("Create or join a room before copying terminal output.");
      return;
    }
    const lines = selectedTerminal?.lines ?? terminalLines.map((line) => ({ stream: "system", text: line }));
    const markdown = buildTerminalMarkdown(selectedRoom, selectedTerminal, lines, terminalRisks);
    await copyMarkdownWithFallback("terminal output", markdown, setTerminalError);
  }

  async function copyDiffSummaryMarkdown() {
    if (!hasSelectedRoom) {
      setFileMessage("Create or join a room before copying a diff summary.");
      return;
    }
    const markdown = buildDiffSummaryMarkdown(
      selectedRoom,
      gitStatus?.branch ?? "unknown",
      gitStatus?.files ?? [],
      selectedDiff,
      selectedDiff ? detectSecretRisks(selectedDiff.diff, selectedDiff.path) : []
    );
    await copyMarkdownWithFallback("diff summary", markdown, setFileMessage);
  }

  async function copyPullRequestDraftMarkdown() {
    if (!hasSelectedRoom) {
      setGitWorkflowMessage("Create or join a room before copying a PR draft.");
      return;
    }
    const markdown = buildPullRequestBody(messages, gitStatus?.files ?? []);
    await copyMarkdownWithFallback("PR description draft", markdown, setGitWorkflowMessage);
  }

  async function approveGitWorkflow() {
    if (!hasSelectedRoom) {
      setGitWorkflowMessage("Create or join a room before approving a git workflow.");
      return;
    }
    if (!isActiveHost) {
      setGitWorkflowMessage(hostGateMessage);
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    const projectPath = room.projectPath;
    if (!gitApprovalPreview.plan) {
      setGitWorkflowMessage(gitApprovalPreview.error ?? "Git workflow approval preview is invalid.");
      return;
    }
    if (gitPushEnabled && !githubWorkflowReadiness.ready) {
      setGitWorkflowMessage(githubWorkflowReadiness.messages.join(" "));
      return;
    }
    const gitPlan = gitApprovalPreview.plan;
    const normalizedPrBase = gitPushEnabled ? githubWorkflowReadiness.normalizedBase : gitApprovalPreview.normalizedBase;
    setGitWorkflowBusy(true);
    setGitWorkflowMessage(null);
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
        setGitWorkflowMessage(message);
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
          owner: prOwner,
          repo: prRepo,
          title: gitPlan.message,
          body: buildPullRequestBody(messages, gitStatus?.files ?? []),
          head: gitPlan.branch,
          base: normalizedPrBase,
          draft: true
        });
        const message = `Opened draft PR #${pr.number}: ${pr.url}`;
        setGitWorkflowMessage(message);
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
        refreshGitHubActions(room);
      } else {
        const message = "Created local branch and commit. Enable push when you are ready to open a PR.";
        setGitWorkflowMessage(message);
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
      setGitWorkflowMessage(message);
      appendTerminalLinesForRoom(roomId, [`Git workflow error: ${message}`]);
      publishGitWorkflowEvent({
        status: "failed",
        branch: gitPlan?.branch ?? gitBranchName,
        push: gitPlan?.push ?? gitPushEnabled,
        message
      }, room).catch((publishError) => {
        console.warn("Failed to publish git workflow error", publishError);
      });
    } finally {
      setGitWorkflowBusy(false);
    }
  }

  async function refreshGitHubActions(room: RoomRecord = selectedRoom) {
    if (!hasSelectedRoom) {
      setActionsMessagesByRoom((current) => ({
        ...current,
        [room.id]: "Create or join a room before sharing GitHub Actions status."
      }));
      return;
    }
    const roomId = room.id;
    setActionsBusy(true);
    setActionsMessagesByRoom((current) => omitRecordKey(current, roomId));
    try {
      const result = await listGitHubActionRuns(prOwner, prRepo, gitBranchName);
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
        ? `Loaded ${result.runs.length} workflow runs for ${gitBranchName}.`
        : `No workflow runs found for ${gitBranchName}. GitHub may still be scheduling the branch.`;
      setActionsMessagesByRoom((current) => ({
        ...current,
        [roomId]: `${summary.label}: ${message}`
      }));
      publishGitHubActionsEvent({
        owner: prOwner,
        repo: prRepo,
        branch: gitBranchName,
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
      setActionsBusy(false);
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
                <small>{team.members}</small>
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
          {visibleRooms.map((room) => (
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
              {room.unread > 0 ? <b>{room.unread}</b> : <Circle size={8} />}
            </button>
          ))}
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
                <div className="sidebar-empty">No loaded chat matches.</div>
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
              <section className="drawer-section">
                <InfoRow label="Relay" value={`${relayStatus} · ${appConfig.relayWsUrl}`} />
                <InfoRow label="Relay API" value={appConfig.relayHttpUrl} />
                <InfoRow label="Codex" value={codexProbe?.available ? codexProbe.version ?? "Available" : codexProbe?.error ?? "Not connected"} />
                <InfoRow label="Project" value={selectedRoom.projectPath} />
                <InfoRow label="Model" value={formatCodexModel(selectedCodexModel)} />
                <InfoRow label="Approval" value={approvalPolicyLabels[selectedRoom.approvalPolicy]} />
                <InfoRow label="Room keys" value={roomSecretStorageLabel()} />
                <button className="ghost-wide" onClick={chooseProjectPath} disabled={!hasSelectedRoom}>
                  <FolderGit2 size={15} />
                  Choose project folder
                </button>
              </section>

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
                        disabled={!hasSelectedRoom || settingsBusy}
                        onChange={() => toggleRoomMode(key)}
                      />
                      <span>{roomModeLabels[key]}</span>
                    </label>
                  ))}
                </div>
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
	                <button className="ghost-wide" onClick={applyTeamHistoryDefaultsToRoom} disabled={!hasSelectedRoom}>
	                  <Check size={15} />
	                  Apply team default to room
	                </button>
	              </section>

              {(appConfigMessage || settingsMessage || historyMessage) && (
                <div className="workflow-message">{appConfigMessage ?? settingsMessage ?? historyMessage}</div>
              )}
            </div>
          )}
        </aside>
      )}

      <main className="room">
        <header className="room-header">
          <div>
            <div className="crumb">
              <span>{selectedTeamName}</span>
              <ChevronDown size={14} />
            </div>
            <h1>{selectedRoom.name}</h1>
          </div>
          <div className="header-actions">
            <StatusPill icon={<Lock size={14} />} label="E2EE" tone="green" />
            <StatusPill
              icon={relayStatus === "open" ? <Wifi size={14} /> : <WifiOff size={14} />}
              label={relayStatus === "open" ? "Relay live" : `Relay ${relayStatus}`}
              tone={relayStatus === "open" ? "green" : "yellow"}
            />
            <StatusPill icon={<UsersRound size={14} />} label={`${roomMembers.length || 1} online`} tone="blue" />
            <StatusPill icon={<Bot size={14} />} label={hostStatusLabel} tone={selectedRoom.hostStatus === "active" ? "blue" : selectedRoom.hostStatus === "handoff" ? "yellow" : "muted"} />
            <div className="host-controls">
              <button onClick={() => setRoomHost("active")} disabled={!hasSelectedRoom || hostBusy || selectedRoom.hostStatus === "active"}>
                <UserRoundCheck size={14} />
                Host
              </button>
              <button onClick={() => setRoomHost("handoff")} disabled={!hasSelectedRoom || hostBusy || !isActiveHost}>
                <UsersRound size={14} />
                Handoff
              </button>
              <button onClick={() => setRoomHost("offline")} disabled={!hasSelectedRoom || hostBusy || selectedRoom.hostStatus === "offline" || !isActiveHost}>
                <X size={14} />
              </button>
            </div>
            <StatusPill
              icon={<Terminal size={14} />}
              label={codexProbe?.available ? `${formatCodexModel(selectedCodexModel)}` : "Codex not connected"}
              tone={codexProbe?.available ? "green" : "muted"}
            />
            <StatusPill icon={<Globe2 size={14} />} label={selectedRoom.mode.browser ? "Browser on" : "Browser off"} tone={selectedRoom.mode.browser ? "green" : "muted"} />
            <StatusPill icon={<FolderGit2 size={14} />} label={selectedRoom.projectPath.split("/").slice(-1)[0]} tone="dark" />
            <button className="header-copy" onClick={copyRoomMarkdown} disabled={!hasSelectedRoom}>
              <Copy size={14} />
              Markdown
            </button>
          </div>
        </header>

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

        {isSelectedRoomForgotten && (
          <div className="warning-banner local-lock-banner">
            <Lock size={18} />
            <span>This room was forgotten on this device. Paste a room invite key or get approved through a gated invite to unlock encrypted messages again.</span>
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
                onClick={() => copyMarkdownWithFallback(markdownCopyFallback.title, markdownCopyFallback.markdown, setChatMessage)}
              >
                <Copy size={14} /> Retry copy
              </button>
              <button onClick={() => setMarkdownCopyFallback(null)}>
                <X size={14} /> Dismiss
              </button>
            </div>
          </section>
        )}

        <div className="chat-scroll">
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="avatar">{message.role === "codex" ? <Bot size={17} /> : message.author.slice(0, 1)}</div>
              <div className="bubble">
                <div className="message-meta">
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
            <section className="approval-card">
              <div className="approval-title">
                <div>
                  <Bot size={19} />
                  <strong>Approve Codex turn</strong>
                </div>
                <StatusPill
                  icon={<KeyRound size={14} />}
                  label={isActiveHost ? "host-side approval" : "host locked"}
                  tone={isActiveHost ? "yellow" : "muted"}
                />
              </div>
              <div className="approval-grid">
                <ApprovalItem label="Messages" value={`${codexTurnSummary.messagesSinceLastCodex} since last Codex response`} />
                <ApprovalItem label="Attachments" value={formatCodexAttachmentSummary(codexTurnSummary.attachments)} />
                <ApprovalItem label="Workspace" value={selectedRoom.mode.workspace ? codexTurnSummary.workspacePath ?? "None" : "Disabled"} />
                <ApprovalItem label="Git" value={formatCodexGitSummary(codexTurnSummary.git)} />
                <ApprovalItem label="Browser" value={selectedRoom.mode.browser ? codexTurnSummary.browserAccess.join(", ") || "No pages shared" : "Disabled"} />
                <ApprovalItem label="Terminals" value={codexTurnSummary.terminals.join(", ") || "None"} />
                <ApprovalItem label="Model" value={formatCodexModel(selectedCodexModel)} />
                <ApprovalItem label="Thread" value={formatCodexThreadId(selectedCodexThreadId)} />
                <ApprovalItem label="Policy" value={approvalPolicyLabels[selectedRoom.approvalPolicy]} />
              </div>
              <div className="approval-actions">
                <button className="secondary" onClick={() => setApprovalVisible(false)}>
                  <X size={16} /> Deny
                </button>
	                <button className="primary" onClick={() => approveCodexTurn()} disabled={!hasSelectedRoom || codexRunning || !isActiveHost || isSelectedRoomForgotten}>
                  <Check size={16} /> {codexRunning ? "Running" : "Approve"}
                </button>
              </div>
            </section>
          )}
        </div>

        <footer className="composer">
	          <button title="Invoke Codex" onClick={() => handleCodexInvoke()} disabled={isSelectedRoomForgotten}>
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
                isSelectedRoomForgotten
                  ? "Room key forgotten on this device. Rejoin or paste an invite key to unlock."
                  : selectedRoom.mode.chat
                    ? "Message the room, or type @Codex to invoke the active host..."
                    : "Chat mode is disabled for this room"
              }
              value={draft}
              disabled={!selectedRoom.mode.chat || isSelectedRoomForgotten}
              onChange={(event) => setDraftForRoom(selectedRoom.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />
          </div>
          <button className="send" onClick={sendMessage} disabled={!selectedRoom.mode.chat || isSelectedRoomForgotten}>
            <Send size={18} />
          </button>
        </footer>
      </main>

      <aside className="inspector">
        <div className="inspector-tabs">
          <button className="active"><PanelRight size={15} /> Work</button>
          <button><Globe2 size={15} /> Browser</button>
        </div>

        <section className="panel browser-panel">
          <div className="panel-title">
            <span>Browser access</span>
            <StatusPill
              icon={<Globe2 size={13} />}
              label={selectedRoom.mode.browser ? "enabled" : "disabled"}
              tone={selectedRoom.mode.browser ? "green" : "muted"}
            />
          </div>
          <div className="browser-profile-state">
            <div>
              <strong>Room-isolated profile</strong>
              <span>{browserStatus.profilePath ?? "Created when the host opens an approved page."}</span>
            </div>
            <button onClick={resetRoomBrowserProfile} disabled={!hasSelectedRoom || !isActiveHost}>
              <RefreshCw size={13} />
              Reset
            </button>
          </div>
          <div className="browser-policy-state">
            <StatusPill
              icon={<Lock size={13} />}
              label={browserStatus.downloadsBlocked ? "Downloads blocked" : "Downloads blocked in native browser"}
              tone={browserStatus.downloadsBlocked ? "green" : "muted"}
            />
            <StatusPill
              icon={<Lock size={13} />}
              label={browserStatus.clipboardBlocked ? "Clipboard blocked" : "Clipboard blocked in native browser"}
              tone={browserStatus.clipboardBlocked ? "green" : "muted"}
            />
            <StatusPill
              icon={<Lock size={13} />}
              label={browserStatus.fileUploadsBlocked ? "File uploads blocked" : "File uploads blocked in native browser"}
              tone={browserStatus.fileUploadsBlocked ? "green" : "muted"}
            />
            <StatusPill icon={<ShieldAlert size={13} />} label="Signed-in pages are shared with room context" tone="yellow" />
          </div>
          <div className="browser-allowlist">
            <label>
              <span>Allowed sites</span>
              <textarea
                value={browserAllowedOriginsDraft}
                disabled={!hasSelectedRoom || !isActiveHost || settingsBusy}
                onChange={(event) => setBrowserAllowedOriginsDraft(event.target.value)}
                placeholder="https://github.com"
              />
            </label>
            <button
              className="ghost-wide"
              onClick={saveBrowserAllowedOrigins}
              disabled={!hasSelectedRoom || !isActiveHost || settingsBusy}
            >
              <Check size={15} />
              Save allowed sites
            </button>
          </div>
          <label>
            <span>URL</span>
            <input
              value={browserUrl}
              disabled={!hasSelectedRoom || !selectedRoom.mode.browser}
              onChange={(event) => setBrowserUrl(event.target.value)}
              placeholder="https://github.com/maddiedreese/multAIplayer"
            />
          </label>
          <label>
            <span>Reason</span>
            <textarea
              value={browserReason}
              disabled={!hasSelectedRoom || !selectedRoom.mode.browser}
              onChange={(event) => setBrowserReason(event.target.value)}
              placeholder="Why should Codex use this page?"
            />
          </label>
          <button
            className="primary-wide"
            onClick={requestBrowserAccess}
            disabled={!hasSelectedRoom || !selectedRoom.mode.browser || !browserUrl.trim()}
          >
            <Globe2 size={15} />
            Request browser access
          </button>
          <div className="browser-requests">
            {browserRequests.slice(-4).reverse().map((request) => (
              <div className={`browser-request ${request.status}`} key={request.id}>
                <div>
                  <strong>{formatBrowserAccessLabel(request.url)}</strong>
                  <span>{request.reason}</span>
                  <small>{request.requester}</small>
                </div>
                <small>{request.status}</small>
                {request.status === "pending" && (
                  <div>
                    <button onClick={() => approveBrowserRequest(request)} disabled={!hasSelectedRoom || !isActiveHost}>
                      <Check size={13} />
                    </button>
                    <button onClick={() => denyBrowserRequest(request.id)} disabled={!hasSelectedRoom || !isActiveHost}>
                      <X size={13} />
                    </button>
                  </div>
                )}
                {request.status === "approved" && (
                  <div>
                    <button onClick={() => openApprovedBrowserRequest(request)} title="Open approved room browser" disabled={!hasSelectedRoom || !isActiveHost}>
                      <ExternalLink size={13} />
                    </button>
                  </div>
                )}
                {detectBrowserSecretRisks(request.url).length > 0 && (
                  <InlineSecretWarning
                    risks={detectBrowserSecretRisks(request.url)}
                    compact
                    detail="Opening this page can expose a signed-in browser session to room context and Codex actions."
                  />
                )}
              </div>
            ))}
            {browserRequests.length === 0 && (
              <div className="empty-state compact">No browser requests in this room.</div>
            )}
          </div>
          {browserMessage && <div className="workflow-message">{browserMessage}</div>}
        </section>

        <section className="panel">
          <div className="panel-title">
            <span>Project</span>
            <StatusPill icon={<GitBranch size={13} />} label={gitStatus?.branch ?? "loading"} tone="dark" />
          </div>
          <div className="project-card">
            <FolderGit2 size={18} />
            <div>
              <strong>multAIplayer</strong>
              <span>{selectedRoom.projectPath}</span>
            </div>
          </div>
          <div className="project-path-editor">
            <label>
              <span>Local folder</span>
              <input
                value={projectPathDraft}
                disabled={!hasSelectedRoom || settingsBusy || !isActiveHost}
                onChange={(event) => setProjectPathDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    updateProjectPath();
                  }
                }}
              />
            </label>
            <div>
              <button className="ghost-wide" onClick={chooseProjectPath} disabled={!hasSelectedRoom || settingsBusy || !isActiveHost}>
                <FolderGit2 size={15} />
                Choose folder
              </button>
              <button className="ghost-wide" onClick={() => setProjectPathDraft(defaultProjectPath)} disabled={!hasSelectedRoom || settingsBusy || !isActiveHost}>
                <FolderGit2 size={15} />
                Current repo
              </button>
              <button
                className="primary-wide"
                onClick={updateProjectPath}
                disabled={!hasSelectedRoom || settingsBusy || !isActiveHost || !projectPathDraft.trim() || projectPathDraft.trim() === selectedRoom.projectPath}
              >
                <Check size={15} />
                Attach
              </button>
            </div>
          </div>
        </section>

        <section className="panel members-panel">
          <div className="panel-title">
            <span>Members</span>
            <StatusPill icon={<UsersRound size={13} />} label={`${roomMembers.length || 1} online`} tone="blue" />
          </div>
          <div className="member-list">
            {(roomMembers.length ? roomMembers : [{
              userId: localUser.id,
              deviceId,
              displayName: localUser.name,
              avatarUrl: localUser.avatarUrl,
              publicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
              status: "online" as const
            }]).map((member) => {
              const trusted = isDeviceKeyTrusted(
                trustedDeviceKeys,
                selectedRoom.id,
                member.deviceId,
                member.publicKeyFingerprint
              );
              return (
                <div className="member-row" key={member.deviceId}>
                  {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <span>{member.displayName.slice(0, 1)}</span>}
                  <div>
                    <strong>{member.displayName}</strong>
                    <small>{formatMemberDeviceLabel(member, deviceId, trusted)}</small>
                  </div>
                  <div className="member-badges">
                    {isRoomHostMember(member, selectedRoom) && <b>host</b>}
                    <b className={member.publicKeyFingerprint ? trusted ? "trusted" : "verified" : "warning"}>
                      {member.publicKeyFingerprint ? trusted ? "trusted" : "keyed" : "unregistered"}
                    </b>
                    {member.publicKeyFingerprint && member.deviceId !== deviceId && (
                      trusted ? (
                        <button onClick={() => untrustRoomMemberDevice(member)}>Untrust</button>
                      ) : (
                        <button onClick={() => trustRoomMemberDevice(member)}>Trust</button>
                      )
                    )}
                  </div>
                  <i />
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel handoff-panel">
          <div className="panel-title">
            <span>Host handoff</span>
            <StatusPill
              icon={<UserRoundCheck size={13} />}
              label={hostHandoffs.some((handoff) => handoff.status === "available") ? "available" : "none"}
              tone={hostHandoffs.some((handoff) => handoff.status === "available") ? "yellow" : "muted"}
            />
          </div>
          <div className="handoff-list">
            {hostHandoffs.slice(-3).reverse().map((handoff) => (
              <div className={`handoff-row ${handoff.status}`} key={handoff.id}>
                <div>
                  <strong>{handoff.fromHost}</strong>
                  <span>{handoff.messagesSinceLastCodex} messages · {handoff.attachmentNames.length} attachments · {handoff.terminals.length} terminals</span>
                  <small>{handoff.projectPath} · {formatCodexModel(handoff.codexModel)}</small>
                </div>
                {handoff.status === "available" ? (
                  <button onClick={() => acceptHostHandoff(handoff)} disabled={!hasSelectedRoom || hostBusy}>
                    <Check size={13} />
                    Accept
                  </button>
                ) : (
                  <b>{handoff.status}</b>
                )}
              </div>
            ))}
            {hostHandoffs.length === 0 && (
              <div className="empty-state compact">No host handoff package for this room.</div>
            )}
          </div>
        </section>

        <section className="panel invite-panel">
          <div className="panel-title">
            <span>Encrypted invite</span>
            <StatusPill
              icon={<Lock size={13} />}
              label={inviteApprovalGate ? "approval key delivery" : "fragment key"}
              tone={inviteApprovalGate ? "blue" : "green"}
            />
          </div>
          <button className="primary-wide" onClick={copyInviteLink} disabled={!hasSelectedRoom}>
            <Copy size={15} />
            Copy room invite
          </button>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={inviteApprovalGate}
              disabled={!hasSelectedRoom}
              onChange={(event) => setInviteApprovalGate(event.target.checked)}
            />
            <span>Ask host to approve joiners</span>
          </label>
          <label>
            <span>Join from invite link or key</span>
            <textarea
              value={inviteSecretInput}
              onChange={(event) => setInviteSecretInput(event.target.value)}
              placeholder="Paste a multAIplayer invite..."
            />
          </label>
          <button className="ghost-wide" onClick={joinInviteSecret} disabled={!inviteSecretInput.trim()}>
            <KeyRound size={15} />
            Import invite
          </button>
          <div className="terminal-requests">
            {inviteRequests.slice(-4).reverse().map((request) => (
              <div className={`terminal-request ${request.status}`} key={request.id}>
                <div>
                  <strong>{request.requester}</strong>
                  <span>{request.note ?? "Requesting room access."}</span>
                  <small>{request.requesterDeviceId === deviceId ? "This device" : request.requesterDeviceId}</small>
                </div>
                <small>{request.status}</small>
                {request.status === "pending" && (
                  <div>
                    <button onClick={() => decideInviteJoinRequest(request, "approved")} disabled={!hasSelectedRoom || !isActiveHost}>
                      <Check size={13} />
                    </button>
                    <button onClick={() => decideInviteJoinRequest(request, "denied")} disabled={!hasSelectedRoom || !isActiveHost}>
                      <X size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {inviteRequests.length === 0 && (
              <div className="empty-state compact">No invite approval requests in this room.</div>
            )}
          </div>
          {inviteLink && <div className="invite-link">{inviteLink}</div>}
          {inviteMessage && <div className="workflow-message">{inviteMessage}</div>}
        </section>

        <section className="panel policy-panel">
          <div className="panel-title">
            <span>Approval policy</span>
            <StatusPill icon={<KeyRound size={13} />} label="host-side" tone="yellow" />
          </div>
          <div className="policy-options">
            {(Object.keys(approvalPolicyLabels) as ApprovalPolicy[]).map((policy) => (
              <button
                key={policy}
                className={selectedRoom.approvalPolicy === policy ? "active" : ""}
                onClick={() => setApprovalPolicy(policy)}
                disabled={!hasSelectedRoom || settingsBusy || !isActiveHost}
              >
                {approvalPolicyLabels[policy]}
              </button>
            ))}
          </div>
          {settingsMessage && <div className="workflow-message">{settingsMessage}</div>}
        </section>

        <section className="panel mode-panel">
          <div className="panel-title">
            <span>Room modes</span>
            <StatusPill icon={<Settings size={13} />} label="per room" tone="dark" />
          </div>
          <div className="mode-options">
            {(Object.keys(roomModeLabels) as Array<keyof RoomMode>).map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={selectedRoom.mode[key]}
                  disabled={!hasSelectedRoom || settingsBusy || !isActiveHost}
                  onChange={() => toggleRoomMode(key)}
                />
                <span>{roomModeLabels[key]}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel model-panel">
          <div className="panel-title">
            <span>Model</span>
            <StatusPill icon={<Bot size={13} />} label={formatCodexModel(selectedCodexModel)} tone="blue" />
          </div>
          <label>
            <span>Codex host model</span>
            <select
              value={codexModelOptions.some((option) => option.id === selectedCodexModel) ? selectedCodexModel : "custom"}
              disabled={!hasSelectedRoom || settingsBusy || !isActiveHost}
              onChange={(event) => {
                if (event.target.value !== "custom") {
                  setCodexModel(event.target.value);
                }
              }}
            >
              {codexModelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            <span>Custom model id</span>
            <input
              value={customCodexModel}
              disabled={!hasSelectedRoom || settingsBusy || !isActiveHost}
              onChange={(event) => setCustomCodexModel(event.target.value)}
              onBlur={() => setCodexModel(customCodexModel)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setCodexModel(customCodexModel);
                }
              }}
            />
          </label>
          <div className="model-options">
            {codexModelOptions.map((option) => (
              <button
                key={option.id}
                className={selectedCodexModel === option.id ? "active" : ""}
                disabled={!hasSelectedRoom || settingsBusy || !isActiveHost}
                onClick={() => setCodexModel(option.id)}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel history-panel">
          <div className="panel-title">
            <span>Local history</span>
            <StatusPill
              icon={<Lock size={13} />}
              label={historySettings.enabled ? `${historySettings.retentionDays} days` : "off"}
              tone={historySettings.enabled ? "green" : "muted"}
            />
          </div>
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
            <span>Save encrypted local room history</span>
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
	          <div className="history-defaults">
	            <div>
	              <strong>Team default</strong>
	              <span>{teamHistorySettings.enabled ? `${teamHistorySettings.retentionDays} days for new rooms` : "off for new rooms"}</span>
	            </div>
	            <button className="ghost-wide" onClick={applyTeamHistoryDefaultsToRoom} disabled={!hasSelectedRoom}>
	              <Check size={15} />
	              Apply to room
	            </button>
	          </div>
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
	            <span>Save encrypted history in new rooms for this team</span>
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
	          {historyMessage && <div className="workflow-message">{historyMessage}</div>}
	        </section>

        <section className="panel">
          <div className="panel-title">
            <span>Files</span>
            <button className="ghost" onClick={copyProjectMarkdown} disabled={!hasSelectedRoom}><Copy size={14} /> Markdown</button>
          </div>
          <label className="file-search">
            <Search size={14} />
            <input
              value={fileQuery}
              onChange={(event) => setFileQuery(event.target.value)}
              placeholder="Search project files"
            />
          </label>
          <div className="file-list">
            {projectFiles.map((file) => (
              <button
                className={selectedFile?.path === file.path ? "file-row active" : "file-row"}
                key={file.path}
                onClick={() => openProjectFile(file.path)}
              >
                <FileCode2 size={15} />
                <span>{file.path}</span>
                <small>{formatBytes(file.size)}</small>
              </button>
            ))}
            {!fileBusy && projectFiles.length === 0 && (
              <div className="empty-state">No files match this search.</div>
            )}
          </div>
          {fileBusy && <div className="empty-state">Loading project files...</div>}
          {fileMessage && <div className="workflow-message">{fileMessage}</div>}
        </section>

        <section className="panel">
          <div className="panel-title">
            <span>Changed files</span>
            <div className="panel-title-actions">
              <button className="ghost" onClick={copyDiffSummaryMarkdown} disabled={!hasSelectedRoom}>
                <Copy size={14} /> Summary
              </button>
              <StatusPill icon={<Code2 size={13} />} label={`${gitStatus?.files.length ?? 0}`} tone="dark" />
            </div>
          </div>
          <div className="diff-list">
            {(gitStatus?.files.length ? gitStatus.files : []).map((file) => (
              <button className="diff-row" key={file.path} onClick={() => openProjectFile(file.path)}>
                <FileCode2 size={15} />
                <span>{file.path}</span>
                <small><b>+{file.added}</b> <i>-{file.removed}</i></small>
              </button>
            ))}
            {gitStatus?.files.length === 0 && (
              <div className="empty-state">No local file changes in this project.</div>
            )}
          </div>
        </section>

        <section className="panel diff-preview">
          <div className="panel-title">
            <span>{selectedFile ? selectedFile.path.split("/").at(-1) : "File preview"}</span>
            <div className="panel-title-actions">
              {selectedFile && (
                <button
                  className={selectedFileNeedsAttachmentReview && selectedSensitiveFileReviewed ? "ghost danger" : "ghost"}
                  onClick={attachSelectedFileToMessage}
                  disabled={!hasSelectedRoom}
                >
                  {selectedFileNeedsAttachmentReview && !selectedSensitiveFileReviewed ? <ShieldAlert size={14} /> : <Plus size={14} />}
                  {selectedAttachmentReview?.actionLabel ?? "Attach"}
                </button>
              )}
              <StatusPill
                icon={<Code2 size={13} />}
                label={selectedFile?.truncated ? "truncated" : selectedFile ? formatBytes(selectedFile.size) : "select file"}
                tone={selectedFile?.truncated ? "yellow" : "green"}
              />
            </div>
          </div>
          {selectedFileRisks.length > 0 && (
            <InlineSecretWarning
              risks={selectedFileRisks}
              detail={selectedAttachmentReview?.warningDetail ?? undefined}
            />
          )}
          {selectedDiff?.diff.trim() ? (
            <div className="diff-code" aria-label={`Diff for ${selectedDiff.path}`}>
              {parseDiffLines(selectedDiff.diff).map((line, index) => (
                <div className={`diff-code-line ${line.kind}`} key={`${index}-${line.text}`}>
                  <span>{line.prefix || " "}</span>
                  <code>{line.text}</code>
                </div>
              ))}
            </div>
          ) : (
            <pre>
              <code>
{selectedFile?.content ?? "Select a file or changed path to preview it here."}
              </code>
            </pre>
          )}
        </section>

        <section className="panel git-approval-panel">
          <div className="panel-title">
            <span>GitHub handoff</span>
            <StatusPill icon={<ShieldAlert size={13} />} label="approval required" tone="yellow" />
          </div>
          <label>
            <span>Branch</span>
            <input value={gitBranchName} onChange={(event) => setGitBranchName(event.target.value)} />
          </label>
          <label>
            <span>Commit message</span>
            <input value={gitCommitMessage} onChange={(event) => setGitCommitMessage(event.target.value)} />
          </label>
          <div className="repo-grid">
            <label>
              <span>Owner</span>
              <input value={prOwner} onChange={(event) => setPrOwner(event.target.value)} />
            </label>
            <label>
              <span>Repo</span>
              <input value={prRepo} onChange={(event) => setPrRepo(event.target.value)} />
            </label>
            <label>
              <span>Base</span>
              <input value={prBase} onChange={(event) => setPrBase(event.target.value)} />
            </label>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={gitPushEnabled}
              onChange={(event) => setGitPushEnabled(event.target.checked)}
            />
            <span>Push branch and open draft PR</span>
          </label>
          <div className="git-approval-preview">
            <strong>Host will approve</strong>
            {gitApprovalPreview.error ? (
              <div className="workflow-message danger">{gitApprovalPreview.error}</div>
            ) : (
              gitApprovalPreview.steps.map((step) => (
                <div className="git-approval-step" key={step.title}>
                  <span>{step.title}</span>
                  <small>{step.detail}</small>
                  {step.commands.map((command) => (
                    <code key={command}>{command}</code>
                  ))}
                </div>
              ))
            )}
            {gitPushEnabled && !gitApprovalPreview.error && (
              <small>Draft PR target: {githubWorkflowReadiness.target ?? `${prOwner}/${prRepo} to ${githubWorkflowReadiness.normalizedBase || "main"}`}</small>
            )}
          </div>
          {gitPushEnabled && (
            <div className={`workflow-message ${githubWorkflowReadiness.ready ? "" : "danger"}`}>
              {githubWorkflowReadiness.messages.join(" ")}
            </div>
          )}
          <button className="ghost-wide" onClick={copyPullRequestDraftMarkdown} disabled={!hasSelectedRoom}>
            <Copy size={15} />
            Copy PR draft
          </button>
          <button
            className="primary-wide"
            onClick={approveGitWorkflow}
            disabled={!hasSelectedRoom || gitWorkflowBusy || !isActiveHost || Boolean(gitApprovalPreview.error) || (gitPushEnabled && !githubWorkflowReadiness.ready)}
          >
            <Github size={15} />
            {gitWorkflowBusy ? "Running approved git workflow" : "Approve git workflow"}
          </button>
          {gitWorkflowMessage && <div className="workflow-message">{gitWorkflowMessage}</div>}
        </section>

        <section className="panel actions-panel">
          <div className="panel-title">
            <span>GitHub Actions</span>
            <div className="panel-title-actions">
              <StatusPill icon={<Github size={13} />} label={actionsSummary.label} tone={actionsSummary.tone} />
              <button className="ghost" onClick={() => refreshGitHubActions()} disabled={!hasSelectedRoom || actionsBusy || !currentUser}>
                <RefreshCw size={14} />
                {actionsBusy ? "Checking" : "Refresh"}
              </button>
            </div>
          </div>
          <div className={`actions-summary ${actionsSummary.tone}`}>
            <strong>{actionsSummary.detail}</strong>
            <span>
              {prOwner}/{prRepo} · {gitBranchName || "branch required"}
              {actionsLastChecked ? ` · checked ${formatTimestamp(actionsLastChecked)}` : ""}
            </span>
          </div>
          <div className="actions-list">
            {actionRuns.map((run) => (
              <a href={run.url} target="_blank" rel="noreferrer" className={`action-run ${run.conclusion ?? run.status}`} key={run.id}>
                <span className={`run-dot ${run.conclusion ?? run.status}`} />
                <div>
                  <strong>{run.displayTitle ?? run.name}</strong>
                  <small>
                    {run.name}
                    {run.runNumber ? ` #${run.runNumber}` : ""} · {run.status}
                    {run.conclusion ? ` / ${run.conclusion}` : ""} · {run.event ?? "event unknown"} · {formatTimestamp(run.updatedAt)}
                  </small>
                </div>
                <ExternalLink size={13} />
              </a>
            ))}
            {!actionsBusy && actionRuns.length === 0 && (
              <div className="empty-state">
                {currentUser ? "No GitHub Actions runs loaded." : "Sign in with GitHub to check workflow runs."}
              </div>
            )}
          </div>
          {actionsMessage && <div className="workflow-message">{actionsMessage}</div>}
        </section>

        <section className="panel terminal-panel">
          <div className="panel-title">
            <span>Terminals</span>
            <div className="panel-title-actions">
              <button className="ghost" onClick={copyTerminalMarkdown} disabled={!hasSelectedRoom}>
                <Copy size={14} /> Markdown
              </button>
              <button className="ghost" onClick={runApprovedTerminalCheck} disabled={!hasSelectedRoom || terminalBusy || !isActiveHost}>
                <Play size={14} /> {terminalBusy ? "running" : "git status"}
              </button>
            </div>
          </div>
          <div className="terminal-launcher">
            <input
              value={terminalName}
              onChange={(event) => setTerminalName(event.target.value)}
              placeholder="name"
            />
            <input
              value={terminalCommand}
              onChange={(event) => setTerminalCommand(event.target.value)}
              placeholder="command"
            />
            <button onClick={startNamedTerminal} disabled={!hasSelectedRoom || terminalBusy || !isActiveHost || !terminalName.trim() || !terminalCommand.trim()}>
              <Play size={14} />
            </button>
            <button onClick={requestTerminalCommand} disabled={!hasSelectedRoom || !terminalCommand.trim()}>
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
                      <button onClick={() => approveTerminalRequest(request)} disabled={!hasSelectedRoom || terminalBusy || !isActiveHost}>
                        <Check size={13} />
                      </button>
                      <button onClick={() => denyTerminalRequest(request.id)} disabled={!hasSelectedRoom || terminalBusy || !isActiveHost}>
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
          {terminals.length > 0 && (
            <div className="terminal-tabs">
              {terminals.map((terminal) => (
                <button
                  key={terminal.id}
                  className={terminal.id === selectedTerminalId ? "active" : ""}
                  onClick={() => setSelectedTerminalId(terminal.id)}
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
                onChange={(event) => setTerminalInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    sendTerminalInput();
                  }
                }}
                placeholder={`Send input to ${selectedTerminal.name}`}
                disabled={!hasSelectedRoom || !selectedTerminal.running || !isActiveHost}
              />
              <button onClick={sendTerminalInput} disabled={!hasSelectedRoom || !selectedTerminal.running || !isActiveHost || !terminalInput.trim()}>
                <Send size={14} />
              </button>
              <button onClick={stopSelectedTerminal} disabled={!hasSelectedRoom || !selectedTerminal.running || terminalBusy || !isActiveHost}>
                <X size={14} />
              </button>
            </div>
          )}
          {terminalError && <div className="workflow-message">{terminalError}</div>}
        </section>
      </aside>
    </div>
  );
}

function ApprovalItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="approval-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InlineSecretWarning({ risks, compact = false, detail }: { risks: string[]; compact?: boolean; detail?: string }) {
  return (
    <div className={`inline-secret-warning ${compact ? "compact" : ""}`}>
      <ShieldAlert size={compact ? 14 : 16} />
      <span>
        {Array.from(new Set(risks)).join(", ")} may expose secrets to everyone in this room.
        {detail ? ` ${detail}` : ""}
      </span>
    </div>
  );
}

function StatusPill({
  icon,
  label,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  tone: "green" | "blue" | "yellow" | "red" | "dark" | "muted";
}) {
  return (
    <span className={`status-pill ${tone}`}>
      {icon}
      {label}
    </span>
  );
}

function searchMatches(values: string[], query: string): boolean {
  return values.some((value) => value.toLowerCase().includes(query));
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
    browserAllowedOrigins: normalizeBrowserAllowedOrigins(room.browserAllowedOrigins ?? defaultBrowserAllowedOrigins) ?? defaultBrowserAllowedOrigins
  };
}

function formatCodexModel(model: string): string {
  return codexModelOptions.find((option) => option.id === model)?.label ?? model;
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
    version: 2,
    messages: payload.messages.filter((message) => isWithinRetention(message.createdAt ?? message.time, cutoffMs)),
    terminalRequests: payload.terminalRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    browserRequests: payload.browserRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    inviteRequests: payload.inviteRequests.filter((request) => isWithinRetention(request.requestedAt, cutoffMs)),
    codexEvents: payload.codexEvents.filter((event) => isWithinRetention(event.createdAt, cutoffMs)),
    hostHandoffs: payload.hostHandoffs.filter((handoff) => isWithinRetention(handoff.createdAt, cutoffMs))
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
      version: 2,
      messages: value.map((message) => normalizeChatMessage(message) as ChatMessage | null).filter((message): message is ChatMessage => message !== null),
      terminalRequests: [],
      browserRequests: [],
      inviteRequests: [],
      codexEvents: [],
      hostHandoffs: []
    };
  }

  const codexThreadId = normalizeCodexThreadId(value.codexThreadId);
  return {
    version: 2,
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

function parseDiffLines(diff: string): Array<{ kind: "added" | "removed" | "hunk" | "meta" | "context"; prefix: string; text: string }> {
  return diff.split("\n").map((line) => {
    if (line.startsWith("@@")) return { kind: "hunk", prefix: "", text: line };
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) {
      return { kind: "meta", prefix: "", text: line };
    }
    if (line.startsWith("+")) return { kind: "added", prefix: "+", text: line.slice(1) };
    if (line.startsWith("-")) return { kind: "removed", prefix: "-", text: line.slice(1) };
    return { kind: "context", prefix: line.startsWith(" ") ? " " : "", text: line.startsWith(" ") ? line.slice(1) : line };
  });
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
