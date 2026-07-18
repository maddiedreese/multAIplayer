import { sendRelayError } from "../http/errors.js";
import type { CookieOptions, RequestHandler, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { parseCookie } from "cookie";
import { isRecord } from "@multaiplayer/protocol";
import { normalizeMetadataText } from "../limits.js";
import type { AuthSession, NewAuthSession } from "../state.js";

interface RelayAuthSessionManagerOptions {
  authSessions: Map<string, AuthSession>;
  mutationsRequireAuth: boolean;
  nodeEnv: string;
  normalizeSessionId: (value: unknown) => string;
  scheduleStoreSave: () => void;
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

export const nativeSessionHeaderName = "x-multaiplayer-session";
const webSocketSessionProtocolPrefix = "multaiplayer-session.";

/** Promote the packaged app's opaque session header into the existing route auth path. */
export function nativeSessionHeaderMiddleware(): RequestHandler {
  return (req, res, next) => {
    const suppliedHeader = req.get(nativeSessionHeaderName);
    const headerSession = normalizeTransportSession(suppliedHeader);
    if (suppliedHeader !== undefined && !headerSession) {
      sendRelayError(res, 400, "invalid_request", "Invalid relay session header.");
      return;
    }
    const cookieSession = normalizeTransportSession(req.cookies?.multaiplayer_session);
    if (headerSession && cookieSession && headerSession !== cookieSession) {
      sendRelayError(res, 400, "invalid_request", "Conflicting relay sessions.");
      return;
    }
    if (headerSession) req.cookies.multaiplayer_session = headerSession;
    next();
  };
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
  isRestrictedIdentity = () => false
}: RelayAuthSessionManagerOptions): RelayAuthSessionManager {
  function authCookieOptions(maxAge?: number): CookieOptions {
    const production = nodeEnv === "production";
    return {
      httpOnly: true,
      // The packaged WebView runs at tauri://localhost, so its HTTPS relay
      // session is cross-site. Production still requires an allowlisted exact
      // Origin for browser traffic and all cookie-authenticated mutations.
      sameSite: production ? "none" : "lax",
      secure: production,
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
    if (isRestrictedIdentity(session.user.id)) {
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
    const rawHeaderSession = request.headers[nativeSessionHeaderName];
    const headerSession = normalizeTransportSession(rawHeaderSession);
    if (rawHeaderSession !== undefined && !headerSession) return undefined;
    const webSocketSession = sessionFromWebSocketProtocols(request.headers["sec-websocket-protocol"]);
    if (webSocketSession === null) return undefined;
    const supplied = [
      normalizeTransportSession(cookies.get("multaiplayer_session")),
      headerSession,
      webSocketSession
    ].filter((value): value is string => Boolean(value));
    if (new Set(supplied).size > 1) return undefined;
    return getAuthSession(supplied[0]) ?? undefined;
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

function sessionFromWebSocketProtocols(header: string | string[] | undefined): string | null | undefined {
  if (Array.isArray(header)) return null;
  const candidates = (header ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(webSocketSessionProtocolPrefix));
  if (candidates.length === 0) return undefined;
  if (candidates.length !== 1) return null;
  return normalizeTransportSession(candidates[0]!.slice(webSocketSessionProtocolPrefix.length));
}

function normalizeTransportSession(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return null;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

export function parseCookieHeader(header: string | undefined): Map<string, string> {
  return new Map(
    Object.entries(parseCookie(header ?? "")).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

export function hashAuthSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("hex");
}

export function selectAuthSessionsToEvict(
  authSessions: Map<string, AuthSession>,
  userId: string,
  cap: number,
  reservedSlots: number,
  now: number
): Array<[string, AuthSession]> {
  const owned = Array.from(authSessions.entries())
    .filter(([, session]) => session.user.id === userId)
    .sort((left, right) => left[1].expiresAt - right[1].expiresAt || left[0].localeCompare(right[0]));
  const expired = owned.filter(([, session]) => session.expiresAt <= now);
  const active = owned.filter(([, session]) => session.expiresAt > now);
  const retainedSlots = Math.max(0, cap - reservedSlots);
  return [...expired, ...active.slice(0, Math.max(0, active.length - retainedSlots))];
}

export function pruneRetainedAuthSessions(authSessions: Map<string, AuthSession>, cap: number, now: number): number {
  const userIds = new Set(Array.from(authSessions.values(), (session) => session.user.id));
  let removed = 0;
  for (const userId of userIds) {
    for (const [sessionIdHash] of selectAuthSessionsToEvict(authSessions, userId, cap, 0, now)) {
      if (authSessions.delete(sessionIdHash)) removed += 1;
    }
  }
  return removed;
}

function sessionIdHashesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createRelayAuthSessionPersistence({
  authSessionMaxAgeMs,
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
      if (!hasOnlyKeys(stored, ["sessionIdHash", "user", "expiresAt"])) return null;
      const now = Date.now();
      const sessionIdHash =
        typeof stored.sessionIdHash === "string" && isAuthSessionIdHash(stored.sessionIdHash)
          ? stored.sessionIdHash
          : null;
      const user = normalizeStoredSessionUser(stored.user, {
        maxDisplayNameChars,
        maxRoomProjectPathChars,
        maxUserIdChars
      });
      if (
        !sessionIdHash ||
        typeof stored.expiresAt !== "number" ||
        !Number.isSafeInteger(stored.expiresAt) ||
        stored.expiresAt <= now ||
        stored.expiresAt > now + authSessionMaxAgeMs ||
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
  if (!hasOnlyKeys(value, ["id", "login", "name", "avatarUrl"])) return null;
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

function isAuthSessionIdHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}
