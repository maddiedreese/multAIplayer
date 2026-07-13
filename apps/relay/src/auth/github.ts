import { sendRelayError } from "../http/errors.js";
import type { CookieOptions, Express } from "express";
import { nanoid } from "nanoid";
import type { AuthSession } from "../state.js";
import { fetchUpstream } from "../http/upstream.js";

export interface RegisterGitHubAuthRoutesOptions {
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
}

export function registerGitHubAuthRoutes({
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
  maxAccessTokenChars
}: RegisterGitHubAuthRoutesOptions) {
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
      sendRelayError(
        res,
        503,
        "upstream_unavailable",
        "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID on the relay."
      );
      return;
    }

    const response = await fetchUpstream("https://github.com/login/device/code", {
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

    const responseBody = await response.json();
    if (!response.ok) {
      sendRelayError(res, response.status, "upstream_unavailable", "GitHub did not start sign-in.");
      return;
    }
    res.status(response.status).json(responseBody);
  });

  app.post("/auth/github/device/poll", async (req, res) => {
    if (!githubClientId) {
      sendRelayError(
        res,
        503,
        "upstream_unavailable",
        "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID on the relay."
      );
      return;
    }

    const deviceCode = normalizeMetadataText(req.body?.device_code, maxGitHubDeviceCodeChars);
    if (!deviceCode) {
      sendRelayError(res, 400, "invalid_request", "device_code must be a bounded non-empty string");
      return;
    }

    const tokenResponse = await fetchUpstream("https://github.com/login/oauth/access_token", {
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
    const tokenBody = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
    };

    if (!tokenBody.access_token) {
      if (tokenBody.error === "authorization_pending") {
        res.status(202).json({ status: "pending" });
        return;
      }
      if (tokenBody.error === "slow_down") {
        res.status(202).json({ status: "slow_down", retryAfterSeconds: 5 });
        return;
      }
      if (tokenBody.error === "access_denied") {
        sendRelayError(res, 400, "invalid_request", "GitHub sign-in was denied.");
        return;
      }
      if (tokenBody.error === "expired_token") {
        sendRelayError(res, 400, "invalid_request", "The GitHub sign-in code expired. Start sign-in again.");
        return;
      }
      sendRelayError(res, 502, "upstream_unavailable", "GitHub did not complete sign-in.");
      return;
    }

    const userResponse = await fetchUpstream("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "multAIplayer-alpha"
      }
    });
    if (!userResponse.ok) {
      sendRelayError(res, userResponse.status, "upstream_unavailable", "Failed to load GitHub user");
      return;
    }
    const githubUser = (await userResponse.json()) as {
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
      sendRelayError(res, 502, "upstream_unavailable", "GitHub returned unsupported user metadata");
      return;
    }
    if (tokenBody.access_token.length > maxAccessTokenChars) {
      sendRelayError(res, 502, "upstream_unavailable", "GitHub returned an oversized access token");
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
      sendRelayError(res, 401, "authentication_required", "Not signed in");
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
}
