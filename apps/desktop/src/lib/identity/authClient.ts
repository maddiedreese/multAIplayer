import { getRelayHttpUrl } from "../core/appConfig";
import { readJsonResponse } from "../core/httpResponse";
import { trustedAuthenticationUrl } from "./authExternalUrl";
import { invokeNative } from "../platform/nativeCommandError";
import { isTauriRuntime } from "../platform/localBackend/runtime";
import { clearRelaySession, installRelaySession, relayFetch as fetch } from "../relay/relaySession";

export interface GitHubAuthConfig {
  provider: "github";
  configured: boolean;
  scopes: string[];
  mutationsRequireAuth: boolean;
  allowedOrigins: string[];
  sessionPersistence: "identity_only";
}

export interface GitHubDeviceStart {
  flow_id: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  expiresAt: number;
}

export type GitHubDevicePollResult =
  | { status: "pending" }
  | { status: "slow_down"; retryAfterSeconds: number }
  | { status: "complete"; user: SignedInUser; relaySession: string; relayOrigin: string };

export type GitHubRepositoryDevicePollResult =
  { status: "pending" } | { status: "slow_down"; retryAfterSeconds: number } | { status: "complete" };

export interface SignedInUser {
  id: string;
  login: string;
  name?: string;
  avatarUrl?: string;
}

interface GitHubOAuthPurposeSummary {
  identity: string;
  repositoryWorkflows: string;
}

/** Keeps the identity requirement distinct from the broader optional repo API grant. */
export function summarizeGitHubOAuthPurposes(scopes: readonly string[]): GitHubOAuthPurposeSummary {
  const requested = new Set(scopes);
  return {
    identity: requested.has("read:user") ? "read:user — workspace identity" : "Workspace identity scope unavailable",
    repositoryWorkflows: requested.has("repo")
      ? "repo — public and private repository workflows"
      : requested.has("public_repo")
        ? "public_repo — public repository workflows only"
        : "Requested separately when a repository workflow is used"
  };
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

interface RestoredGitHubSession {
  user: SignedInUser;
  relaySession: string;
  relayOrigin: string;
}

/** Restores an opaque relay session from the native Keychain-held identity. */
export async function restoreGitHubSession(): Promise<SignedInUser | null> {
  if (!isTauriRuntime()) return getCurrentUser();
  try {
    const restored = await invokeNative<RestoredGitHubSession | null>("github_session_restore");
    if (restored) installRelaySession(restored.relaySession, restored.relayOrigin);
    else if (import.meta.env.VITE_NATIVE_E2E_COOKIE_AUTH === "1") return getCurrentUser();
    else clearRelaySession();
    return restored?.user ?? null;
  } catch (error) {
    clearRelaySession();
    // Linux crash-recovery E2E deliberately replaces the Secret Service
    // process while retaining the WebKit profile. Its loopback-only cookie
    // fixture must remain usable when that synthetic credential store cannot
    // be restored; packaged clients never receive this build-time flag.
    if (import.meta.env.VITE_NATIVE_E2E_COOKIE_AUTH === "1") return getCurrentUser();
    throw error;
  }
}

export type HostedAccountDeletionRecheck =
  { status: "signed_in"; user: SignedInUser } | { status: "signed_out_or_deleted" };

export async function recheckHostedAccountDeletion(): Promise<HostedAccountDeletionRecheck> {
  const user = await getCurrentUser();
  return user ? { status: "signed_in", user } : { status: "signed_out_or_deleted" };
}

export async function startGitHubDeviceFlow(): Promise<GitHubDeviceStart> {
  if (!isTauriRuntime()) throw new Error("GitHub sign-in is available only in the native desktop app.");
  const flow = await invokeNative<Omit<GitHubDeviceStart, "expiresAt">>("github_device_flow_start");
  const verificationUri = trustedAuthenticationUrl("github", flow.verification_uri);
  if (!verificationUri) throw new Error("GitHub returned an unsupported verification address.");
  return {
    ...flow,
    verification_uri: verificationUri,
    expiresAt: Date.now() + Math.max(0, flow.expires_in) * 1000
  };
}

export async function pollGitHubDeviceFlow(flowId: string): Promise<GitHubDevicePollResult> {
  if (!isTauriRuntime()) throw new Error("GitHub sign-in is available only in the native desktop app.");
  const result = await invokeNative<GitHubDevicePollResult>("github_device_flow_poll", {
    flowId
  });
  if (result.status === "complete") installRelaySession(result.relaySession, result.relayOrigin);
  return result;
}

export async function getGitHubRepositoryAccessStatus(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const status = await invokeNative<{ authorized: boolean }>("github_repository_access_status");
  return status.authorized;
}

export async function startGitHubRepositoryDeviceFlow(): Promise<GitHubDeviceStart> {
  if (!isTauriRuntime())
    throw new Error("GitHub repository authorization is available only in the native desktop app.");
  const flow = await invokeNative<Omit<GitHubDeviceStart, "expiresAt">>("github_repository_device_flow_start");
  const verificationUri = trustedAuthenticationUrl("github", flow.verification_uri);
  if (!verificationUri) throw new Error("GitHub returned an unsupported verification address.");
  return {
    ...flow,
    verification_uri: verificationUri,
    expiresAt: Date.now() + Math.max(0, flow.expires_in) * 1000
  };
}

export async function pollGitHubRepositoryDeviceFlow(flowId: string): Promise<GitHubRepositoryDevicePollResult> {
  if (!isTauriRuntime())
    throw new Error("GitHub repository authorization is available only in the native desktop app.");
  return invokeNative<GitHubRepositoryDevicePollResult>("github_repository_device_flow_poll", { flowId });
}

export function nextGitHubDevicePollIntervalSeconds(currentInterval: number, result: GitHubDevicePollResult): number {
  const normalized = Math.max(1, currentInterval);
  return result.status === "slow_down" ? normalized + result.retryAfterSeconds : normalized;
}

export function githubDevicePollDelayMs(intervalSeconds: number, expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.min(Math.max(1, intervalSeconds) * 1000, expiresAt - now));
}

export async function logout(): Promise<void> {
  const relayLogout = fetch(`${getRelayHttpUrl()}/auth/logout`, {
    method: "POST",
    credentials: "include"
  }).then((response) => readJsonResponse(response, "Failed to sign out"));
  const credentialDelete = isTauriRuntime() ? invokeNative<void>("github_token_delete") : Promise.resolve();
  const [relayResult, credentialResult] = await Promise.allSettled([relayLogout, credentialDelete]);
  clearRelaySession();

  if (relayResult.status === "rejected" && credentialResult.status === "rejected") {
    throw new AggregateError(
      [relayResult.reason, credentialResult.reason],
      "The relay session and local GitHub credential could not both be cleared."
    );
  }
  if (relayResult.status === "rejected") throw relayResult.reason;
  if (credentialResult.status === "rejected") throw credentialResult.reason;
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
      deleted: HostedAccountDeletionSummary | null;
      retainedSharedData: string[];
    }>(response, "Failed to delete hosted account data");
    if (isTauriRuntime()) await invokeNative<void>("github_token_delete");
    clearRelaySession();
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
    if (isTauriRuntime()) await invokeNative<void>("github_token_delete");
    clearRelaySession();
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

type GitHubActionRunInput = Omit<
  GitHubActionRun,
  "displayTitle" | "runNumber" | "workflowId" | "branch" | "headSha" | "event"
> & {
  displayTitle?: string | undefined;
  runNumber?: number | undefined;
  workflowId?: number | undefined;
  branch?: string | undefined;
  headSha?: string | undefined;
  event?: string | undefined;
};

export function normalizeGitHubActionRun(run: GitHubActionRunInput): GitHubActionRun {
  return {
    id: run.id,
    name: run.name,
    ...(run.displayTitle ? { displayTitle: run.displayTitle } : {}),
    ...(run.runNumber === undefined ? {} : { runNumber: run.runNumber }),
    ...(run.workflowId === undefined ? {} : { workflowId: run.workflowId }),
    status: run.status,
    conclusion: run.conclusion,
    ...(run.branch ? { branch: run.branch } : {}),
    ...(run.headSha ? { headSha: run.headSha } : {}),
    ...(run.event ? { event: run.event } : {}),
    url: run.url,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

export async function createPullRequest(request: PullRequestRequest): Promise<PullRequestResult> {
  if (!isTauriRuntime()) throw new Error("Pull requests are available only in the native desktop app.");
  return invokeNative<PullRequestResult>("github_create_pull_request", { request });
}

export async function listGitHubActionRuns(
  owner: string,
  repo: string,
  branch?: string
): Promise<GitHubActionRunsResult> {
  if (!isTauriRuntime()) throw new Error("GitHub Actions are available only in the native desktop app.");
  return invokeNative<GitHubActionRunsResult>("github_list_action_runs", {
    request: { owner, repo, ...(branch?.trim() ? { branch } : {}) }
  });
}
