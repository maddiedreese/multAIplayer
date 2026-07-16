export type ApprovalPolicy = "ask_every_turn" | "never_host";

export type CodexCatalogSelectionPolicy = "auto" | "pinned";

export const defaultCodexModel = "gpt-5.6-sol";
export const defaultCodexReasoningEffort = "medium";
export const defaultCodexSpeed = "standard";
export const defaultCodexRawReasoningEnabled = false;
export const defaultCodexSandboxLevel = "workspace_write";
export const defaultCodexModelPolicy: CodexCatalogSelectionPolicy = "auto";
export const defaultCodexReasoningEffortPolicy: CodexCatalogSelectionPolicy = "auto";
export const defaultCodexServiceTierPolicy: CodexCatalogSelectionPolicy = "auto";
export const defaultBrowserProfilePersistent = true;

export const codexModelOptions = [
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    description: "Flagship GPT-5.6 model for frontier capability and complex software work."
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    description: "GPT-5.6 model balancing strong capability with lower cost."
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "Efficient GPT-5.6 model for fast, high-volume coding workflows."
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    description: "Current frontier Codex model for complex coding, research, and real-world work."
  },
  {
    id: "gpt-5.5-cyber",
    label: "GPT-5.5 Cyber",
    description: "Specialized Codex model for eligible cyber and security workflows."
  },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "Codex model used for review-oriented software work." },
  {
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3 Codex Spark",
    description: "Research-preview Codex model for smaller coding turns."
  }
] as const;

export const codexReasoningEffortOptions = [
  { id: "none", label: "None", description: "No extra reasoning budget for direct, mechanical turns" },
  {
    id: "minimal",
    label: "Minimal",
    description: "Smallest supported reasoning budget for simple edits and quick checks"
  },
  { id: "low", label: "Low", description: "Fast responses with lighter reasoning" },
  { id: "medium", label: "Medium", description: "Balances speed and reasoning depth for everyday tasks" },
  { id: "high", label: "High", description: "Greater reasoning depth for complex problems" },
  { id: "xhigh", label: "Extra high", description: "Extra high reasoning depth for complex problems" },
  { id: "max", label: "Max", description: "Maximum reasoning depth for the hardest quality-first work" }
] as const;

export type CodexReasoningEffort = (typeof codexReasoningEffortOptions)[number]["id"];

// This enum is wire-visible. Revisit mixed-version handling before widening it after stable releases.
export const codexReasoningEffortIds = Object.freeze(codexReasoningEffortOptions.map(({ id }) => id)) as readonly [
  CodexReasoningEffort,
  ...CodexReasoningEffort[]
];

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

export type CodexSpeed = (typeof codexSpeedOptions)[number]["id"];
export type CodexSandboxLevel = (typeof codexSandboxLevelOptions)[number]["id"];

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
