import assert from "node:assert/strict";
import test from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import type { AddressInfo } from "node:net";
import type { AuthSession, RelayStore } from "../../src/state.js";
import { acquireDurableQuotaTransaction } from "../../src/auth/account-quotas.js";
import { createAccountRestrictionManager } from "../../src/auth/account-restrictions.js";
import { registerAttachmentRoutes } from "../../src/http/attachments.js";
import { registerRoomCreateRoute } from "../../src/http/room-create-route.js";
import { registerTeamRoutes } from "../../src/http/teams.js";
import { createRelayStore } from "../../src/state.js";

test("team creation rejects a restriction persisted during the global quota wait", { timeout: 5_000 }, async () => {
  const store = createRelayStore();
  const session = makeSession("github:restricted", "restricted");
  store.authSessions.set(session.sessionIdHash, session);
  const firstLiveCheck = observeSessionLookup(store, session, 1);
  const persistenceEntered = boundedSignal("restriction persistence was not entered");
  const allowPersistence = boundedSignal("restriction persistence was not released");
  let persistenceCalls = 0;
  const restrictionManager = createAccountRestrictionManager({
    store,
    liveControl: { revokeUserSessions: () => undefined },
    persist: async () => {
      persistenceCalls += 1;
      if (persistenceCalls !== 1) return;
      persistenceEntered.resolve();
      await allowPersistence.promise;
    }
  });
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  registerTeamRoutes(teamRouteOptions(app, store, session));
  const server = await listen(app);
  const releaseQuota = await acquireDurableQuotaTransaction(store);
  try {
    const responsePromise = post(baseUrl(server), "/teams", { name: "Must not exist" });
    await firstLiveCheck;
    const restrictionPromise = restrictionManager.restrictAccount({
      userId: session.user.id,
      reasonCode: "operator_restriction",
      createdAt: new Date().toISOString()
    });
    await persistenceEntered.promise;
    assert.equal(store.authSessions.get(session.sessionIdHash), session, "session eviction must still be pending");
    releaseQuota();
    const response = await responsePromise;
    assert.equal(response.status, 401);
    assert.equal(store.allTeams().length, 0);
    assert.equal(store.accountQuotaRecords.size, 0);
    allowPersistence.resolve();
    await restrictionPromise;
  } finally {
    allowPersistence.resolve();
    releaseQuota();
    await close(server);
  }
});

test("room creation rechecks membership and team lifecycle after the global quota wait", async (t) => {
  for (const scenario of ["removed", "archived"] as const) {
    await t.test(scenario, async () => {
      const store = createRelayStore();
      const session = makeSession(`github:${scenario}`, scenario);
      seedTeamMembership(store, session, "team");
      let membershipChecks = 0;
      const beforeQuota = boundedSignal(`room ${scenario} request did not reach the quota wait`);
      const app = express();
      app.use(express.json());
      registerRoomCreateRoute(
        roomRouteOptions(app, store, session, {
          isTeamMember: (teamId, userId) => {
            membershipChecks += 1;
            if (membershipChecks >= 2) beforeQuota.resolve();
            return Boolean(store.getTeamMember(teamId, userId));
          }
        })
      );
      const server = await listen(app);
      const releaseQuota = await acquireDurableQuotaTransaction(store);
      try {
        const responsePromise = post(baseUrl(server), "/rooms", { teamId: "team", name: "Must not exist" });
        await beforeQuota.promise;
        if (scenario === "removed") store.getTeamMembers("team")?.delete(session.user.id);
        else store.setTeam({ ...store.getTeam("team")!, archivedAt: new Date().toISOString() });
        releaseQuota();
        const response = await responsePromise;
        assert.equal(response.status, scenario === "removed" ? 403 : 409);
        assert.equal(store.allRooms().length, 0);
        assert.equal(store.accountQuotaRecords.size, 0);
      } finally {
        releaseQuota();
        await close(server);
      }
    });
  }
});

test("cross-account room creation enforces the total cap from the serialized shared-team state", async () => {
  const store = createRelayStore();
  const first = makeSession("github:first", "first");
  const second = makeSession("github:second", "second");
  seedSharedTeam(store, [first, second]);
  let membershipChecks = 0;
  const beforeQuota = boundedSignal("both cross-account room requests did not reach the quota wait");
  const app = express();
  app.use(express.json());
  const sessions = new Map([
    ["first", first],
    ["second", second]
  ]);
  app.use(cookieParser());
  registerRoomCreateRoute(
    roomRouteOptions(app, store, null, {
      getAuthSession: (value) => sessions.get(String(value)) ?? null,
      isTeamMember: (teamId, userId) => {
        membershipChecks += 1;
        if (membershipChecks >= 4) beforeQuota.resolve();
        return Boolean(store.getTeamMember(teamId, userId));
      },
      totalRoomCapPerUser: 1
    })
  );
  const server = await listen(app);
  const releaseQuota = await acquireDurableQuotaTransaction(store);
  try {
    const create = (cookie: string, name: string) =>
      post(baseUrl(server), "/rooms", { teamId: "team", name }, { cookie });
    const responsesPromise = Promise.all([
      create("multaiplayer_session=first", "First"),
      create("multaiplayer_session=second", "Second")
    ]);
    await beforeQuota.promise;
    releaseQuota();
    const responses = await responsesPromise;
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 429]);
    assert.equal(store.allRooms().length, 1);
  } finally {
    releaseQuota();
    await close(server);
  }
});

test("attachment upload rechecks authorization, lifecycle, and blob identity after the global quota wait", async (t) => {
  for (const scenario of ["removed", "archived", "claimed"] as const) {
    await t.test(scenario, async () => {
      const store = createRelayStore();
      const session = makeSession(`github:${scenario}`, scenario);
      seedTeamMembership(store, session, "team");
      store.setRoom(activeRoom("room", "team"));
      let accessChecks = 0;
      const beforeQuota = boundedSignal(`attachment ${scenario} request did not reach the quota wait`);
      const app = express();
      app.use(express.json());
      registerAttachmentRoutes(
        attachmentRouteOptions(app, store, session, (teamId, _roomId, userId) => {
          accessChecks += 1;
          if (accessChecks >= 2) beforeQuota.resolve();
          return Boolean(store.getTeamMember(teamId, userId));
        })
      );
      const server = await listen(app);
      const releaseQuota = await acquireDurableQuotaTransaction(store);
      try {
        const responsePromise = post(baseUrl(server), "/attachment-blobs", attachmentBody("blob"));
        await beforeQuota.promise;
        if (scenario === "removed") store.getTeamMembers("team")?.delete(session.user.id);
        if (scenario === "archived") store.setRoom({ ...store.getRoom("room")!, archivedAt: new Date().toISOString() });
        if (scenario === "claimed") {
          store.setAttachmentBlob({
            id: "blob",
            teamId: "team",
            roomId: "room",
            name: "existing",
            type: "file",
            size: 1,
            epoch: 0,
            sealedBlob: sealedBlob(),
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          });
        }
        releaseQuota();
        const response = await responsePromise;
        assert.equal(response.status, scenario === "removed" ? 403 : 409);
        assert.equal(store.accountQuotaRecords.size, 0);
        assert.equal(store.attachmentBlobs.size, scenario === "claimed" ? 1 : 0);
      } finally {
        releaseQuota();
        await close(server);
      }
    });
  }
});

function teamRouteOptions(app: express.Express, store: RelayStore, session: AuthSession) {
  return {
    app,
    store,
    getAuthSession: () => session,
    allowRead: () => true,
    allowMutation: () => true,
    teamIdsForUser: () => new Set<string>(),
    isTeamMember: () => false,
    teamRoleRank: () => 0,
    canSetTeamMemberRole: () => false,
    canRemoveTeamMember: () => false,
    transferTeamOwnership: (members: Map<string, never>) => members,
    revokeTeamInvites: () => undefined,
    revokeTeamMemberSessions: () => undefined,
    broadcastWorkspaceUpdated: () => undefined,
    broadcastRoomUpdated: () => undefined,
    scheduleStoreSave: () => undefined,
    saveRelayStore: async () => undefined,
    normalizeMetadataText: boundedText,
    maxTeamNameChars: 120
  };
}

function roomRouteOptions(
  app: express.Express,
  store: RelayStore,
  session: AuthSession | null,
  overrides: Record<string, unknown> = {}
) {
  return {
    app,
    store,
    getAuthSession: () => session,
    allowMutation: () => true,
    teamIdsForUser: (userId: string) =>
      new Set(
        store
          .allTeams()
          .filter((team) => store.getTeamMember(team.id, userId))
          .map((team) => team.id)
      ),
    isTeamMember: (teamId: string, userId: string) => Boolean(store.getTeamMember(teamId, userId)),
    canAccessRoom: () => true,
    scheduleStoreSave: () => undefined,
    saveRelayStore: async () => undefined,
    broadcastRoomUpdated: () => undefined,
    requesterFromRequest: () => ({ id: session?.user.id ?? "", name: session?.user.login ?? "" }),
    isRoomHost: () => false,
    isApprovalPolicy: (value: string): value is "ask_every_turn" => value === "ask_every_turn",
    normalizeMetadataText: boundedText,
    normalizeOptionalMetadataText: boundedText,
    displayNameForUser: (user: AuthSession["user"]) => user.login,
    maxDeviceIdChars: 160,
    maxHostNameChars: 120,
    maxRoomNameChars: 120,
    maxUserIdChars: 160,
    deviceAuthRequired: false,
    ...overrides
  };
}

function attachmentRouteOptions(
  app: express.Express,
  store: RelayStore,
  session: AuthSession,
  canAccessRoom: (teamId: string, roomId: string, userId: string) => boolean
) {
  return {
    app,
    store,
    attachmentBlobMaxBytes: 1024,
    attachmentBlobLiveQuotaBytes: 4096,
    attachmentBlobTeamLiveQuotaBytes: 4096,
    attachmentBlobUploadBytesPerWindow: 4096,
    attachmentBlobUploadWindowMs: 60_000,
    attachmentBlobTtlDays: 1,
    maxAttachmentBlobNameChars: 512,
    maxAttachmentBlobTypeChars: 120,
    getAuthSession: () => session,
    allowRead: () => true,
    allowMutation: () => true,
    canAccessRoom,
    scheduleStoreSave: () => undefined,
    saveRelayStore: async () => undefined,
    normalizeMetadataText: boundedText,
    maxCiphertextCharactersForBlob: () => 4096,
    isExpiredAttachmentBlob: () => false
  };
}

function makeSession(userId: string, login: string): AuthSession {
  return {
    sessionIdHash: userId.padEnd(64, "0").slice(0, 64),
    user: { id: userId, login },
    expiresAt: Date.now() + 60_000
  };
}

function seedTeamMembership(store: RelayStore, session: AuthSession, teamId: string) {
  store.setTeam({ id: teamId, name: "Team", members: 1 });
  store.setTeamMembers(
    teamId,
    new Map([
      [
        session.user.id,
        { teamId, userId: session.user.id, role: "member" as const, joinedAt: new Date().toISOString() }
      ]
    ])
  );
  store.authSessions.set(session.sessionIdHash, session);
}

function seedSharedTeam(store: RelayStore, sessions: AuthSession[]) {
  store.setTeam({ id: "team", name: "Team", members: sessions.length });
  store.setTeamMembers(
    "team",
    new Map(
      sessions.map((session) => [
        session.user.id,
        { teamId: "team", userId: session.user.id, role: "member" as const, joinedAt: new Date().toISOString() }
      ])
    )
  );
  for (const session of sessions) store.authSessions.set(session.sessionIdHash, session);
}

function activeRoom(id: string, teamId: string) {
  return {
    id,
    teamId,
    name: "Room",
    host: "Host",
    hostStatus: "active" as const,
    approvalPolicy: "ask_every_turn" as const
  };
}

function observeSessionLookup(store: RelayStore, session: AuthSession, occurrence: number): Promise<void> {
  const originalGet = store.authSessions.get.bind(store.authSessions);
  const observed = boundedSignal(`session lookup ${occurrence} was not observed`);
  let count = 0;
  store.authSessions.get = (key) => {
    if (key === session.sessionIdHash && ++count >= occurrence) observed.resolve();
    return originalGet(key);
  };
  return observed.promise;
}

function boundedSignal(message: string, timeoutMs = 2_000): { promise: Promise<void>; resolve: () => void } {
  let resolveSignal!: () => void;
  let settled = false;
  const promise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(message));
    }, timeoutMs);
    resolveSignal = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
  });
  return { promise, resolve: resolveSignal };
}

function attachmentBody(blobId: string) {
  return {
    blobId,
    teamId: "team",
    roomId: "room",
    name: "asset",
    type: "file",
    size: 32,
    epoch: 0,
    sealedBlob: sealedBlob()
  };
}

function sealedBlob() {
  return JSON.stringify({
    version: 1,
    epoch: 0,
    nonce: Buffer.alloc(12, 1).toString("base64"),
    ciphertext: Buffer.from("opaque").toString("base64")
  });
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

async function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

async function listen(app: express.Express) {
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

function baseUrl(server: Awaited<ReturnType<typeof listen>>) {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Awaited<ReturnType<typeof listen>>) {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
