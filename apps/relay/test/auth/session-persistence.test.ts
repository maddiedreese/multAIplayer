import assert from "node:assert/strict";
import test from "node:test";
import {
  createRelayAuthSessionManager,
  createRelayAuthSessionPersistence,
  hashAuthSessionId
} from "../../src/auth/session.js";
import type { AuthSession } from "../../src/state.js";

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
