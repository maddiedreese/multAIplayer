import type { ApprovalPolicy, RoomMode } from "@multaiplayer/protocol";
import type { BrowserStatus } from "./types";

export const approvalPolicyLabels: Record<ApprovalPolicy, string> = {
  ask_every_turn: "Ask every Codex turn",
  never_host: "Never host this room"
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
