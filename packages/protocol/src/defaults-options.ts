export type ApprovalPolicy =
  | "ask_every_turn"
  | "auto_chat_only"
  | "auto_browser_allowed_sites"
  | "never_host";

export type ApprovalDelegationPolicy =
  | "host_only"
  | "members_can_request"
  | "members_can_approve"
  | "trusted_members_only";

export const defaultApprovalDelegationPolicy: ApprovalDelegationPolicy = "host_only";
export const defaultCodexModel = "gpt-5.5";
export const defaultCodexReasoningEffort = "medium";
export const defaultCodexSpeed = "standard";
export const defaultCodexSandboxLevel = "workspace_write";
export const defaultBrowserAllowedOrigins = ["https://github.com"];
export const defaultBrowserProfilePersistent = true;

export const codexModelOptions = [
  { id: "gpt-5.5", label: "GPT-5.5", description: "Current frontier Codex model for complex coding, research, and real-world work." },
  { id: "gpt-5.5-cyber", label: "GPT-5.5 Cyber", description: "Specialized Codex model for eligible cyber and security workflows." },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "Codex model used for review-oriented software work." },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", description: "Research-preview Codex model for smaller coding turns." }
] as const;

export const codexReasoningEffortOptions = [
  { id: "none", label: "None", description: "No extra reasoning budget for direct, mechanical turns" },
  { id: "minimal", label: "Minimal", description: "Smallest supported reasoning budget for simple edits and quick checks" },
  { id: "low", label: "Low", description: "Fast responses with lighter reasoning" },
  { id: "medium", label: "Medium", description: "Balances speed and reasoning depth for everyday tasks" },
  { id: "high", label: "High", description: "Greater reasoning depth for complex problems" },
  { id: "xhigh", label: "Extra high", description: "Extra high reasoning depth for complex problems" }
] as const;

export const codexSpeedOptions = [
  { id: "standard", label: "Standard", serviceTier: "default", description: "Default Codex speed and usage behavior" },
  { id: "fast", label: "Fast", serviceTier: "fast", description: "Fast mode for supported Codex models when available" }
] as const;

export const codexSandboxLevelOptions = [
  {
    id: "read_only",
    label: "Read-only",
    sandboxMode: "read-only",
    approvalPolicy: "on-request",
    networkAccess: false,
    description: "Codex can inspect the workspace; file changes and boundary crossings need approval."
  },
  {
    id: "workspace_write",
    label: "Workspace write",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    networkAccess: false,
    description: "Codex can edit the room project; network and out-of-workspace actions need approval."
  },
  {
    id: "workspace_write_network",
    label: "Workspace + network",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    networkAccess: true,
    description: "Codex can edit the room project and use network access inside the sandbox."
  },
  {
    id: "danger_full_access",
    label: "Full access",
    sandboxMode: "danger-full-access",
    approvalPolicy: "on-request",
    networkAccess: true,
    description: "Codex can run with broad local access. Use only in fully trusted rooms."
  }
] as const;

export type CodexReasoningEffort = typeof codexReasoningEffortOptions[number]["id"];
export type CodexSpeed = typeof codexSpeedOptions[number]["id"];
export type CodexSandboxLevel = typeof codexSandboxLevelOptions[number]["id"];

export interface RoomMode {
  chat: boolean;
  code: boolean;
  workspace: boolean;
  browser: boolean;
}

export const defaultRoomMode: RoomMode = {
  chat: true,
  code: true,
  workspace: true,
  browser: true
};
