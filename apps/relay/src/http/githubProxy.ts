import { sendRelayError } from "./errors.js";
import type { Express } from "express";
import { normalizeGitHubBranchName, normalizeGitHubRepoRef, normalizePullRequestDraft } from "@multaiplayer/github";
import { isRecord } from "@multaiplayer/protocol";
import type { AuthSession } from "../state.js";
import { fetchUpstream } from "./upstream.js";

export interface RegisterGitHubProxyRoutesOptions {
  app: Express;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxMediumTextChars: number;
  maxShortTextChars: number;
  maxUrlChars: number;
}

export function registerGitHubProxyRoutes({
  app,
  getAuthSession,
  normalizeMetadataText,
  maxMediumTextChars,
  maxShortTextChars,
  maxUrlChars
}: RegisterGitHubProxyRoutesOptions) {
  app.post("/github/pulls", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!session) {
      sendRelayError(res, 401, "authentication_required", "Sign in with GitHub before creating a PR.");
      return;
    }

    let draft;
    try {
      draft = normalizePullRequestDraft({
        owner: String(req.body?.owner ?? ""),
        repo: String(req.body?.repo ?? ""),
        title: String(req.body?.title ?? ""),
        body: String(req.body?.body ?? ""),
        head: String(req.body?.head ?? ""),
        base: String(req.body?.base ?? "main"),
        draft: Boolean(req.body?.draft ?? true)
      });
    } catch (error) {
      sendRelayError(res, 400, "invalid_request", String(error instanceof Error ? error.message : error));
      return;
    }

    const response = await fetchUpstream(
      `https://api.github.com/repos/${encodeURIComponent(draft.owner)}/${encodeURIComponent(draft.repo)}/pulls`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "user-agent": "multAIplayer-alpha"
        },
        body: JSON.stringify(draft)
      }
    );
    const responseBody = await response.json();
    if (!response.ok) {
      const upstreamError = normalizeGitHubErrorResponse(responseBody, normalizeMetadataText, maxMediumTextChars);
      sendRelayError(res, response.status, "upstream_unavailable", upstreamError.error, {
        ...(upstreamError.message ? { message: upstreamError.message } : {})
      });
      return;
    }
    const pullRequest = normalizeGitHubPullResponse(
      responseBody,
      normalizeMetadataText,
      maxUrlChars,
      maxShortTextChars
    );
    if (!pullRequest) {
      sendRelayError(res, 502, "upstream_unavailable", "GitHub returned an invalid pull request response.");
      return;
    }
    res.status(201).json(pullRequest);
  });

  app.get("/github/actions/runs", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!session) {
      sendRelayError(res, 401, "authentication_required", "Sign in with GitHub before checking Actions.");
      return;
    }

    let repoRef;
    let branch: string | null = null;
    try {
      repoRef = normalizeGitHubRepoRef(String(req.query.owner ?? ""), String(req.query.repo ?? ""));
      const requestedBranch = String(req.query.branch ?? "");
      branch = requestedBranch.trim() ? normalizeGitHubBranchName(requestedBranch) : null;
    } catch (error) {
      sendRelayError(res, 400, "invalid_request", String(error instanceof Error ? error.message : error));
      return;
    }

    const params = new URLSearchParams({ per_page: "6" });
    if (branch) params.set("branch", branch);
    const response = await fetchUpstream(
      `https://api.github.com/repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}/actions/runs?${params}`,
      {
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          accept: "application/vnd.github+json",
          "user-agent": "multAIplayer-alpha",
          "x-github-api-version": "2022-11-28"
        }
      }
    );
    const responseBody = await response.json();
    if (!response.ok) {
      const upstreamError = normalizeGitHubErrorResponse(responseBody, normalizeMetadataText, maxMediumTextChars);
      sendRelayError(res, response.status, "upstream_unavailable", upstreamError.error, {
        ...(upstreamError.message ? { message: upstreamError.message } : {})
      });
      return;
    }

    res.json(normalizeGitHubActionsResponse(responseBody, normalizeMetadataText, maxUrlChars, maxShortTextChars));
  });
}

function normalizeGitHubErrorResponse(
  value: unknown,
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null,
  maxMediumTextChars: number
): { error: string; message?: string } {
  const message =
    isRecord(value) && !Array.isArray(value) ? normalizeMetadataText(value.message, maxMediumTextChars) : null;
  return {
    error: message ?? "GitHub request failed.",
    ...(message ? { message } : {})
  };
}

function normalizeGitHubPullResponse(
  value: unknown,
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null,
  maxUrlChars: number,
  maxShortTextChars: number
): {
  id: number;
  number: number;
  url: string;
  title: string;
} | null {
  if (!isRecord(value) || Array.isArray(value)) return null;
  const id = normalizeSafeNonnegativeInteger(value.id);
  const number = normalizeSafeNonnegativeInteger(value.number);
  const url = normalizeMetadataText(value.html_url, maxUrlChars);
  const title = normalizeMetadataText(value.title, maxShortTextChars);
  if (id === null || number === null || !url || !title) return null;
  return { id, number, url, title };
}

function normalizeGitHubActionsResponse(
  value: unknown,
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null,
  maxUrlChars: number,
  maxShortTextChars: number
): {
  totalCount: number;
  runs: Array<{
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
  }>;
} {
  if (!isRecord(value) || Array.isArray(value)) return { totalCount: 0, runs: [] };
  return {
    totalCount: normalizeSafeNonnegativeInteger(value.total_count) ?? 0,
    runs: Array.isArray(value.workflow_runs)
      ? value.workflow_runs
          .slice(0, 6)
          .map((run) => normalizeGitHubActionRun(run, normalizeMetadataText, maxUrlChars, maxShortTextChars))
          .filter((run) => run !== null)
      : []
  };
}

function normalizeGitHubActionRun(
  value: unknown,
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null,
  maxUrlChars: number,
  maxShortTextChars: number
): {
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
} | null {
  if (!isRecord(value) || Array.isArray(value)) return null;
  const id = normalizeSafeNonnegativeInteger(value.id);
  const name = normalizeMetadataText(value.name, maxShortTextChars);
  const status = normalizeMetadataText(value.status, maxShortTextChars);
  const url = normalizeMetadataText(value.html_url, maxUrlChars);
  const createdAt = normalizeMetadataText(value.created_at, maxShortTextChars);
  const updatedAt = normalizeMetadataText(value.updated_at, maxShortTextChars);
  if (id === null || !name || !status || !url || !createdAt || !updatedAt) return null;
  const conclusion = value.conclusion === null ? null : normalizeMetadataText(value.conclusion, maxShortTextChars);
  if (value.conclusion !== null && !conclusion) return null;
  const displayTitle = normalizeOptionalMetadataText(value.display_title, normalizeMetadataText, maxShortTextChars);
  const branch = normalizeOptionalMetadataText(value.head_branch, normalizeMetadataText, maxShortTextChars);
  const headSha = normalizeOptionalMetadataText(value.head_sha, normalizeMetadataText, maxShortTextChars);
  const event = normalizeOptionalMetadataText(value.event, normalizeMetadataText, maxShortTextChars);
  const runNumber = normalizeOptionalSafeNonnegativeInteger(value.run_number);
  const workflowId = normalizeOptionalSafeNonnegativeInteger(value.workflow_id);
  return {
    id,
    name,
    ...(displayTitle ? { displayTitle } : {}),
    ...(runNumber !== undefined ? { runNumber } : {}),
    ...(workflowId !== undefined ? { workflowId } : {}),
    status,
    conclusion,
    ...(branch ? { branch } : {}),
    ...(headSha ? { headSha } : {}),
    ...(event ? { event } : {}),
    url,
    createdAt,
    updatedAt
  };
}

function normalizeSafeNonnegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function normalizeOptionalSafeNonnegativeInteger(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : (normalizeSafeNonnegativeInteger(value) ?? undefined);
}

function normalizeOptionalMetadataText(
  value: unknown,
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null,
  maxChars: number
): string | null {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return normalizeMetadataText(text, maxChars);
}
