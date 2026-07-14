import { normalizeGitHubBranchName, normalizeGitHubRepoRef } from "@multaiplayer/github";
import type { GitHubAuthConfig, SignedInUser } from "./authClient";

export interface GitHubWorkflowReadinessInput {
  pushEnabled: boolean;
  authConfig: GitHubAuthConfig | null;
  currentUser: SignedInUser | null;
  owner: string;
  repo: string;
  head: string;
  base: string;
}

export interface GitHubWorkflowReadiness {
  ready: boolean;
  messages: string[];
  target: string | null;
  normalizedBase: string;
}

export interface GitHubActionsReadinessInput {
  authConfig: GitHubAuthConfig | null;
  currentUser: SignedInUser | null;
  owner: string;
  repo: string;
  branch: string;
}

export interface GitHubActionsTarget {
  owner: string;
  repo: string;
  branch: string;
}

export interface GitHubActionsReadiness {
  ready: boolean;
  messages: string[];
  target: string | null;
  normalizedTarget: GitHubActionsTarget | null;
}

export function isGitHubActionsRefreshInFlight(busyByRoom: Record<string, boolean>, roomId: string): boolean {
  return busyByRoom[roomId] === true;
}

export function gitHubActionsRefreshInFlightMessage(): string {
  return "GitHub Actions refresh is already running in this room.";
}

export function checkGitHubWorkflowReadiness(input: GitHubWorkflowReadinessInput): GitHubWorkflowReadiness {
  const messages: string[] = [];
  let target: string | null = null;
  let normalizedBase = input.base.trim() || "main";

  if (!input.pushEnabled) {
    return {
      ready: true,
      messages: ["Local branch and commit only. GitHub sign-in is not required until push/PR is enabled."],
      target,
      normalizedBase
    };
  }

  if (input.authConfig?.configured === false) {
    messages.push("GitHub sign-in is not configured on this relay.");
  }
  if (!input.currentUser) {
    messages.push("Sign in with GitHub before approving a push and draft PR.");
  }
  if (input.authConfig?.scopes.length) {
    const scopes = new Set(input.authConfig.scopes);
    if (!scopes.has("public_repo") && !scopes.has("repo")) {
      messages.push("GitHub permissions need public_repo for public repos or repo for private repos.");
    }
  }

  try {
    const repo = normalizeGitHubRepoRef(input.owner, input.repo);
    const head = normalizeGitHubBranchName(input.head);
    normalizedBase = normalizeGitHubBranchName(normalizedBase);
    target = `${repo.owner}/${repo.repo}:${head} -> ${normalizedBase}`;
  } catch (error) {
    messages.push(String(error));
  }

  if (messages.length === 0 && target) {
    messages.push(`Ready to push and open a draft PR: ${target}.`);
  }

  return {
    ready: messages.length === 1 && messages[0]?.startsWith("Ready to push") === true,
    messages,
    target,
    normalizedBase
  };
}

export function checkGitHubActionsReadiness(input: GitHubActionsReadinessInput): GitHubActionsReadiness {
  const messages: string[] = [];
  let target: string | null = null;
  let normalizedTarget: GitHubActionsTarget | null = null;

  if (input.authConfig?.configured === false) {
    messages.push("GitHub sign-in is not configured on this relay.");
  }
  if (!input.currentUser) {
    messages.push("Sign in with GitHub before checking Actions.");
  }

  try {
    const repo = normalizeGitHubRepoRef(input.owner, input.repo);
    const branch = normalizeGitHubBranchName(input.branch);
    normalizedTarget = {
      owner: repo.owner,
      repo: repo.repo,
      branch
    };
    target = `${repo.owner}/${repo.repo}@${branch}`;
  } catch (error) {
    messages.push(String(error));
  }

  if (messages.length === 0 && target) {
    messages.push(`Ready to check GitHub Actions for ${target}.`);
  }

  return {
    ready: messages.length === 1 && messages[0]?.startsWith("Ready to check GitHub Actions") === true,
    messages,
    target,
    normalizedTarget
  };
}
