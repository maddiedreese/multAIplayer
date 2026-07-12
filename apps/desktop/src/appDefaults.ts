import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed,
  defaultRoomMode,
  type ApprovalDelegationPolicy,
  type ApprovalPolicy,
  type RoomMode,
  type RoomRecord
} from "@multaiplayer/protocol";
import type { BrowserStatus } from "./types";

export const emptyRoom: RoomRecord = {
  id: "__empty-room",
  teamId: "__empty-team",
  name: "No room selected",
  projectPath: "",
  host: "No host",
  hostStatus: "offline",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: defaultRoomMode,
  codexModel: defaultCodexModel,
  codexReasoningEffort: defaultCodexReasoningEffort,
  codexSpeed: defaultCodexSpeed,
  codexSandboxLevel: defaultCodexSandboxLevel,
  browserAllowedOrigins: defaultBrowserAllowedOrigins,
  browserProfilePersistent: defaultBrowserProfilePersistent,
  unread: 0
};

export const approvalPolicyLabels: Record<ApprovalPolicy, string> = {
  ask_every_turn: "Ask every Codex turn",
  auto_chat_only: "Ask every Codex turn",
  auto_browser_allowed_sites: "Ask every Codex turn",
  never_host: "Never host this room"
};

export const approvalDelegationPolicyLabels: Record<ApprovalDelegationPolicy, string> = {
  host_only: "Host only",
  members_can_request: "Members can request, host approves",
  members_can_approve: "Legacy member approval",
  trusted_members_only: "Legacy trusted approval"
};

export const roomModeLabels: Record<keyof RoomMode, string> = {
  chat: "Chat",
  code: "Code",
  workspace: "Workspace",
  browser: "Browser"
};

export const maxTerminalActivityLines = 1000;

export const defaultBrowserStatus: BrowserStatus = {
  profilePath: null,
  downloadsBlocked: false,
  clipboardBlocked: false,
  fileUploadsBlocked: false
};

export const defaultBrowserUrl = "";
export const defaultBrowserReason = "Use this page as Codex browser context.";
