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
}

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

export interface BrowserOpenResult {
  label: string;
  url: string;
  reused: boolean;
  profilePath: string;
  persistent: boolean;
  downloadsBlocked: boolean;
  clipboardBlocked: boolean;
  fileUploadsBlocked: boolean;
}

export interface BrowserProfileResult {
  roomId: string;
  profilePath: string;
  reset: boolean;
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
