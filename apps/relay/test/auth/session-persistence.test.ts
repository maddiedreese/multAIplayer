import assert from "node:assert/strict";
import test from "node:test";
import {
  createRelayAuthSessionManager,
  createRelayAuthSessionPersistence,
  hashAuthSessionId,
  parseCookieHeader
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
    login: "octocat"
  });
  assert.equal(Object.hasOwn(normalized?.session.user ?? {}, "name"), false);
  assert.equal(Object.hasOwn(normalized?.session.user ?? {}, "avatarUrl"), false);
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

test("session manager exposes the exact cookie lifetime and auth behavior", () => {
  const sessions = new Map<string, AuthSession>();
  const manager = createRelayAuthSessionManager({
    authSessions: sessions,
    mutationsRequireAuth: false,
    nodeEnv: "test",
    normalizeSessionId: (value) => (typeof value === "string" ? value.trim() : ""),
    scheduleStoreSave: () => assert.fail("valid operations must not schedule cleanup")
  });

  assert.equal(manager.authSessionMaxAgeMs, 30 * 24 * 60 * 60 * 1000);
  assert.deepEqual(manager.authCookieOptions(), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/"
  });
  const readResponse = errorResponse();
  const mutationResponse = errorResponse();
  assert.equal(manager.allowRead(null, readResponse.value), true);
  assert.equal(manager.allowMutation(null, mutationResponse.value), true);
  assert.equal(readResponse.statusCode, 0);
  assert.equal(mutationResponse.statusCode, 0);

  manager.setAuthSession("trimmed-token", {
    user: { id: "github:trimmed", login: "trimmed" },
    expiresAt: Date.now() + 60_000
  });
  assert.equal(manager.getAuthSession(" trimmed-token ")?.user.id, "github:trimmed");
  assert.equal(manager.getAuthSession(42), null);
  assert.equal(manager.deleteAuthSession(42), false);
  assert.equal(manager.deleteAuthSession(" trimmed-token "), true);
  assert.equal(sessions.size, 0);
});

test("session authorization responses distinguish reads from mutations", () => {
  const manager = createRelayAuthSessionManager({
    authSessions: new Map(),
    mutationsRequireAuth: true,
    nodeEnv: "test",
    normalizeSessionId: (value) => (typeof value === "string" ? value : ""),
    scheduleStoreSave: () => undefined
  });
  const read = errorResponse();
  const mutation = errorResponse();

  assert.equal(manager.allowRead(null, read.value), false);
  assert.deepEqual(read.body, {
    error: "Sign in with GitHub before reading workspace state.",
    code: "authentication_required"
  });
  assert.equal(manager.allowMutation(null, mutation.value), false);
  assert.deepEqual(mutation.body, {
    error: "Sign in with GitHub before changing workspace state.",
    code: "authentication_required"
  });
});

test("cookie parsing preserves decoded session values and rejects absent sessions", () => {
  assert.deepEqual([...parseCookieHeader(undefined)], []);
  assert.deepEqual(
    [...parseCookieHeader("theme=dark; multaiplayer_session=token%20value")],
    [
      ["theme", "dark"],
      ["multaiplayer_session", "token value"]
    ]
  );

  const manager = createRelayAuthSessionManager({
    authSessions: new Map(),
    mutationsRequireAuth: true,
    nodeEnv: "test",
    normalizeSessionId: (value) => (typeof value === "string" ? value : ""),
    scheduleStoreSave: () => undefined
  });
  assert.equal(manager.getAuthSessionFromRequest({ headers: {} } as never), undefined);
});

test("stored sessions reject malformed, expired, and overlong-lived records", () => {
  const now = Date.now();
  const digest = hashAuthSessionId("persisted-token");
  const validUser = { id: "github:1", login: "octocat", name: "Octo Cat", avatarUrl: "https://example.test/a" };
  const valid = { sessionIdHash: digest, user: validUser, expiresAt: now + 30_000 };

  assert.deepEqual(persistence.normalizeStoredAuthSession(valid)?.session.user, validUser);
  assert.equal(persistence.normalizeStoredAuthSession(null), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, sessionIdHash: `g${digest.slice(1)}` }), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, sessionIdHash: `${digest}0` }), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, expiresAt: "soon" }), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, expiresAt: 1.5 }), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, expiresAt: now - 1 }), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, expiresAt: now + 60 * 60 * 1000 + 1 }), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, user: null }), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, user: { ...validUser, id: "" } }), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, user: { ...validUser, login: "" } }), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, user: { ...validUser, name: "" } }), null);
  assert.equal(persistence.normalizeStoredAuthSession({ ...valid, user: { ...validUser, avatarUrl: "" } }), null);
});

test("stored sessions migrate bounded legacy bearer ids to digests", () => {
  const expiresAt = Date.now() + 30_000;
  const normalized = persistence.normalizeStoredAuthSession({
    sessionId: "legacy-token",
    user: { id: "github:legacy", login: "legacy" },
    expiresAt
  });
  assert.equal(normalized?.sessionIdHash, hashAuthSessionId("legacy-token"));
  assert.equal(normalized?.session.expiresAt, expiresAt);
  assert.equal(
    persistence.normalizeStoredAuthSession({
      sessionId: "x".repeat(129),
      user: { id: "github:legacy", login: "legacy" },
      expiresAt
    }),
    null
  );
});

test("session serialization drops expired and malformed digest entries", () => {
  const now = Date.now();
  const validHash = hashAuthSessionId("valid");
  const wrongHash = hashAuthSessionId("wrong");
  const user = { id: "github:1", login: "octocat" };
  const serialized = persistence.storedAuthSessions(
    new Map([
      [validHash, { sessionIdHash: validHash, user, expiresAt: now + 60_000 }],
      [wrongHash, { sessionIdHash: wrongHash, user, expiresAt: now - 1 }],
      ["not-a-digest", { sessionIdHash: "not-a-digest", user, expiresAt: now + 60_000 }]
    ])
  );
  assert.deepEqual(serialized, [{ sessionIdHash: validHash, user, expiresAt: serialized[0]?.expiresAt }]);
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
