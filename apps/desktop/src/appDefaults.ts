import type { ApprovalPolicy } from "@multaiplayer/protocol";

export const approvalPolicyLabels: Record<ApprovalPolicy, string> = {
  ask_every_turn: "Ask every Codex turn",
  never_host: "Disable Codex in this room"
};

export const maxTerminalActivityLines = 1000;

export const defaultBrowserUrl = "";
export const defaultBrowserReason = "Use this page as Codex browser context.";
