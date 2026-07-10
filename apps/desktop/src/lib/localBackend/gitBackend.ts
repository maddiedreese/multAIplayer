import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./runtime";
import type {
  GitApplyPatchResult,
  GitCloneResult,
  GitDiffResult,
  GitPatchResult,
  GitRemoteInfo,
  GitStatusSummary,
  GitWorkflowResult
} from "./types";

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

export async function createGitPatch(cwd: string): Promise<GitPatchResult> {
  if (isTauriRuntime()) {
    return invoke<GitPatchResult>("git_create_patch", { cwd });
  }

  return {
    patch: [
      "diff --git a/apps/desktop/src/App.tsx b/apps/desktop/src/App.tsx",
      "--- a/apps/desktop/src/App.tsx",
      "+++ b/apps/desktop/src/App.tsx",
      "@@ -1 +1 @@",
      "-preview",
      "+preview handoff patch"
    ].join("\n"),
    truncated: false,
    dirtyFiles: ["apps/desktop/src/App.tsx"]
  };
}

export async function cloneGitRepository(
  remoteUrl: string,
  parentDir: string,
  branch?: string
): Promise<GitCloneResult> {
  if (isTauriRuntime()) {
    return invoke<GitCloneResult>("git_clone_repository", {
      request: { remoteUrl, parentDir, branch }
    });
  }

  return {
    path: `${parentDir.replace(/\/$/, "")}/multaiplayer-preview-clone`,
    command: `git clone ${remoteUrl}`,
    status: 0,
    stdout: "Preview mode: repository would be cloned in the native app.\n",
    stderr: ""
  };
}

export async function applyGitPatch(cwd: string, patch: string): Promise<GitApplyPatchResult> {
  if (isTauriRuntime()) {
    return invoke<GitApplyPatchResult>("git_apply_patch", {
      request: { cwd, patch }
    });
  }

  return {
    cwd,
    command: "git apply --whitespace=nowarn",
    status: 0,
    stdout: "Preview mode: handoff patch would be applied in the native app.\n",
    stderr: ""
  };
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
      ? [
          {
            cwd,
            command: `git push -u origin ${branch}`,
            status: 0,
            stdout: "Preview mode: branch would be pushed in the native app.\n",
            stderr: ""
          }
        ]
      : [])
  ];
}
