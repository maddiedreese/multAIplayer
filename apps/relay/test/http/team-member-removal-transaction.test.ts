import assert from "node:assert/strict";
import test from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { acquireAccountMutationTurn } from "../../src/auth/account-mutation-transaction.js";
import { registerTeamRoutes } from "../../src/http/teams.js";
import { revokeTeamInviteArtifacts } from "../../src/relay-domain.js";
import { createRelayStore, type AuthSession, type ClientSession, type RelayStore } from "../../src/state.js";
import { dispatchRelayClientMessage } from "../../src/ws/connection-dispatch.js";
import type { RelayWebSocketConnectionOptions } from "../../src/ws/connection-types.js";

test("member removal wins the target account turn before an already queued publish", { timeout: 5_000 }, async () => {
  const store = seededStore();
  const session = ownerSession();
  const member = memberSession();
  store.authSessions.set(session.sessionIdHash, session);
  store.authSessions.set(member.sessionIdHash, member);
  const handlerEntered = boundedSignal("member-removal handler did not enter");
  const app = testApp(store, session, {
    getAuthSession: () => {
      handlerEntered.resolve();
      return session;
    }
  });
  const server = await listen(app);
  const releaseGate = await acquireAccountMutationTurn(store, "github:member");
  try {
    const removal = fetch(`${baseUrl(server)}/teams/team/members/github%3Amember`, {
      method: "DELETE",
      headers: { cookie: "multaiplayer_session=owner" }
    });
    await handlerEntered.promise;

    let published = false;
    const sent: unknown[] = [];
    const socket = openSocketFixture();
    const client: ClientSession = {
      socket,
      authSession: member,
      rateClientId: "test",
      teamId: "team",
      roomId: "room",
      userId: "github:member",
      deviceId: "member-device",
      deviceSessionToken: "member-token",
      subscribedTeamIds: new Set<string>(),
      workspaceSubscribed: false
    };
    const publishOptions = publishConnectionFixture(
      store,
      client,
      () => {
        published = true;
      },
      (message) => sent.push(message)
    );
    const queuedPublish = dispatchRelayClientMessage(publishOptions, client, {
      type: "publish",
      message: {
        id: "queued-member-message",
        teamId: "team",
        roomId: "room",
        senderUserId: "github:member",
        senderDeviceId: "member-device",
        messageType: "application",
        epochHint: 0,
        mlsMessage: "AA==",
        createdAt: new Date().toISOString()
      }
    });
    releaseGate();

    assert.equal((await removal).status, 200);
    await queuedPublish;
    assert.equal(published, false);
    assert.deepEqual(sent, [
      {
        type: "error",
        message: "Publishing authorization changed.",
        code: "not_joined",
        messageId: "queued-member-message"
      }
    ]);
  } finally {
    releaseGate();
    await close(server);
  }
});

test(
  "failed member-removal persistence restores membership, team count, deleted-room host identity, and invites",
  { timeout: 5_000 },
  async () => {
    const store = seededStore();
    const session = ownerSession();
    store.authSessions.set(session.sessionIdHash, session);
    const deletedRoom = {
      id: "deleted-room",
      teamId: "team",
      name: "Deleted",
      host: "Member",
      hostUserId: "github:member",
      activeHostDeviceId: "member-device",
      hostStatus: "offline" as const,
      approvalPolicy: "ask_every_turn" as const,
      deletedAt: new Date().toISOString()
    };
    store.setRoom(deletedRoom);
    store.setInvite({
      id: "invite",
      teamId: "team",
      roomId: "deleted-room",
      creatorUserId: "github:owner",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    let revokedSessions = 0;
    let broadcasts = 0;
    const app = testApp(store, session, {
      scheduleStoreSave: () => {
        throw new Error("injected persistence failure");
      },
      revokeTeamMemberSessions: () => {
        revokedSessions += 1;
      },
      broadcastWorkspaceUpdated: () => {
        broadcasts += 1;
      }
    });
    const server = await listen(app);
    try {
      const response = await fetch(`${baseUrl(server)}/teams/team/members/github%3Amember`, {
        method: "DELETE",
        headers: { cookie: "multaiplayer_session=owner" }
      });
      assert.equal(response.status, 503);
      assert.equal(store.getTeamMember("team", "github:member")?.role, "member");
      assert.equal(store.getTeam("team")?.members, 2);
      assert.deepEqual(store.getRoom("deleted-room"), deletedRoom);
      assert.equal(store.getInvite("invite")?.id, "invite");
      assert.equal(revokedSessions, 0);
      assert.equal(broadcasts, 0);
    } finally {
      await close(server);
    }
  }
);

function testApp(
  store: RelayStore,
  session: AuthSession,
  overrides: {
    getAuthSession?: () => AuthSession;
    scheduleStoreSave?: () => void;
    revokeTeamMemberSessions?: () => void;
    broadcastWorkspaceUpdated?: () => void;
  } = {}
) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const scheduleStoreSave = overrides.scheduleStoreSave ?? (() => undefined);
  registerTeamRoutes({
    app,
    store,
    getAuthSession: overrides.getAuthSession ?? (() => session),
    allowRead: () => true,
    allowMutation: () => true,
    teamIdsForUser: () => new Set(["team"]),
    isTeamMember: (teamId, userId) => store.hasTeamMember(teamId, userId),
    teamRoleRank: (role) => (role === "owner" ? 0 : role === "admin" ? 1 : 2),
    canSetTeamMemberRole: () => false,
    canRemoveTeamMember: (requesterRole, targetRole) => requesterRole === "owner" && targetRole !== "owner",
    transferTeamOwnership: (members) => members,
    revokeTeamInvites: (teamId) => {
      if (revokeTeamInviteArtifacts(store, teamId)) scheduleStoreSave();
    },
    revokeTeamMemberSessions: overrides.revokeTeamMemberSessions ?? (() => undefined),
    broadcastWorkspaceUpdated: overrides.broadcastWorkspaceUpdated ?? (() => undefined),
    broadcastRoomUpdated: () => undefined,
    scheduleStoreSave,
    saveRelayStore: async () => undefined,
    normalizeMetadataText: (value) => (typeof value === "string" && value.length > 0 ? value : null),
    maxTeamNameChars: 120
  });
  return app;
}

function seededStore(): RelayStore {
  const store = createRelayStore();
  store.setTeam({ id: "team", name: "Team", members: 2 });
  const joinedAt = new Date().toISOString();
  store.setTeamMembers(
    "team",
    new Map([
      ["github:owner", { teamId: "team", userId: "github:owner", role: "owner", joinedAt }],
      ["github:member", { teamId: "team", userId: "github:member", role: "member", joinedAt }]
    ])
  );
  return store;
}

function ownerSession(): AuthSession {
  return {
    sessionIdHash: "owner-session".padEnd(64, "0"),
    user: { id: "github:owner", login: "owner" },
    expiresAt: Date.now() + 60_000
  };
}

function memberSession(): AuthSession {
  return {
    sessionIdHash: "member-session".padEnd(64, "0"),
    user: { id: "github:member", login: "member" },
    expiresAt: Date.now() + 60_000
  };
}

function openSocketFixture(): WebSocket {
  return { OPEN: 1, readyState: 1, close: () => undefined } as WebSocket;
}

function publishConnectionFixture(
  store: RelayStore,
  client: ClientSession,
  onPublish: () => void,
  onSend: (message: unknown) => void = () => undefined
): RelayWebSocketConnectionOptions {
  return {
    transport: {
      wss: new WebSocketServer({ noServer: true }),
      send: (_socket, message) => onSend(message),
      sendConnectionError: (_socket, message) => onSend(message)
    },
    state: {
      store,
      sessions: new Map([[client.socket, client]]),
      roomPresence: new Map()
    },
    limits: {
      mlsMessageMaxBytes: 1_000_000,
      maxMlsMessageChars: 1_400_000,
      maxDisplayNameChars: 160,
      maxDeviceIdChars: 160,
      maxEnvelopeIdChars: 160,
      maxPublicKeyFingerprintChars: 160,
      maxPublicKeyJwkChars: 1_000,
      maxRoomProjectPathChars: 1_000,
      maxUserIdChars: 160
    },
    authentication: {
      getAuthSessionFromRequest: () => undefined,
      isLiveClientSession: (candidate) =>
        Boolean(
          candidate.authSession && store.authSessions.get(candidate.authSession.sessionIdHash) === candidate.authSession
        ),
      clientIdentityFromIncomingMessage: () => "test"
    },
    rateLimiting: {
      consume: () => ({ allowed: true }),
      connectionCaps: { perUser: 20, perDevice: 5 }
    },
    metrics: {},
    rooms: {
      roomKey: (teamId, roomId) => `${teamId}:${roomId}`,
      isKnownRoom: () => true,
      canAuthenticateJoinIdentity: () => true,
      canJoinRoom: () => true,
      hasDeviceSession: () => true,
      joinRoom: () => undefined,
      canSubscribeTeam: () => true,
      subscribeTeam: () => undefined,
      hasTeam: () => true,
      canSubscribeWorkspace: () => true,
      subscribeWorkspace: () => undefined,
      canPublishMlsMessage: () => true,
      canAccessRoom: (teamId, _roomId, userId) => store.hasTeamMember(teamId, userId),
      publishMlsMessage: async () => onPublish(),
      publishPresence: () => undefined,
      leaveRoom: () => undefined,
      leaveTeams: () => undefined,
      leaveWorkspace: () => undefined
    },
    validation: {
      normalizeMetadataText: (value) => (typeof value === "string" && value.length > 0 ? value : null),
      isJsonStringifiableWithin: () => true,
      isRecord: (value): value is Record<string, unknown> => typeof value === "object" && value !== null
    }
  };
}

function boundedSignal(message: string, timeoutMs = 2_000) {
  let resolve!: () => void;
  let timer: NodeJS.Timeout;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    timer = setTimeout(() => rejectPromise(new Error(message)), timeoutMs);
    resolve = () => {
      clearTimeout(timer);
      resolvePromise();
    };
  });
  return { promise, resolve };
}

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
