import type {
  BrowserRequestPlaintextPayload,
  CodexEventPlaintextPayload,
  CodexTurnSummary,
  DevicePublicKeyJwk as DevicePublicKeyJwkType,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  HostHandoffPlaintextPayload,
  InviteJoinRequestPlaintextPayload,
  LocalPreviewPlaintextPayload,
  TerminalRequestPlaintextPayload
} from "@multaiplayer/protocol";
import type { TerminalSnapshot } from "./lib/localBackend";
import type { CodexTurnRiskFlag } from "./lib/codexTurn";
import type { LocalPreviewCandidate } from "./lib/localPreview";
import type { SidebarPanelName } from "./components/DesktopSidebar";

export interface ChatMessage {
  id: string;
  author: string;
  role: "human" | "codex" | "system";
  body: string;
  time: string;
  createdAt?: string;
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
  status: "running" | "paused";
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
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

export interface BrowserStatus {
  profilePath: string | null;
  downloadsBlocked: boolean;
  clipboardBlocked: boolean;
  fileUploadsBlocked: boolean;
}

export interface InviteJoinRequest extends InviteJoinRequestPlaintextPayload {
  status: "pending" | "approved" | "denied";
}

export interface CodexRoomEvent extends CodexEventPlaintextPayload {}

export interface HostHandoffRecord extends HostHandoffPlaintextPayload {
  status: "available" | "accepted";
}

export interface LocalPreviewRecord extends LocalPreviewPlaintextPayload {}

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
  version: 1;
  teamId: string;
  roomId: string;
  roomName: string;
  hostDeviceId: string;
  hostPublicKeyJwk: DevicePublicKeyJwkType;
  hostPublicKeyFingerprint: string;
}

export interface LocalRoomHistoryPayload {
  version: 3;
  messages: ChatMessage[];
  readState?: LocalRoomReadState;
  terminalRequests: TerminalCommandRequest[];
  browserRequests: BrowserAccessRequest[];
  inviteRequests: InviteJoinRequest[];
  codexEvents: CodexRoomEvent[];
  gitWorkflowEvents: GitWorkflowEventPlaintextPayload[];
  githubActionsEvents: GitHubActionsEventPlaintextPayload[];
  localPreviews: LocalPreviewRecord[];
  terminalSnapshots: TerminalSnapshot[];
  hostHandoffs: HostHandoffRecord[];
  codexThreadId?: string;
}

export interface LocalRoomReadState {
  lastReadMessageId?: string;
  unread: number;
}

export type RelayStatus = "connecting" | "open" | "closed" | "error";
export type SidebarPanel = SidebarPanelName;
