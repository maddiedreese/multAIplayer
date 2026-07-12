import { normalizeGitHubBranchName, normalizeGitHubRepoRef, normalizePullRequestDraft } from "@multaiplayer/github";
import { getRelayHttpUrl } from "./appConfig";

export interface GitHubAuthConfig {
  provider: "github";
  configured: boolean;
  scopes: string[];
  mutationsRequireAuth: boolean;
  allowedOrigins: string[];
  sessionPersistence: "encrypted" | "memory_only";
}

export interface GitHubDeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  expiresAt: number;
}

export type GitHubDevicePollResult =
  | { status: "pending" }
  | { status: "slow_down"; retryAfterSeconds: number }
  | { status: "complete"; user: SignedInUser };

export interface SignedInUser {
  id: string;
  login: string;
  name?: string;
  avatarUrl?: string;
}

export async function getAuthConfig(): Promise<GitHubAuthConfig> {
  const response = await fetch(`${getRelayHttpUrl()}/auth/config`, { credentials: "include" });
  return response.json();
}

export async function getCurrentUser(): Promise<SignedInUser | null> {
  const response = await fetch(`${getRelayHttpUrl()}/auth/me`, { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Failed to load current user: ${response.status}`);
  const body = (await response.json()) as { user: SignedInUser };
  return body.user;
}

export async function startGitHubDeviceFlow(): Promise<GitHubDeviceStart> {
  const response = await fetch(`${getRelayHttpUrl()}/auth/github/device/start`, {
    method: "POST",
    credentials: "include"
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Failed to start GitHub device flow");
  }
  const flow = body as Omit<GitHubDeviceStart, "expiresAt">;
  return { ...flow, expiresAt: Date.now() + Math.max(0, flow.expires_in) * 1000 };
}

export async function pollGitHubDeviceFlow(deviceCode: string): Promise<GitHubDevicePollResult> {
  const response = await fetch(`${getRelayHttpUrl()}/auth/github/device/poll`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode })
  });
  const body = await response.json();
  if (response.status === 202) {
    if (body.status === "slow_down") {
      return { status: "slow_down", retryAfterSeconds: Math.max(1, Number(body.retryAfterSeconds) || 5) };
    }
    return { status: "pending" };
  }
  if (!response.ok) {
    throw new Error(body.error_description ?? body.error ?? "Failed to poll GitHub device flow");
  }
  return { status: "complete", user: (body as { user: SignedInUser }).user };
}

export function nextGitHubDevicePollIntervalSeconds(currentInterval: number, result: GitHubDevicePollResult): number {
  const normalized = Math.max(1, currentInterval);
  return result.status === "slow_down" ? normalized + result.retryAfterSeconds : normalized;
}

export function githubDevicePollDelayMs(intervalSeconds: number, expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.min(Math.max(1, intervalSeconds) * 1000, expiresAt - now));
}

export async function logout(): Promise<void> {
  await fetch(`${getRelayHttpUrl()}/auth/logout`, {
    method: "POST",
    credentials: "include"
  });
}

export interface PullRequestRequest {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
}

export interface PullRequestResult {
  id: number;
  number: number;
  url: string;
  title: string;
}

export interface GitHubActionRun {
  id: number;
  name: string;
  displayTitle?: string;
  runNumber?: number;
  workflowId?: number;
  status: string;
  conclusion: string | null;
  branch?: string;
  headSha?: string;
  event?: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubActionRunsResult {
  totalCount: number;
  runs: GitHubActionRun[];
}

export async function createPullRequest(request: PullRequestRequest): Promise<PullRequestResult> {
  const normalized = normalizePullRequestDraft(request);
  const response = await fetch(`${getRelayHttpUrl()}/github/pulls`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(normalized)
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? "Failed to create pull request");
  }
  return body as PullRequestResult;
}

export async function listGitHubActionRuns(
  owner: string,
  repo: string,
  branch?: string
): Promise<GitHubActionRunsResult> {
  const repoRef = normalizeGitHubRepoRef(owner, repo);
  const params = new URLSearchParams({ owner: repoRef.owner, repo: repoRef.repo });
  if (branch?.trim()) params.set("branch", normalizeGitHubBranchName(branch));
  const response = await fetch(`${getRelayHttpUrl()}/github/actions/runs?${params}`, {
    credentials: "include"
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? "Failed to load GitHub Actions");
  }
  return body as GitHubActionRunsResult;
}
