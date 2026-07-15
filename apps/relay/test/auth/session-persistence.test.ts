import assert from "node:assert/strict";
import test from "node:test";
import {
  createRelayAuthSessionManager,
  createRelayAuthSessionPersistence,
  hashAuthSessionId
} from "../../src/auth/session.js";
import type { AuthSession } from "../../src/state.js";
import type { Response } from "express";

const persistence = createRelayAuthSessionPersistence({
  authSessionMaxAgeMs: 1000 * 60 * 60,
  maxAuthSessionIdChars: 128,
  maxDisplayNameChars: 100,
  maxRoomProjectPathChars: 4096,
  maxUserIdChars: 128
});

test("persistence cannot revive a session whose map key and stored digest disagree", () => {
  const bearerToken = "session-token-a";
  const mapKeyHash = hashAuthSessionId(bearerToken);
  const mismatchedSession: AuthSession = {
    sessionIdHash: hashAuthSessionId("session-token-b"),
    user: { id: "github:1", login: "octocat" },
    expiresAt: Date.now() + 60_000
  };

  const serialized = persistence.storedAuthSessions(new Map([[mapKeyHash, mismatchedSession]]));
  const restartedSessions = new Map<string, AuthSession>();
  for (const stored of serialized) {
    const normalized = persistence.normalizeStoredAuthSession(stored);
    if (normalized) restartedSessions.set(normalized.sessionIdHash, normalized.session);
  }
  let scheduledSaves = 0;
  const liveSessions = new Map([[mapKeyHash, mismatchedSession]]);
  const manager = createRelayAuthSessionManager({
    authSessions: liveSessions,
    mutationsRequireAuth: true,
    nodeEnv: "test",
    normalizeSessionId: (value) => (typeof value === "string" ? value : ""),
    scheduleStoreSave: () => {
      scheduledSaves += 1;
    }
  });

  assert.deepEqual(serialized, []);
  assert.equal(restartedSessions.size, 0);
  assert.equal(manager.getAuthSession(bearerToken), null);
  assert.equal(liveSessions.size, 0);
  assert.equal(scheduledSaves, 1);
});

test("matching session digests survive persistence without exposing the bearer token", () => {
  const bearerToken = "session-token-a";
  const sessionIdHash = hashAuthSessionId(bearerToken);
  const serialized = persistence.storedAuthSessions(
    new Map([
      [
        sessionIdHash,
        {
          sessionIdHash,
          user: { id: "github:1", login: "octocat" },
          expiresAt: Date.now() + 60_000
        }
      ]
    ])
  );

  assert.equal(serialized.length, 1);
  assert.equal(serialized[0]?.sessionIdHash, sessionIdHash);
  assert.equal(JSON.stringify(serialized).includes(bearerToken), false);
  const normalized = persistence.normalizeStoredAuthSession(serialized[0]);
  assert.equal(normalized?.sessionIdHash, sessionIdHash);
  assert.equal(normalized?.session.sessionIdHash, sessionIdHash);
  assert.deepEqual(normalized?.session.user, {
    id: "github:1",
    login: "octocat",
    name: undefined,
    avatarUrl: undefined
  });
});

test("session manager validates live state, cookies, authorization, and identity denials", () => {
  const sessions = new Map<string, AuthSession>();
  let saves = 0;
  const deleted = new Set<string>();
  const restricted = new Set<string>();
  const manager = createRelayAuthSessionManager({
    authSessions: sessions,
    mutationsRequireAuth: true,
    nodeEnv: "production",
    normalizeSessionId: (value) => (typeof value === "string" && value.length <= 128 ? value : ""),
    scheduleStoreSave: () => saves++,
    isDeletedIdentity: (id) => deleted.has(id),
    isRestrictedIdentity: (id) => restricted.has(id)
  });
  const token = "live-session-token";
  manager.setAuthSession(token, {
    user: { id: "github:active", login: "active" },
    expiresAt: Date.now() + 60_000
  });
  assert.equal(manager.getAuthSession(token)?.user.id, "github:active");
  assert.deepEqual(manager.authCookieOptions(500), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 500
  });
  assert.equal(
    manager.getAuthSessionFromRequest({ headers: { cookie: `multaiplayer_session=${token}` } } as never)?.user.id,
    "github:active"
  );

  const response = errorResponse();
  assert.equal(manager.allowRead(null, response.value), false);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "authentication_required");
  assert.equal(manager.allowMutation(manager.getAuthSession(token), response.value), true);

  restricted.add("github:active");
  assert.equal(manager.getAuthSession(token), null);
  assert.equal(sessions.size, 0);
  assert.equal(saves, 1);

  manager.setAuthSession(token, {
    user: { id: "github:deleted", login: "deleted" },
    expiresAt: Date.now() + 60_000
  });
  deleted.add("github:deleted");
  assert.equal(manager.getAuthSession(token), null);
  assert.equal(saves, 2);

  manager.setAuthSession(token, {
    user: { id: "github:expired", login: "expired" },
    expiresAt: Date.now() - 1
  });
  assert.equal(manager.getAuthSession(token), null);
  assert.equal(saves, 3);
  assert.equal(manager.deleteAuthSession("missing"), false);
});

function errorResponse() {
  const state = { statusCode: 0, body: {} as Record<string, unknown> };
  const value = {
    status(code: number) {
      state.statusCode = code;
      return value;
    },
    json(body: Record<string, unknown>) {
      state.body = body;
      return value;
    }
  } as unknown as Response;
  return {
    value,
    get statusCode() {
      return state.statusCode;
    },
    get body() {
      return state.body;
    }
  };
}
