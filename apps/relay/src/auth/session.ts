import { sendRelayError } from "../http/errors.js";
import type { CookieOptions, Response } from "express";
import type { IncomingMessage } from "node:http";
import { parseCookie } from "cookie";
import { isRecord } from "@multaiplayer/protocol";
import { normalizeMetadataText, normalizeRelayId } from "../limits.js";
import type { AuthSession } from "../state.js";

interface RelayAuthSessionManagerOptions {
  authSessions: Map<string, AuthSession>;
  mutationsRequireAuth: boolean;
  nodeEnv: string;
  normalizeSessionId: (value: unknown) => string;
  scheduleStoreSave: () => void;
  isDeletedIdentity?: (userId: string) => boolean;
}

export interface RelayAuthSessionManager {
  readonly authSessionMaxAgeMs: number;
  authCookieOptions(maxAge?: number): CookieOptions;
  getAuthSession(sessionId: unknown): AuthSession | null;
  getAuthSessionFromRequest(request: IncomingMessage): AuthSession | undefined;
  allowRead(session: AuthSession | null, res: Response): boolean;
  allowMutation(session: AuthSession | null, res: Response): boolean;
}

export interface StoredAuthSession {
  sessionId: string;
  user: AuthSession["user"];
  expiresAt: number;
}

export interface NormalizedStoredAuthSession {
  sessionId: string;
  session: AuthSession;
}

interface RelayAuthSessionPersistenceOptions {
  authSessionMaxAgeMs: number;
  maxAuthSessionIdChars: number;
  maxDisplayNameChars: number;
  maxRoomProjectPathChars: number;
  maxUserIdChars: number;
}

export interface RelayAuthSessionPersistence {
  storedAuthSessions(authSessions: Map<string, AuthSession>): StoredAuthSession[];
  normalizeStoredAuthSession(stored: unknown): NormalizedStoredAuthSession | null;
}

const authSessionMaxAgeMs = 1000 * 60 * 60 * 24 * 30;

export function createRelayAuthSessionManager({
  authSessions,
  mutationsRequireAuth,
  nodeEnv,
  normalizeSessionId,
  scheduleStoreSave,
  isDeletedIdentity = () => false
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
    if (isDeletedIdentity(session.user.id)) {
      authSessions.delete(normalizedSessionId);
      scheduleStoreSave();
      return null;
    }
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
    sendRelayError(res, 401, "authentication_required", "Sign in with GitHub before reading workspace state.");
    return false;
  }

  function allowMutation(session: AuthSession | null, res: Response): boolean {
    if (!mutationsRequireAuth || session) return true;
    sendRelayError(res, 401, "authentication_required", "Sign in with GitHub before changing workspace state.");
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
  return new Map(
    Object.entries(parseCookie(header ?? "")).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

export function createRelayAuthSessionPersistence({
  authSessionMaxAgeMs,
  maxAuthSessionIdChars,
  maxDisplayNameChars,
  maxRoomProjectPathChars,
  maxUserIdChars
}: RelayAuthSessionPersistenceOptions): RelayAuthSessionPersistence {
  return {
    storedAuthSessions(authSessions) {
      const sessions: StoredAuthSession[] = [];
      for (const [sessionId, session] of authSessions.entries()) {
        if (session.expiresAt <= Date.now()) continue;
        sessions.push({
          sessionId,
          user: session.user,
          expiresAt: session.expiresAt
        });
      }
      return sessions;
    },
    normalizeStoredAuthSession(stored) {
      if (!isRecord(stored)) return null;
      const sessionId = normalizeRelayId(stored.sessionId, maxAuthSessionIdChars);
      const user = isRecord(stored.user) ? stored.user : null;
      const userId = normalizeMetadataText(user?.id, maxUserIdChars);
      const login = normalizeMetadataText(user?.login, maxDisplayNameChars);
      const name = user?.name === undefined ? undefined : normalizeMetadataText(user.name, maxDisplayNameChars);
      const avatarUrl =
        user?.avatarUrl === undefined ? undefined : normalizeMetadataText(user.avatarUrl, maxRoomProjectPathChars);
      if (
        !sessionId ||
        typeof stored.expiresAt !== "number" ||
        !Number.isSafeInteger(stored.expiresAt) ||
        stored.expiresAt <= Date.now() ||
        stored.expiresAt > Date.now() + authSessionMaxAgeMs ||
        !userId ||
        !login ||
        (user?.name !== undefined && !name) ||
        (user?.avatarUrl !== undefined && !avatarUrl)
      ) {
        return null;
      }

      return {
        sessionId,
        session: {
          user: {
            id: userId,
            login,
            name: name ?? undefined,
            avatarUrl: avatarUrl ?? undefined
          },
          expiresAt: stored.expiresAt
        }
      };
    }
  };
}
