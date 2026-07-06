import type { CookieOptions, Response } from "express";
import type { IncomingMessage } from "node:http";
import type { AuthSession } from "../state.js";

interface RelayAuthSessionManagerOptions {
  authSessions: Map<string, AuthSession>;
  mutationsRequireAuth: boolean;
  nodeEnv: string;
  normalizeSessionId: (value: unknown) => string;
  scheduleStoreSave: () => void;
}

export interface RelayAuthSessionManager {
  readonly authSessionMaxAgeMs: number;
  authCookieOptions(maxAge?: number): CookieOptions;
  getAuthSession(sessionId: unknown): AuthSession | null;
  getAuthSessionFromRequest(request: IncomingMessage): AuthSession | undefined;
  allowRead(session: AuthSession | null, res: Response): boolean;
  allowMutation(session: AuthSession | null, res: Response): boolean;
}

const authSessionMaxAgeMs = 1000 * 60 * 60 * 24 * 30;

export function createRelayAuthSessionManager({
  authSessions,
  mutationsRequireAuth,
  nodeEnv,
  normalizeSessionId,
  scheduleStoreSave
}: RelayAuthSessionManagerOptions): RelayAuthSessionManager {
  function authCookieOptions(maxAge?: number): CookieOptions {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: nodeEnv === "production",
      path: "/",
      ...(maxAge === undefined ? {} : { maxAge })
    };
  }

  function getAuthSession(sessionId: unknown): AuthSession | null {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) return null;
    const session = authSessions.get(normalizedSessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      authSessions.delete(normalizedSessionId);
      scheduleStoreSave();
      return null;
    }
    return session;
  }

  function getAuthSessionFromRequest(request: IncomingMessage): AuthSession | undefined {
    const cookies = parseCookieHeader(request.headers.cookie);
    return getAuthSession(cookies.get("multaiplayer_session")) ?? undefined;
  }

  function allowRead(session: AuthSession | null, res: Response): boolean {
    if (!mutationsRequireAuth || session) return true;
    res.status(401).json({ error: "Sign in with GitHub before reading workspace state." });
    return false;
  }

  function allowMutation(session: AuthSession | null, res: Response): boolean {
    if (!mutationsRequireAuth || session) return true;
    res.status(401).json({ error: "Sign in with GitHub before changing workspace state." });
    return false;
  }

  return {
    authSessionMaxAgeMs,
    authCookieOptions,
    getAuthSession,
    getAuthSessionFromRequest,
    allowRead,
    allowMutation
  };
}

export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const item of (header ?? "").split(";")) {
    const [rawName, ...rawValue] = item.split("=");
    const name = rawName?.trim();
    if (!name) continue;
    const value = safeDecodeCookieValue(rawValue.join("=").trim());
    if (value !== null) cookies.set(name, value);
  }
  return cookies;
}

function safeDecodeCookieValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
