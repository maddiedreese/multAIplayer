import type {
  BrowserRequestPlaintextPayload,
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  CodexEventPlaintextPayload,
  CodexActivityPlaintextPayload,
  CodexTurnSummary,
  DevicePublicKeyJwk as DevicePublicKeyJwkType,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  HostHandoffPlaintextPayload,
  InviteJoinRequestPlaintextPayload,
  LocalPreviewPlaintextPayload,
  TerminalRequestPlaintextPayload,
  WorkspaceFileSaveRequestPlaintextPayload
} from "@multaiplayer/protocol";
import type { TerminalSnapshot } from "./lib/localBackend";
import type { CodexTurnRiskFlag } from "./lib/codexTurn";
import type { LocalPreviewCandidate } from "./lib/localPreview";
import type { SidebarPanelName } from "./components/DesktopSidebar";

export interface ChatMessage {
  id: string;
  author: string;
  authorUserId?: string;
  role: "human" | "codex" | "system";
  body: string;
  time: string;
  createdAt?: string;
  editedAt?: string;
  editedByUserId?: string;
  deletedAt?: string;
  deletedBy?: string;
  deletedByUserId?: string;
  replyTo?: string;
  attachments?: ChatAttachment[];
  reactions?: ChatReaction[];
}

export interface ChatReaction {
  emoji: string;
  reactors: Array<{ userId: string; name: string }>;
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  content?: string;
  blobId?: string;
  blobBytes?: number;
  truncated?: boolean;
}

export interface RoomGoal {
  id: string;
  text: string;
  status: "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  tokensUsed?: number;
  tokenBudget?: number | null;
}

export interface PendingCodexApproval {
  turnId: string;
  roomId: string;
  requestedBy: string;
  requestedByUserId: string;
  queuedAt: string;
  messages: ChatMessage[];
  summary: CodexTurnSummary;
  riskFlags?: CodexTurnRiskFlag[];
}

export interface QueuedCodexTurn {
  turnId: string;
  roomId: string;
  requestedBy: string;
  requestedByUserId: string;
  queuedAt: string;
  triggerMessageId?: string;
}

export interface RoomPresence {
  userId: string;
  deviceId: string;
  displayName: string;
  avatarUrl?: string;
  publicKeyFingerprint?: string;
  status: "online" | "offline";
}

export interface TerminalCommandRequest extends TerminalRequestPlaintextPayload {
  status: "pending" | "approved" | "denied";
}

export interface BrowserAccessRequest extends BrowserRequestPlaintextPayload {
  status: "pending" | "approved" | "denied";
}

export interface WorkspaceFileSaveRequest extends WorkspaceFileSaveRequestPlaintextPayload {
  status: "pending" | "approved" | "denied";
}

export interface BrowserStatus {
  profilePath: string | null;
  downloadsBlocked: boolean;
  clipboardBlocked: boolean;
  fileUploadsBlocked: boolean;
}

export interface InviteJoinRequest extends InviteJoinRequestPlaintextPayload {
  status: "pending" | "approved" | "denied";
}

export type CodexRoomEvent = CodexEventPlaintextPayload;
export type CodexActivity = CodexActivityPlaintextPayload;

export interface CodexThreadGraphNode {
  id: string;
  sessionId?: string;
  parentThreadId?: string;
  title: string;
  status: "notLoaded" | "idle" | "systemError" | "active" | "unknown";
  createdAt: number;
  updatedAt: number;
}

export interface CodexThreadGraph {
  activeThreadId: string | null;
  nodesById: Record<string, CodexThreadGraphNode>;
}

export interface CodexAgentTreeNode {
  id: string;
  parentId: string | null;
  status: CodexActivity["status"];
  lastAction: NonNullable<CodexActivity["agent"]>["action"];
  updatedAt: string;
}

export interface HostHandoffRecord extends HostHandoffPlaintextPayload {
  status: "available" | "accepted";
}

export type LocalPreviewRecord = LocalPreviewPlaintextPayload;

export interface LocalPreviewDialogState {
  open: boolean;
  phase: "select" | "confirm" | "install" | "starting";
  roomId: string;
  candidates: LocalPreviewCandidate[];
  selectedUrl: string;
  manualUrl: string;
  error: string | null;
  cloudflaredVersion: string | null;
}

export interface MarkdownCopyFallback {
  title: string;
  markdown: string;
}

export interface NoSecretRoomInvite {
  version: 3;
  teamId: string;
  roomId: string;
  roomName: string;
  inviteCapability: string;
  keyEpoch: number;
  hostUserId: string;
  hostDeviceId: string;
  hostPublicKeyJwk: DevicePublicKeyJwkType;
  hostPublicKeyFingerprint: string;
}

export interface LocalRoomHistoryPayload {
  version: 3;
  messages: ChatMessage[];
  chatEdits?: ChatEditPlaintextPayload[];
  chatDeletes?: ChatDeletePlaintextPayload[];
  readState?: LocalRoomReadState;
  terminalRequests: TerminalCommandRequest[];
  fileSaveRequests: WorkspaceFileSaveRequest[];
  browserRequests: BrowserAccessRequest[];
  inviteRequests: InviteJoinRequest[];
  codexEvents: CodexRoomEvent[];
  /** Added additively in v3; absent legacy payloads migrate to an empty timeline. */
  codexActivities?: CodexActivity[];
  gitWorkflowEvents: GitWorkflowEventPlaintextPayload[];
  githubActionsEvents: GitHubActionsEventPlaintextPayload[];
  localPreviews: LocalPreviewRecord[];
  terminalSnapshots: TerminalSnapshot[];
  hostHandoffs: HostHandoffRecord[];
  queuedCodexTurns?: QueuedCodexTurn[];
  roomGoal?: RoomGoal;
  codexThreadId?: string;
  codexThreadGraph?: CodexThreadGraph;
}

export interface LocalRoomReadState {
  lastReadMessageId?: string;
  unread: number;
}

export type RelayStatus = "connecting" | "open" | "closed" | "error";
export type SidebarPanel = SidebarPanelName;
