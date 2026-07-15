import { invokeNative } from "../nativeCommandError";

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

function nativeGitUnavailable(): never {
  throw new Error("Git operations require the native desktop app.");
}

export async function getGitStatus(cwd: string): Promise<GitStatusSummary> {
  if (isTauriRuntime()) {
    return invokeNative<GitStatusSummary>("git_status", { cwd });
  }

  return nativeGitUnavailable();
}

export async function getGitRemoteOrigin(cwd: string): Promise<GitRemoteInfo> {
  if (isTauriRuntime()) {
    return invokeNative<GitRemoteInfo>("git_remote_origin", { cwd });
  }

  return nativeGitUnavailable();
}

export async function getGitDiff(cwd: string, path: string): Promise<GitDiffResult> {
  if (isTauriRuntime()) {
    return invokeNative<GitDiffResult>("git_diff_file", {
      request: { cwd, path }
    });
  }

  return nativeGitUnavailable();
}

export async function createGitPatch(cwd: string): Promise<GitPatchResult> {
  if (isTauriRuntime()) {
    return invokeNative<GitPatchResult>("git_create_patch", { cwd });
  }

  return nativeGitUnavailable();
}

export async function cloneGitRepository(
  remoteUrl: string,
  parentDir: string,
  branch?: string
): Promise<GitCloneResult> {
  if (isTauriRuntime()) {
    return invokeNative<GitCloneResult>("git_clone_repository", {
      request: { remoteUrl, parentDir, branch }
    });
  }

  return nativeGitUnavailable();
}

export async function applyGitPatch(projectRoot: string, cwd: string, patch: string): Promise<GitApplyPatchResult> {
  if (isTauriRuntime()) {
    return invokeNative<GitApplyPatchResult>("git_apply_patch", {
      request: { projectRoot, cwd, patch }
    });
  }

  return nativeGitUnavailable();
}

export async function runGitWorkflow(
  cwd: string,
  branch: string,
  message: string,
  push: boolean
): Promise<GitWorkflowResult[]> {
  if (isTauriRuntime()) {
    return invokeNative<GitWorkflowResult[]>("run_git_workflow", {
      request: { cwd, branch, message, push }
    });
  }

  return nativeGitUnavailable();
}
