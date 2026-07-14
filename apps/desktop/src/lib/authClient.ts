import { normalizeGitHubBranchName, normalizeGitHubRepoRef, normalizePullRequestDraft } from "@multaiplayer/github";
import { getRelayHttpUrl } from "./appConfig";
import { readJsonResponse } from "./httpResponse";
import { trustedAuthenticationUrl } from "./authExternalUrl";

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
  return readJsonResponse(response, "Failed to load relay authentication configuration");
}

export async function getCurrentUser(): Promise<SignedInUser | null> {
  const response = await fetch(`${getRelayHttpUrl()}/auth/me`, { credentials: "include" });
  if (response.status === 401) return null;
  const body = await readJsonResponse<{ user: SignedInUser }>(response, "Failed to load current user");
  return body.user;
}

export type HostedAccountDeletionRecheck =
  { status: "signed_in"; user: SignedInUser } | { status: "signed_out_or_deleted" };

export async function recheckHostedAccountDeletion(): Promise<HostedAccountDeletionRecheck> {
  const user = await getCurrentUser();
  return user ? { status: "signed_in", user } : { status: "signed_out_or_deleted" };
}

export async function startGitHubDeviceFlow(): Promise<GitHubDeviceStart> {
  const response = await fetch(`${getRelayHttpUrl()}/auth/github/device/start`, {
    method: "POST",
    credentials: "include"
  });
  const flow = await readJsonResponse<Omit<GitHubDeviceStart, "expiresAt">>(
    response,
    "Failed to start GitHub device flow"
  );
  const verificationUri = trustedAuthenticationUrl("github", flow.verification_uri);
  if (!verificationUri) throw new Error("GitHub returned an unsupported verification address.");
  return {
    ...flow,
    verification_uri: verificationUri,
    expiresAt: Date.now() + Math.max(0, flow.expires_in) * 1000
  };
}

export async function pollGitHubDeviceFlow(deviceCode: string): Promise<GitHubDevicePollResult> {
  const response = await fetch(`${getRelayHttpUrl()}/auth/github/device/poll`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode })
  });
  if (response.status === 202) {
    const body = (await response.json()) as { status?: string; retryAfterSeconds?: unknown };
    if (body.status === "slow_down") {
      return { status: "slow_down", retryAfterSeconds: Math.max(1, Number(body.retryAfterSeconds) || 5) };
    }
    return { status: "pending" };
  }
  const body = await readJsonResponse<{ user: SignedInUser }>(response, "Failed to poll GitHub device flow");
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
  const response = await fetch(`${getRelayHttpUrl()}/auth/logout`, {
    method: "POST",
    credentials: "include"
  });
  await readJsonResponse(response, "Failed to sign out");
}

export const hostedAccountDeletionConfirmation = "delete my account" as const;

export interface HostedAccountDeletionBlockers {
  ownedTeams: Array<{ id: string; name: string }>;
  hostedRooms: Array<{ id: string; name: string; teamId: string }>;
}

export interface HostedAccountDeletionSummary {
  authSessions: number;
  deviceSessions: number;
  devices: number;
  keyPackages: number;
  teamMemberships: number;
  inviteArtifacts: number;
  dailyTeamCreationQuotaRecords: number;
  dailyRoomCreationQuotaRecords: number;
  attachmentUploadQuotaRecords: number;
  rateLimitRecords: number;
  deviceChallenges: number;
}

export type HostedAccountDeletionResult =
  | {
      status: "deleted";
      deleted: HostedAccountDeletionSummary | null;
      retainedSharedData: string[];
    }
  | { status: "blocked"; blockers: HostedAccountDeletionBlockers }
  | { status: "indeterminate"; signedOut: true };

export async function deleteHostedAccount(
  confirmation: string = hostedAccountDeletionConfirmation
): Promise<HostedAccountDeletionResult> {
  let response: Response;
  try {
    response = await fetch(`${getRelayHttpUrl()}/auth/account`, {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation })
    });
  } catch (error) {
    return recoverHostedAccountDeletionAfterResponseLoss(error);
  }
  if (response.status === 409) {
    const body = (await response.clone().json()) as {
      code?: unknown;
      blockers?: unknown;
    };
    if (body.code === "account_deletion_blocked" && validHostedAccountDeletionBlockers(body.blockers)) {
      return { status: "blocked", blockers: body.blockers };
    }
  }
  try {
    const body = await readJsonResponse<{
      ok: true;
      deleted: HostedAccountDeletionSummary;
      retainedSharedData: string[];
    }>(response, "Failed to delete hosted account data");
    return {
      status: "deleted",
      deleted: body.deleted,
      retainedSharedData: body.retainedSharedData
    };
  } catch (error) {
    if (!response.ok) throw error;
    return recoverHostedAccountDeletionAfterResponseLoss(error);
  }
}

export class HostedAccountDeletionIndeterminateError extends Error {
  override readonly name = "HostedAccountDeletionIndeterminateError";
}

async function recoverHostedAccountDeletionAfterResponseLoss(cause: unknown): Promise<HostedAccountDeletionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (currentUser) throw cause;
    return { status: "indeterminate", signedOut: true };
  } catch (probeError) {
    if (probeError === cause) throw cause;
    throw new HostedAccountDeletionIndeterminateError(
      "The relay response was lost and account deletion status could not be verified. Reconnect before retrying."
    );
  }
}

function validHostedAccountDeletionBlockers(value: unknown): value is HostedAccountDeletionBlockers {
  if (!value || typeof value !== "object") return false;
  const blockers = value as { ownedTeams?: unknown; hostedRooms?: unknown };
  return (
    Array.isArray(blockers.ownedTeams) &&
    blockers.ownedTeams.every((team) => validNamedId(team)) &&
    Array.isArray(blockers.hostedRooms) &&
    blockers.hostedRooms.every(
      (room) => validNamedId(room) && typeof (room as { teamId?: unknown }).teamId === "string"
    )
  );
}

function validNamedId(value: unknown): value is { id: string; name: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { name?: unknown }).name === "string"
  );
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
  return readJsonResponse<PullRequestResult>(response, "Failed to create pull request");
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
  return readJsonResponse<GitHubActionRunsResult>(response, "Failed to load GitHub Actions");
}
