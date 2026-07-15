import { sendRelayError } from "../http/errors.js";
import type { CookieOptions, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { parseCookie } from "cookie";
import { isRecord } from "@multaiplayer/protocol";
import { normalizeMetadataText, normalizeRelayId } from "../limits.js";
import type { AuthSession, NewAuthSession } from "../state.js";

interface RelayAuthSessionManagerOptions {
  authSessions: Map<string, AuthSession>;
  mutationsRequireAuth: boolean;
  nodeEnv: string;
  normalizeSessionId: (value: unknown) => string;
  scheduleStoreSave: () => void;
  isDeletedIdentity?: (userId: string) => boolean;
  isRestrictedIdentity?: (userId: string) => boolean;
}

export interface RelayAuthSessionManager {
  readonly authSessionMaxAgeMs: number;
  authCookieOptions(maxAge?: number): CookieOptions;
  getAuthSession(sessionId: unknown): AuthSession | null;
  setAuthSession(sessionId: string, session: NewAuthSession): void;
  deleteAuthSession(sessionId: unknown): boolean;
  getAuthSessionFromRequest(request: IncomingMessage): AuthSession | undefined;
  allowRead(session: AuthSession | null, res: Response): boolean;
  allowMutation(session: AuthSession | null, res: Response): boolean;
}

export interface StoredAuthSession {
  sessionIdHash: string;
  user: AuthSession["user"];
  expiresAt: number;
}

export interface NormalizedStoredAuthSession {
  sessionIdHash: string;
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
  isDeletedIdentity = () => false,
  isRestrictedIdentity = () => false
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
    const sessionIdHash = hashAuthSessionId(normalizedSessionId);
    const session = authSessions.get(sessionIdHash);
    if (!session) return null;
    if (!isAuthSessionIdHash(session.sessionIdHash) || !sessionIdHashesEqual(session.sessionIdHash, sessionIdHash)) {
      authSessions.delete(sessionIdHash);
      scheduleStoreSave();
      return null;
    }
    if (isDeletedIdentity(session.user.id) || isRestrictedIdentity(session.user.id)) {
      authSessions.delete(sessionIdHash);
      scheduleStoreSave();
      return null;
    }
    if (session.expiresAt <= Date.now()) {
      authSessions.delete(sessionIdHash);
      scheduleStoreSave();
      return null;
    }
    return session;
  }

  function setAuthSession(sessionId: string, session: NewAuthSession): void {
    const sessionIdHash = hashAuthSessionId(sessionId);
    authSessions.set(sessionIdHash, { ...session, sessionIdHash });
  }

  function deleteAuthSession(sessionId: unknown): boolean {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return normalizedSessionId ? authSessions.delete(hashAuthSessionId(normalizedSessionId)) : false;
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
    setAuthSession,
    deleteAuthSession,
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

export function hashAuthSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("hex");
}

function sessionIdHashesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
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
      for (const [sessionIdHash, session] of authSessions.entries()) {
        if (session.expiresAt <= Date.now()) continue;
        if (
          !isAuthSessionIdHash(sessionIdHash) ||
          !isAuthSessionIdHash(session.sessionIdHash) ||
          !sessionIdHashesEqual(session.sessionIdHash, sessionIdHash)
        ) {
          continue;
        }
        sessions.push({
          sessionIdHash,
          user: session.user,
          expiresAt: session.expiresAt
        });
      }
      return sessions;
    },
    normalizeStoredAuthSession(stored) {
      if (!isRecord(stored)) return null;
      const sessionIdHash = normalizeStoredSessionIdHash(stored, maxAuthSessionIdChars);
      const user = normalizeStoredSessionUser(stored.user, {
        maxDisplayNameChars,
        maxRoomProjectPathChars,
        maxUserIdChars
      });
      if (
        !sessionIdHash ||
        typeof stored.expiresAt !== "number" ||
        !Number.isSafeInteger(stored.expiresAt) ||
        stored.expiresAt <= Date.now() ||
        stored.expiresAt > Date.now() + authSessionMaxAgeMs ||
        !user
      ) {
        return null;
      }

      return {
        sessionIdHash,
        session: {
          sessionIdHash,
          user,
          expiresAt: stored.expiresAt
        }
      };
    }
  };
}

function normalizeStoredSessionUser(
  value: unknown,
  limits: Pick<RelayAuthSessionPersistenceOptions, "maxDisplayNameChars" | "maxRoomProjectPathChars" | "maxUserIdChars">
): AuthSession["user"] | null {
  if (!isRecord(value)) return null;
  const id = normalizeMetadataText(value.id, limits.maxUserIdChars);
  const login = normalizeMetadataText(value.login, limits.maxDisplayNameChars);
  const name = value.name === undefined ? undefined : normalizeMetadataText(value.name, limits.maxDisplayNameChars);
  const avatarUrl =
    value.avatarUrl === undefined ? undefined : normalizeMetadataText(value.avatarUrl, limits.maxRoomProjectPathChars);
  if (!id || !login || (value.name !== undefined && !name) || (value.avatarUrl !== undefined && !avatarUrl)) {
    return null;
  }
  return { id, login, ...(name ? { name } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
}

function normalizeStoredSessionIdHash(stored: Record<string, unknown>, maxAuthSessionIdChars: number): string | null {
  if (typeof stored.sessionIdHash === "string" && isAuthSessionIdHash(stored.sessionIdHash)) {
    return stored.sessionIdHash;
  }
  const legacySessionId = normalizeRelayId(stored.sessionId, maxAuthSessionIdChars);
  return legacySessionId ? hashAuthSessionId(legacySessionId) : null;
}

function isAuthSessionIdHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
