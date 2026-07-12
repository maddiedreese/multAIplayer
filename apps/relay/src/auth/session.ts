import type { CookieOptions, Response } from "express";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
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
  accessToken?: string;
  encryptedAccessToken?: {
    algorithm: "AES-GCM-256";
    nonce: string;
    ciphertext: string;
    tag: string;
  };
}

export interface NormalizedStoredAuthSession {
  sessionId: string;
  session: AuthSession;
}

interface RelayAuthSessionPersistenceOptions {
  authSessionMaxAgeMs: number;
  maxAccessTokenChars: number;
  maxAuthSessionIdChars: number;
  maxDisplayNameChars: number;
  maxEncryptedAccessTokenChars: number;
  maxEnvelopeNonceChars: number;
  maxRoomProjectPathChars: number;
  maxUserIdChars: number;
  sessionPersistenceSecret?: string | null;
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
  return new Map(
    Object.entries(parseCookie(header ?? "")).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

export function createRelayAuthSessionPersistence({
  authSessionMaxAgeMs,
  maxAccessTokenChars,
  maxAuthSessionIdChars,
  maxDisplayNameChars,
  maxEncryptedAccessTokenChars,
  maxEnvelopeNonceChars,
  maxRoomProjectPathChars,
  maxUserIdChars,
  sessionPersistenceSecret
}: RelayAuthSessionPersistenceOptions): RelayAuthSessionPersistence {
  function sessionPersistenceKey(): Buffer {
    return Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(sessionPersistenceSecret ?? "", "utf8"),
        "multaiplayer-relay-session-v1",
        "github-session-access-token",
        32
      )
    );
  }

  function encryptSessionAccessToken(accessToken: string): StoredAuthSession["encryptedAccessToken"] | null {
    if (!sessionPersistenceSecret) return null;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", sessionPersistenceKey(), nonce, { authTagLength: 16 });
    const ciphertext = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      algorithm: "AES-GCM-256",
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: tag.toString("base64")
    };
  }

  function decryptStoredAccessToken(stored: Record<string, unknown>): string | null {
    if (!sessionPersistenceSecret || !isRecord(stored.encryptedAccessToken)) return null;
    const encrypted = stored.encryptedAccessToken;
    if (
      encrypted.algorithm !== "AES-GCM-256" ||
      typeof encrypted.nonce !== "string" ||
      typeof encrypted.ciphertext !== "string" ||
      typeof encrypted.tag !== "string" ||
      encrypted.nonce.length > maxEnvelopeNonceChars ||
      encrypted.ciphertext.length > maxEncryptedAccessTokenChars ||
      encrypted.tag.length > maxEnvelopeNonceChars
    ) {
      return null;
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        sessionPersistenceKey(),
        Buffer.from(encrypted.nonce, "base64"),
        {
          authTagLength: 16
        }
      );
      decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString(
        "utf8"
      );
    } catch {
      return null;
    }
  }

  return {
    storedAuthSessions(authSessions) {
      if (!sessionPersistenceSecret) return [];
      const sessions: StoredAuthSession[] = [];
      for (const [sessionId, session] of authSessions.entries()) {
        if (session.expiresAt <= Date.now()) continue;
        const encryptedAccessToken = encryptSessionAccessToken(session.accessToken);
        if (!encryptedAccessToken) continue;
        sessions.push({
          sessionId,
          user: session.user,
          expiresAt: session.expiresAt,
          encryptedAccessToken
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

      const accessToken = decryptStoredAccessToken(stored);
      if (!accessToken || accessToken.length > maxAccessTokenChars) return null;
      return {
        sessionId,
        session: {
          accessToken,
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
