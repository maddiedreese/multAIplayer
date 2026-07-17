import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerGitHubAuthRoutes } from "../../src/auth/github.js";
import { hashAuthSessionId } from "../../src/auth/session.js";
import { createRelayStore, type AuthSession, type NewAuthSession } from "../../src/state.js";

test(
  "failed bounded-session persistence restores the evicted session before responding",
  { timeout: 5_000 },
  async () => {
    const store = createRelayStore();
    const oldHash = "a".repeat(64);
    const oldSession: AuthSession = {
      sessionIdHash: oldHash,
      user: { id: "github:42", login: "old-login" },
      expiresAt: Date.now() + 30_000
    };
    store.authSessions.set(oldHash, oldSession);
    let socketCloses = 0;
    const socket = {
      close: () => {
        socketCloses += 1;
      }
    };
    store.sessions.set(
      socket as never,
      {
        socket,
        authSession: oldSession,
        rateClientId: "test",
        subscribedTeamIds: new Set(),
        workspaceSubscribed: false
      } as never
    );

    const app = express();
    app.use(express.json());
    registerGitHubAuthRoutes({
      app,
      mutationsRequireAuth: true,
      allowedCorsOrigins: [],
      setAuthSession: (sessionId: string, session: NewAuthSession) => {
        const sessionIdHash = hashAuthSessionId(sessionId);
        store.authSessions.set(sessionIdHash, { ...session, sessionIdHash });
      },
      deleteAuthSession: () => false,
      store,
      deletionLedger: null,
      authSessionMaxAgeMs: 60_000,
      retainedAuthSessionCapPerUser: 1,
      authCookieOptions: () => ({ httpOnly: true }),
      getAuthSession: () => null,
      scheduleStoreSave: () => undefined,
      saveRelayStore: async () => {
        throw new Error("injected persistence failure");
      },
      revokeTeamMemberSessions: () => undefined,
      revokeUserPresence: () => undefined,
      revokeAuthSessionSockets: () => undefined,
      normalizeMetadataText: (value, maximum) =>
        typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null,
      maxUserIdChars: 160,
      maxDisplayNameChars: 120,
      maxRoomProjectPathChars: 2048,
      maxAccessTokenChars: 8192,
      isAccountRestricted: () => false
    });
    const server = await listen(app);
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) =>
      String(input) === "https://api.github.com/user"
        ? Response.json({ id: 42, login: "new-login" })
        : nativeFetch(input, init);
    try {
      const response = await nativeFetch(`${baseUrl(server)}/auth/github/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: "bounded-token" })
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.deepEqual(Array.from(store.authSessions.entries()), [[oldHash, oldSession]]);
      assert.equal(socketCloses, 0);
    } finally {
      globalThis.fetch = nativeFetch;
      await close(server);
    }
  }
);

async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

function baseUrl(server: Awaited<ReturnType<typeof listen>>): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Awaited<ReturnType<typeof listen>>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
