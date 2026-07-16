export interface GitStatusFile {
  path: string;
  status: string;
  added: number;
  removed: number;
}

export interface GitStatusSummary {
  branch: string;
  files: GitStatusFile[];
}

export interface GitRemoteInfo {
  originUrl: string | null;
}

export interface GitDiffResult {
  path: string;
  diff: string;
}

export interface GitPatchResult {
  patch: string;
  truncated: boolean;
  dirtyFiles: string[];
}

export interface GitCloneResult {
  path: string;
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface GitApplyPatchResult {
  command: string;
  cwd: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ProjectFileEntry {
  path: string;
  size: number;
}

export interface ProjectFileContent {
  path: string;
  size: number;
  truncated: boolean;
  content: string;
  mediaType?: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

export interface ProjectFileWriteResult {
  path: string;
  size: number;
}

export interface CommandResult {
  command: string;
  cwd: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface CodexProbe {
  available: boolean;
  version: string | null;
  error: string | null;
  models: CodexModelOption[];
  modelError: string | null;
}

export interface CodexModelOption {
  id: string;
  label: string;
  description: string;
  model: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
  serviceTiers: string[];
  defaultServiceTier: string | null;
}

export interface CodexTurnResult {
  threadId: string | null;
  status: string;
  transcript: string;
  events: string[];
  stderr: string;
  generatedImages: CodexGeneratedImage[];
}

export interface CodexSteerResult {
  threadId: string;
  turnId: string;
  clientTurnId: string;
}

export interface CodexGeneratedImage {
  data: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  name: string;
  prompt?: string;
}

export interface CodexActivityEvent {
  roomId: string;
  activityId: string;
  turnId: string;
  itemId: string;
  threadId?: string;
  kind:
    | "command"
    | "file_change"
    | "tool"
    | "web_search"
    | "image_generation"
    | "agent"
    | "review"
    | "hook"
    | "reasoning"
    | "other";
  status: "started" | "running" | "completed" | "failed" | "declined";
  title: string;
  details?:
    | { type: "reasoning"; summaries: string[] }
    | { type: "command"; command: string; output?: string; exitCode?: number; durationMs?: number }
    | { type: "file_change"; changes: Array<{ path: string; action: "add" | "delete" | "update"; diff?: string }> }
    | {
        type: "tool";
        name: string;
        server?: string;
        arguments?: string;
        result?: string;
        error?: string;
        durationMs?: number;
      }
    | {
        type: "web_search";
        action?: "search" | "open_page" | "find_in_page" | "other";
        query?: string;
        url?: string;
        pattern?: string;
      }
    | { type: "image_generation"; prompt?: string }
    | {
        type: "agent";
        prompt?: string;
        model?: string;
        reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
        states?: Array<{ threadId: string; status: string; message?: string }>;
      };
  agent?: {
    action: "spawn" | "send" | "resume" | "wait" | "close";
    senderId: string;
    receiverIds: string[];
  };
  startedAt: string;
  updatedAt: string;
}

export interface CodexThreadNode {
  id: string;
  sessionId?: string;
  parentThreadId?: string;
  title: string;
  status: "notLoaded" | "idle" | "systemError" | "active" | "unknown";
  createdAt: number;
  updatedAt: number;
}

export interface CodexServerRequest {
  requestKey: string;
  roomId: string;
  method: string;
  params: unknown;
  expiresAtMs: number;
  proposedBy: string | null;
  contextSummary: string | null;
}

export interface CodexHostCapabilities {
  codexVersion: string;
  manifestVersion: string;
  supportsAccount: boolean;
  supportsBrowserLogin: boolean;
  supportsDeviceLogin: boolean;
  supportsHostedLoginSuccess: boolean;
  supportsApps: boolean;
  supportsMcp: boolean;
  supportsWritesApproval: boolean;
  compatibilityWarning: string | null;
}

export interface CodexHostAccount {
  accountType: string;
  email: string | null;
  planType: string | null;
}

export interface CodexHostApp {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  accessible: boolean;
}

export interface CodexHostMcpServer {
  name: string;
  authStatus: string;
  toolCount: number;
  resourceCount: number;
  resourceTemplateCount: number;
}

export interface CodexHostSnapshot {
  capabilities: CodexHostCapabilities;
  requiresOpenaiAuth: boolean;
  account: CodexHostAccount | null;
  apps: CodexHostApp[];
  appsError: string | null;
  mcpServers: CodexHostMcpServer[];
  mcpError: string | null;
}

export interface CodexLoginStartResult {
  flow: "browser" | "device";
  loginId: string;
  url: string;
  userCode: string | null;
}

export interface CodexMcpLoginResult {
  name: string;
  authorizationUrl: string;
}

export interface CodexHostNotification {
  method:
    | "account/login/completed"
    | "account/updated"
    | "mcpServer/oauthLogin/completed"
    | "mcpServer/startupStatus/updated"
    | "app/list/updated";
  params: Record<string, unknown>;
}

export type CodexServerResponse =
  { result: unknown; error?: never } | { result?: never; error: { code: number; message: string; data?: unknown } };

export type CodexGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

export interface CodexGoal {
  objective: string;
  status: CodexGoalStatus;
  threadId: string;
  createdAt: number;
  updatedAt: number;
  timeUsedSeconds: number;
  tokensUsed: number;
  tokenBudget: number | null;
}

export interface GitWorkflowResult {
  command: string;
  cwd: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface TerminalLine {
  stream: "system" | "stdout" | "stderr" | "stdin" | string;
  text: string;
}

export interface TerminalSnapshot {
  id: string;
  roomId: string;
  name: string;
  cwd: string;
  command: string;
  running: boolean;
  exitStatus: number | null;
  startedAt: string;
  lines: TerminalLine[];
}

export interface LocalPreviewDetectedServer {
  url: string;
  host: string;
  port: number;
}

export interface CloudflaredProbe {
  available: boolean;
  version: string | null;
  error: string | null;
}

export interface LocalPreviewStartResult {
  id: string;
  localUrl: string;
  publicUrl: string;
  startupLog: string;
}

export interface LocalPreviewStopResult {
  id: string;
  localUrl: string;
  publicUrl: string;
  stopped: boolean;
}

export interface LocalPreviewStatusResult {
  id: string;
  localUrl: string;
  publicUrl: string;
  running: boolean;
  localReachable: boolean;
  exitStatus: number | null;
}
