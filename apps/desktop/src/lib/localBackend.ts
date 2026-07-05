import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { maxEmbeddedAttachmentBytes } from "@multaiplayer/protocol";

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
}

export interface CodexTurnResult {
  threadId: string | null;
  status: string;
  transcript: string;
  events: string[];
  stderr: string;
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

export const defaultProjectPath = "/Users/maddiedreese/Documents/MultAIplayer";
const previewTerminals = new Map<string, TerminalSnapshot>();

export async function getGitStatus(cwd: string): Promise<GitStatusSummary> {
  if (isTauriRuntime()) {
    return invoke<GitStatusSummary>("git_status", { cwd });
  }

  return {
    branch: "main",
    files: [
      { path: "apps/desktop/src/App.tsx", status: "modified", added: 184, removed: 12 },
      { path: "packages/protocol/src/index.ts", status: "modified", added: 32, removed: 0 },
      { path: "docs/threat-model.md", status: "modified", added: 21, removed: 2 }
    ]
  };
}

export async function getGitRemoteOrigin(cwd: string): Promise<GitRemoteInfo> {
  if (isTauriRuntime()) {
    return invoke<GitRemoteInfo>("git_remote_origin", { cwd });
  }

  return {
    originUrl: "git@github.com:maddiedreese/multAIplayer.git"
  };
}

export async function getGitDiff(cwd: string, path: string): Promise<GitDiffResult> {
  if (isTauriRuntime()) {
    return invoke<GitDiffResult>("git_diff_file", {
      request: { cwd, path }
    });
  }

  return {
    path,
    diff: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1,4 +1,5 @@",
      " export const multAIplayer = 'private group chat for coding with Codex';",
      "-export const diffView = 'basic file changes';",
      "+export const diffView = 'reviewable red and green file changes';",
      "+export const hostApproval = true;"
    ].join("\n")
  };
}

export async function searchProjectFiles(
  cwd: string,
  query: string,
  limit = 80
): Promise<ProjectFileEntry[]> {
  if (isTauriRuntime()) {
    return invoke<ProjectFileEntry[]>("project_files", {
      request: { cwd, query, limit }
    });
  }

  return [
    { path: "apps/desktop/src/App.tsx", size: 42000 },
    { path: "apps/desktop/src/lib/localBackend.ts", size: 8800 },
    { path: "apps/desktop/src-tauri/src/lib.rs", size: 24000 },
    { path: "docs/product-architecture.md", size: 18000 },
    { path: "README.md", size: 940 }
  ].filter((file) => file.path.toLowerCase().includes(query.trim().toLowerCase()));
}

export async function readProjectFile(
  cwd: string,
  path: string,
  maxBytes = maxEmbeddedAttachmentBytes
): Promise<ProjectFileContent> {
  if (isTauriRuntime()) {
    return invoke<ProjectFileContent>("project_file_read", {
      request: { cwd, path, maxBytes }
    });
  }

  return {
    path,
    size: 512,
    truncated: false,
    content: [
      `// Preview mode for ${path}`,
      "Open the Tauri app to read real project files from the selected room folder.",
      "",
      "export const multAIplayer = 'private group chat for coding with Codex';"
    ].join("\n")
  };
}

export async function runShellCommand(cwd: string, command: string): Promise<CommandResult> {
  if (isTauriRuntime()) {
    return invoke<CommandResult>("run_shell_command", {
      request: { cwd, command }
    });
  }

  return {
    cwd,
    command,
    status: 0,
    stdout: `$ ${command}\nPreview mode: open the Tauri app to run host commands.\n`,
    stderr: ""
  };
}

export async function startTerminal(
  roomId: string,
  name: string,
  cwd: string,
  command: string
): Promise<TerminalSnapshot> {
  if (isTauriRuntime()) {
    return invoke<TerminalSnapshot>("terminal_start", {
      request: { roomId, name, cwd, command }
    });
  }

  const snapshot = {
    id: `${roomId}:${name}`,
    roomId,
    name,
    cwd,
    command,
    running: false,
    exitStatus: 0,
    startedAt: String(Date.now()),
    lines: [
      { stream: "system", text: `$ ${command}` },
      { stream: "stdout", text: command.startsWith("echo ") ? command.slice(5) : "Preview mode: open the Tauri app for persistent host terminals." }
    ]
  };
  previewTerminals.set(snapshot.id, snapshot);
  return snapshot;
}

export async function listTerminals(roomId: string): Promise<TerminalSnapshot[]> {
  if (isTauriRuntime()) {
    return invoke<TerminalSnapshot[]>("terminal_list", { roomId });
  }

  return Array.from(previewTerminals.values()).filter((terminal) => terminal.roomId === roomId);
}

export async function readTerminal(id: string): Promise<TerminalSnapshot> {
  if (isTauriRuntime()) {
    return invoke<TerminalSnapshot>("terminal_read", { id });
  }

  const existing = previewTerminals.get(id);
  if (existing) return existing;
  throw new Error(`Terminal not found: ${id}`);
}

export async function writeTerminal(id: string, input: string): Promise<TerminalSnapshot> {
  if (isTauriRuntime()) {
    return invoke<TerminalSnapshot>("terminal_write", {
      request: { id, input }
    });
  }

  const snapshot = await readTerminal(id);
  const updated = {
    ...snapshot,
    lines: [...snapshot.lines, { stream: "stdin", text: input }]
  };
  previewTerminals.set(id, updated);
  return updated;
}

export async function stopTerminal(id: string): Promise<TerminalSnapshot> {
  if (isTauriRuntime()) {
    return invoke<TerminalSnapshot>("terminal_stop", { id });
  }

  const snapshot = await readTerminal(id);
  const updated = { ...snapshot, running: false, exitStatus: 0 };
  previewTerminals.set(id, updated);
  return updated;
}

export async function runGitWorkflow(
  cwd: string,
  branch: string,
  message: string,
  push: boolean
): Promise<GitWorkflowResult[]> {
  if (isTauriRuntime()) {
    return invoke<GitWorkflowResult[]>("run_git_workflow", {
      request: { cwd, branch, message, push }
    });
  }

  return [
    {
      cwd,
      command: `git switch -c ${branch}`,
      status: 0,
      stdout: "Preview mode: branch would be created in the native app.\n",
      stderr: ""
    },
    {
      cwd,
      command: `git commit -m ${JSON.stringify(message)}`,
      status: 0,
      stdout: "Preview mode: commit would be created in the native app.\n",
      stderr: ""
    },
    ...(push
      ? [{
          cwd,
          command: `git push -u origin ${branch}`,
          status: 0,
          stdout: "Preview mode: branch would be pushed in the native app.\n",
          stderr: ""
        }]
      : [])
  ];
}

export async function probeCodex(): Promise<CodexProbe> {
  if (isTauriRuntime()) {
    return invoke<CodexProbe>("probe_codex");
  }

  return {
    available: false,
    version: null,
    error: "Preview mode"
  };
}

export async function openBrowserView(
  roomId: string,
  projectPath: string,
  url: string,
  title?: string,
  persistent = true
): Promise<BrowserOpenResult> {
  if (isTauriRuntime()) {
    return invoke<BrowserOpenResult>("open_browser_view", {
      request: { roomId, projectPath, url, title, persistent }
    });
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return {
    label: `preview-browser-${roomId}`,
    url,
    reused: false,
    profilePath: "Preview browser opens outside the native room profile.",
    persistent,
    downloadsBlocked: false,
    clipboardBlocked: false,
    fileUploadsBlocked: false
  };
}

export async function resetBrowserProfile(roomId: string, projectPath: string): Promise<BrowserProfileResult> {
  if (isTauriRuntime()) {
    return invoke<BrowserProfileResult>("reset_browser_profile", {
      request: { roomId, projectPath }
    });
  }

  return {
    roomId,
    profilePath: "Preview browser opens outside the native room profile.",
    reset: true
  };
}

export async function chooseProjectFolder(defaultPath: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath
  });
  return typeof selected === "string" ? selected : null;
}

export async function runCodexTurn(
  cwd: string,
  input: string,
  model = "gpt-5.4",
  previousThreadId: string | null = null,
  timeoutSeconds = 180
): Promise<CodexTurnResult> {
  if (isTauriRuntime()) {
    return invoke<CodexTurnResult>("run_codex_turn", {
      request: {
        cwd,
        input,
        model,
        previousThreadId,
        timeoutSeconds
      }
    });
  }

  return {
    threadId: previousThreadId ?? "preview-thread",
    status: "preview",
    transcript:
      "Preview mode: in the native app, this approval starts a local Codex app-server turn using the selected project and chat delta.",
    events: [
      "preview:initialize",
      previousThreadId ? "preview:thread/resume" : "preview:thread/start",
      "preview:turn/start",
      "preview:turn/completed"
    ],
    stderr: ""
  };
}


function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
