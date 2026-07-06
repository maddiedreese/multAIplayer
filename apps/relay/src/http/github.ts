import type { CookieOptions, Express } from "express";
import { nanoid } from "nanoid";
import { normalizeGitHubBranchName, normalizeGitHubRepoRef, normalizePullRequestDraft } from "@multaiplayer/github";
import type { AuthSession } from "../state.js";

interface RegisterGitHubRoutesOptions {
  app: Express;
  githubClientId: string | undefined;
  githubOAuthScopes: string[];
  mutationsRequireAuth: boolean;
  allowedCorsOrigins: string[];
  sessionPersistenceSecret: string | null;
  authSessions: Map<string, AuthSession>;
  authSessionMaxAgeMs: number;
  authCookieOptions: (maxAge?: number) => CookieOptions;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  scheduleStoreSave: () => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxGitHubDeviceCodeChars: number;
  maxUserIdChars: number;
  maxDisplayNameChars: number;
  maxRoomProjectPathChars: number;
  maxAccessTokenChars: number;
  maxShortTextChars: number;
  maxMediumTextChars: number;
  maxUrlChars: number;
}

export function registerGitHubRoutes({
  app,
  githubClientId,
  githubOAuthScopes,
  mutationsRequireAuth,
  allowedCorsOrigins,
  sessionPersistenceSecret,
  authSessions,
  authSessionMaxAgeMs,
  authCookieOptions,
  getAuthSession,
  scheduleStoreSave,
  normalizeMetadataText,
  maxGitHubDeviceCodeChars,
  maxUserIdChars,
  maxDisplayNameChars,
  maxRoomProjectPathChars,
  maxAccessTokenChars,
  maxShortTextChars,
  maxMediumTextChars,
  maxUrlChars
}: RegisterGitHubRoutesOptions) {
  app.get("/auth/config", (_req, res) => {
    res.json({
      provider: "github",
      configured: Boolean(githubClientId),
      scopes: githubOAuthScopes,
      mutationsRequireAuth,
      allowedOrigins: allowedCorsOrigins,
      sessionPersistence: sessionPersistenceSecret ? "encrypted" : "memory_only"
    });
  });

  app.post("/auth/github/device/start", async (_req, res) => {
    if (!githubClientId) {
      res.status(503).json({
        error: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID on the relay."
      });
      return;
    }

    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        client_id: githubClientId,
        scope: githubOAuthScopes.join(" ")
      })
    });

    res.status(response.status).json(await response.json());
  });

  app.post("/auth/github/device/poll", async (req, res) => {
    if (!githubClientId) {
      res.status(503).json({
        error: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID on the relay."
      });
      return;
    }

    const deviceCode = normalizeMetadataText(req.body?.device_code, maxGitHubDeviceCodeChars);
    if (!deviceCode) {
      res.status(400).json({ error: "device_code must be a bounded non-empty string" });
      return;
    }

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        client_id: githubClientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });
    const tokenBody = await tokenResponse.json() as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenBody.access_token) {
      res.status(202).json(tokenBody);
      return;
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "multAIplayer-alpha"
      }
    });
    if (!userResponse.ok) {
      res.status(userResponse.status).json({ error: "Failed to load GitHub user" });
      return;
    }
    const githubUser = await userResponse.json() as {
      id: number;
      login: string;
      name?: string | null;
      avatar_url?: string;
    };
    const userId = Number.isSafeInteger(githubUser.id) ? `github:${githubUser.id}` : null;
    const normalizedUserId = normalizeMetadataText(userId, maxUserIdChars);
    const login = normalizeMetadataText(githubUser.login, maxDisplayNameChars);
    const name = githubUser.name ? normalizeMetadataText(githubUser.name, maxDisplayNameChars) : null;
    const avatarUrl = githubUser.avatar_url
      ? normalizeMetadataText(githubUser.avatar_url, maxRoomProjectPathChars)
      : null;
    if (!normalizedUserId || !login || (githubUser.name && !name) || (githubUser.avatar_url && !avatarUrl)) {
      res.status(502).json({ error: "GitHub returned unsupported user metadata" });
      return;
    }
    if (tokenBody.access_token.length > maxAccessTokenChars) {
      res.status(502).json({ error: "GitHub returned an oversized access token" });
      return;
    }

    const sessionId = nanoid(32);
    const session: AuthSession = {
      accessToken: tokenBody.access_token,
      user: {
        id: normalizedUserId,
        login,
        name: name ?? undefined,
        avatarUrl: avatarUrl ?? undefined
      },
      expiresAt: Date.now() + authSessionMaxAgeMs
    };
    authSessions.set(sessionId, session);
    scheduleStoreSave();
    res.cookie("multaiplayer_session", sessionId, authCookieOptions(authSessionMaxAgeMs));
    res.json({ user: session.user });
  });

  app.get("/auth/me", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!session) {
      res.status(401).json({ error: "Not signed in" });
      return;
    }
    res.json({ user: session.user });
  });

  app.post("/auth/logout", (req, res) => {
    const sessionId = req.cookies?.multaiplayer_session;
    if (sessionId) {
      authSessions.delete(sessionId);
      scheduleStoreSave();
    }
    res.clearCookie("multaiplayer_session", authCookieOptions());
    res.json({ ok: true });
  });

  app.post("/github/pulls", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!session) {
      res.status(401).json({ error: "Sign in with GitHub before creating a PR." });
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
      res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
      return;
    }

    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(draft.owner)}/${encodeURIComponent(draft.repo)}/pulls`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "multAIplayer-alpha"
      },
      body: JSON.stringify(draft)
    });
    const responseBody = await response.json();
    if (!response.ok) {
      res.status(response.status).json(normalizeGitHubErrorResponse(responseBody, normalizeMetadataText, maxMediumTextChars));
      return;
    }
    const pullRequest = normalizeGitHubPullResponse(responseBody, normalizeMetadataText, maxUrlChars, maxShortTextChars);
    if (!pullRequest) {
      res.status(502).json({ error: "GitHub returned an invalid pull request response." });
      return;
    }
    res.status(201).json(pullRequest);
  });

  app.get("/github/actions/runs", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!session) {
      res.status(401).json({ error: "Sign in with GitHub before checking Actions." });
      return;
    }

    let repoRef;
    let branch: string | null = null;
    try {
      repoRef = normalizeGitHubRepoRef(String(req.query.owner ?? ""), String(req.query.repo ?? ""));
      const requestedBranch = String(req.query.branch ?? "");
      branch = requestedBranch.trim() ? normalizeGitHubBranchName(requestedBranch) : null;
    } catch (error) {
      res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
      return;
    }

    const params = new URLSearchParams({ per_page: "6" });
    if (branch) params.set("branch", branch);
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}/actions/runs?${params}`, {
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        accept: "application/vnd.github+json",
        "user-agent": "multAIplayer-alpha",
        "x-github-api-version": "2022-11-28"
      }
    });
    const responseBody = await response.json();
    if (!response.ok) {
      res.status(response.status).json(normalizeGitHubErrorResponse(responseBody, normalizeMetadataText, maxMediumTextChars));
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
  const message = isRecord(value)
    ? normalizeMetadataText(value.message, maxMediumTextChars)
    : null;
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
  if (!isRecord(value)) return null;
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
  if (!isRecord(value)) return { totalCount: 0, runs: [] };
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
  if (!isRecord(value)) return null;
  const id = normalizeSafeNonnegativeInteger(value.id);
  const name = normalizeMetadataText(value.name, maxShortTextChars);
  const status = normalizeMetadataText(value.status, maxShortTextChars);
  const url = normalizeMetadataText(value.html_url, maxUrlChars);
  const createdAt = normalizeMetadataText(value.created_at, maxShortTextChars);
  const updatedAt = normalizeMetadataText(value.updated_at, maxShortTextChars);
  if (id === null || !name || !status || !url || !createdAt || !updatedAt) return null;
  const conclusion = value.conclusion === null
    ? null
    : normalizeMetadataText(value.conclusion, maxShortTextChars);
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
  return value === undefined || value === null ? undefined : normalizeSafeNonnegativeInteger(value) ?? undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
