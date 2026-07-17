import express from "express";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { acquireAccountMutationTurns } from "../../src/auth/account-mutation-transaction.js";
import { registerTeamRoutes } from "../../src/http/teams.js";
import { createRelayStore, type AuthSession, type RelayStore } from "../../src/state.js";
import {
  Database,
  WebSocket,
  assert,
  createDebugSession,
  defaultWorkspaceFixture,
  delay,
  onceOpen,
  startRelay,
  waitForClose,
  waitForError,
  waitForErrorDetails,
  waitForJoined,
  waitForStoredState,
  waitForTeamUpdated,
  waitForWorkspaceSubscribed
} from "../support/relay.js";

test("relay scopes authenticated workspace access to team members and admits invitees", async () => {
  const relay = await startRelay(
    { MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" },
    approvedInviteFixture("device-peer-123")
  );
  const maddieCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
  const peerCookie = await createDebugSession(relay.baseUrl, "github:peer", "peer");
  let peerSocket: WebSocket | null = null;
  try {
    const unauthTeams = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(unauthTeams.status, 401);

    const peerWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: peerCookie }
    });
    assert.equal(peerWorkspace.status, 200);
    assert.deepEqual(await peerWorkspace.json(), { teams: [], rooms: [] });

    const deniedRoom = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: peerCookie },
      body: JSON.stringify({
        teamId: "team-core",
        name: "Peer room"
      })
    });
    assert.equal(deniedRoom.status, 403);

    const memberWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: maddieCookie }
    });
    assert.equal(memberWorkspace.status, 200);
    const memberBody = (await memberWorkspace.json()) as {
      teams: Array<{ id: string; role?: string }>;
      rooms: Array<{ id: string }>;
    };
    assert.deepEqual(
      memberBody.teams.map((team) => team.id),
      ["team-core"]
    );
    assert.equal(memberBody.teams[0]?.role, "owner");
    assert.ok(memberBody.rooms.some((room) => room.id === "room-desktop"));
    assert.ok(!memberBody.rooms.some((room) => room.id === "room-github"));

    const inviteBody = { invite: { id: "invite-approved" } };

    const invalidDeviceSocket = new WebSocket(relay.wsUrl, { headers: { cookie: peerCookie } });
    await onceOpen(invalidDeviceSocket);
    const invalidDeviceError = waitForError(invalidDeviceSocket);
    invalidDeviceSocket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:peer",
        deviceId: "device-peer-123",
        inviteId: inviteBody.invite.id,
        deviceSessionToken: "invalid-device-session-token-000000000000"
      })
    );
    assert.match(await invalidDeviceError, /device-authenticated session/);
    invalidDeviceSocket.close();
    const workspaceAfterInvalidDevice = await fetch(`${relay.baseUrl}/teams`, { headers: { cookie: peerCookie } });
    assert.deepEqual(await workspaceAfterInvalidDevice.json(), { teams: [], rooms: [] });

    peerSocket = new WebSocket(relay.wsUrl, { headers: { cookie: peerCookie } });
    await onceOpen(peerSocket);
    peerSocket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:peer",
        deviceId: "device-peer-123",
        inviteId: inviteBody.invite.id,
        deviceSessionToken: "debug-device-session-token-000000"
      })
    );
    await waitForJoined(peerSocket);

    const admittedWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: peerCookie }
    });
    assert.equal(admittedWorkspace.status, 200);
    const admittedBody = (await admittedWorkspace.json()) as {
      teams: Array<{ id: string; role?: string }>;
      rooms: Array<{ id: string }>;
    };
    assert.deepEqual(
      admittedBody.teams.map((team) => team.id),
      ["team-core"]
    );
    assert.equal(admittedBody.teams[0]?.role, "member");
    assert.ok(admittedBody.rooms.some((room) => room.id === "room-desktop"));

    const membersResponse = await fetch(`${relay.baseUrl}/teams/team-core/members`, {
      headers: { cookie: peerCookie }
    });
    assert.equal(membersResponse.status, 200);
    const membersBody = (await membersResponse.json()) as {
      members: Array<{ userId: string; role: string; joinedAt: string }>;
    };
    assert.equal(membersBody.members.find((member) => member.userId === "github:maddiedreese")?.role, "owner");
    assert.equal(membersBody.members.find((member) => member.userId === "github:peer")?.role, "member");
  } finally {
    peerSocket?.close();
    await relay.close();
  }
});

test("relay revokes live room access and stale invites when a team member is removed", async () => {
  const relay = await startRelay(
    { MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" },
    approvedInviteFixture("device-peer-removed")
  );
  const ownerCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
  const peerCookie = await createDebugSession(relay.baseUrl, "github:peer", "peer");
  let peerSocket: WebSocket | null = null;
  let staleInviteSocket: WebSocket | null = null;
  try {
    const inviteBody = { invite: { id: "invite-approved" } };

    peerSocket = new WebSocket(relay.wsUrl, { headers: { cookie: peerCookie } });
    await onceOpen(peerSocket);
    peerSocket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:peer",
        deviceId: "device-peer-removed",
        inviteId: inviteBody.invite.id,
        deviceSessionToken: "debug-device-session-token-000000"
      })
    );
    await waitForJoined(peerSocket);

    const removalError = waitForErrorDetails(peerSocket);
    const removalClose = waitForClose(peerSocket);
    const removeResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Apeer`, {
      method: "DELETE",
      headers: { cookie: ownerCookie }
    });
    assert.equal(removeResponse.status, 200);
    const scopedRemoval = await removalError;
    assert.match(scopedRemoval.message, /membership was removed/);
    assert.equal(scopedRemoval.code, "membership_removed");
    assert.equal(scopedRemoval.teamId, "team-core");
    assert.equal((await removalClose).code, 1008);

    const peerWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: peerCookie }
    });
    assert.equal(peerWorkspace.status, 200);
    assert.deepEqual(await peerWorkspace.json(), { teams: [], rooms: [] });

    staleInviteSocket = new WebSocket(relay.wsUrl, { headers: { cookie: peerCookie } });
    await onceOpen(staleInviteSocket);
    const staleInviteError = waitForError(staleInviteSocket);
    staleInviteSocket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:peer",
        deviceId: "device-peer-stale-invite",
        inviteId: inviteBody.invite.id,
        deviceSessionToken: "debug-device-session-token-000000"
      })
    );
    assert.match(await staleInviteError, /valid invite/);
  } finally {
    peerSocket?.close();
    staleInviteSocket?.close();
    await relay.close();
  }
});

test("relay requires host handoff before removing an active room host", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" });
  const ownerCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
  const hostCookie = await createDebugSession(relay.baseUrl, "github:alex", "alex");
  const hostSocket = new WebSocket(relay.wsUrl, { headers: { cookie: hostCookie } });
  try {
    await onceOpen(hostSocket);
    hostSocket.send(
      JSON.stringify({
        type: "subscribe.workspace",
        userId: "github:alex",
        deviceId: "alex-device-1"
      })
    );
    await waitForWorkspaceSubscribed(hostSocket);

    const workspaceRowsBefore = readTeamWorkspaceRows(relay.dataPath);
    const messagesAfterAttempt: Array<{ type?: string; code?: string }> = [];
    let socketClosed = false;
    hostSocket.on("message", (raw) => {
      messagesAfterAttempt.push(JSON.parse(raw.toString()) as { type?: string; code?: string });
    });
    hostSocket.on("close", () => {
      socketClosed = true;
    });

    const removeResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Aalex`, {
      method: "DELETE",
      headers: { cookie: ownerCookie }
    });
    assert.equal(removeResponse.status, 409);
    assert.deepEqual(await removeResponse.json(), {
      error: "Reassign room host authority before removing this team member.",
      code: "conflict",
      roomId: "room-relay"
    });

    await delay(150);
    assert.equal(socketClosed, false);
    assert.equal(hostSocket.readyState, WebSocket.OPEN);
    assert.ok(!messagesAfterAttempt.some((message) => message.type === "team.updated"));
    assert.ok(!messagesAfterAttempt.some((message) => message.code === "membership_removed"));
    assert.deepEqual(readTeamWorkspaceRows(relay.dataPath), workspaceRowsBefore);

    const membersResponse = await fetch(`${relay.baseUrl}/teams/team-core/members`, {
      headers: { cookie: hostCookie }
    });
    assert.equal(membersResponse.status, 200);
    const membersBody = (await membersResponse.json()) as { members: Array<{ userId: string }> };
    assert.ok(membersBody.members.some((member) => member.userId === "github:alex"));
  } finally {
    hostSocket.close();
    await relay.close();
  }
});

test("relay preserves offline and archived room host membership until authority is reassigned", async () => {
  const cases = [
    {
      name: "offline",
      update: { hostStatus: "offline", activeHostDeviceId: undefined }
    },
    {
      name: "archived",
      update: { archivedAt: new Date().toISOString() }
    }
  ] as const;

  for (const scenario of cases) {
    const fixture = defaultWorkspaceFixture();
    fixture.rooms = (fixture.rooms as Array<Record<string, unknown>>).map((room) =>
      room.id === "room-relay" ? { ...room, ...scenario.update } : room
    );
    const relay = await startRelay({ MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" }, fixture);
    const ownerCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    try {
      const removeResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Aalex`, {
        method: "DELETE",
        headers: { cookie: ownerCookie }
      });
      assert.equal(removeResponse.status, 409, scenario.name);
      assert.deepEqual(
        await removeResponse.json(),
        {
          error: "Reassign room host authority before removing this team member.",
          code: "conflict",
          roomId: "room-relay"
        },
        scenario.name
      );

      const membersResponse = await fetch(`${relay.baseUrl}/teams/team-core/members`, {
        headers: { cookie: ownerCookie }
      });
      const members = (await membersResponse.json()) as { members: Array<{ userId: string }> };
      assert.ok(
        members.members.some((member) => member.userId === "github:alex"),
        scenario.name
      );
    } finally {
      await relay.close();
    }
  }
});

test("relay scrubs deleted-room host identity before member removal and survives restart", async () => {
  const fixture = defaultWorkspaceFixture();
  const deletedAt = new Date().toISOString();
  fixture.rooms = (fixture.rooms as Array<Record<string, unknown>>).map((room) =>
    room.id === "room-relay" ? { ...room, archivedAt: undefined, deletedAt } : room
  );
  const relay = await startRelay({ MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" }, fixture);
  let restarted: Awaited<ReturnType<typeof startRelay>> | null = null;
  let firstRelayClosed = false;
  try {
    const ownerCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const removeResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Aalex`, {
      method: "DELETE",
      headers: { cookie: ownerCookie }
    });
    assert.equal(removeResponse.status, 200);
    const removed = (await removeResponse.json()) as { members: Array<{ userId: string }> };
    assert.ok(!removed.members.some((member) => member.userId === "github:alex"));

    const stored = await waitForStoredState(relay.dataPath, (state) => {
      const memberGroups = state.teamMembers as Array<{ members?: Array<{ userId?: string }> }> | undefined;
      const rooms = state.rooms as Array<{ id?: string; hostUserId?: string; activeHostDeviceId?: string }>;
      const deletedRoom = rooms.find((room) => room.id === "room-relay");
      return Boolean(
        memberGroups?.[0]?.members &&
        !memberGroups[0].members.some((member) => member.userId === "github:alex") &&
        deletedRoom &&
        !deletedRoom.hostUserId &&
        !deletedRoom.activeHostDeviceId
      );
    });
    const deletedRoom = (stored.rooms as Array<Record<string, unknown>>).find((room) => room.id === "room-relay");
    assert.deepEqual(
      deletedRoom && {
        host: deletedRoom.host,
        hostUserId: deletedRoom.hostUserId,
        activeHostDeviceId: deletedRoom.activeHostDeviceId,
        hostStatus: deletedRoom.hostStatus,
        deletedAt: deletedRoom.deletedAt
      },
      {
        host: "Former member",
        hostUserId: undefined,
        activeHostDeviceId: undefined,
        hostStatus: "offline",
        deletedAt
      }
    );

    await relay.close({ preserveData: true });
    firstRelayClosed = true;
    restarted = await startRelay({ MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" }, undefined, relay.dataPath);
    const restartedOwnerCookie = await createDebugSession(restarted.baseUrl, "github:maddiedreese", "maddiedreese");
    const membersResponse = await fetch(`${restarted.baseUrl}/teams/team-core/members`, {
      headers: { cookie: restartedOwnerCookie }
    });
    assert.equal(membersResponse.status, 200);
    const restartedMembers = (await membersResponse.json()) as { members: Array<{ userId: string }> };
    assert.ok(!restartedMembers.members.some((member) => member.userId === "github:alex"));
  } finally {
    if (restarted) await restarted.close();
    else if (!firstRelayClosed) await relay.close();
  }
});

test(
  "member removal waits for a failed host handoff to roll back before checking authority",
  { timeout: 5_000 },
  async () => {
    const fixture = memberRemovalUnitFixture();
    const originalRoom = {
      id: "room-hosted",
      teamId: fixture.teamId,
      name: "Hosted room",
      host: "Target",
      hostUserId: fixture.targetUserId,
      activeHostDeviceId: "target-device",
      hostStatus: "active" as const,
      acceptedMlsEpoch: 0,
      approvalPolicy: "ask_every_turn" as const
    };
    fixture.store.setRoom(originalRoom);

    const releaseHandoffTurn = await acquireAccountMutationTurns(fixture.store, [
      fixture.session.user.id,
      fixture.targetUserId
    ]);
    fixture.store.setRoom({
      ...originalRoom,
      host: "Owner",
      hostUserId: fixture.session.user.id,
      activeHostDeviceId: "owner-device"
    });
    const requestObserved = testSignal();
    let persistenceCalls = 0;
    const server = await listenForMemberRemoval(fixture, {
      requestObserved,
      scheduleStoreSave: () => {
        persistenceCalls += 1;
      }
    });
    let handoffTurnHeld = true;
    try {
      const responsePromise = deleteUnitMember(server, fixture);
      await requestObserved.promise;

      // A failed handoff restores the outgoing host while holding both account
      // turns. Removal must observe this rollback, not the tentative authority.
      fixture.store.setRoom(originalRoom);
      releaseHandoffTurn();
      handoffTurnHeld = false;

      const response = await responsePromise;
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: "Reassign room host authority before removing this team member.",
        code: "conflict",
        roomId: originalRoom.id
      });
      assert.ok(fixture.store.getTeamMember(fixture.teamId, fixture.targetUserId));
      assert.equal(persistenceCalls, 0);
    } finally {
      if (handoffTurnHeld) releaseHandoffTurn();
      await closeMemberRemovalServer(server);
    }
  }
);

test(
  "queued member removal revalidates requester and target authorization after waiting",
  { timeout: 10_000 },
  async (t) => {
    const scenarios = [
      {
        name: "logged-out requester",
        change: (fixture: MemberRemovalUnitFixture) => {
          fixture.store.authSessions.delete(fixture.session.sessionIdHash);
        },
        status: 401,
        code: "authentication_required"
      },
      {
        name: "demoted requester",
        change: (fixture: MemberRemovalUnitFixture) => {
          fixture.store.getTeamMembers(fixture.teamId)!.set(fixture.session.user.id, {
            ...fixture.store.getTeamMember(fixture.teamId, fixture.session.user.id)!,
            role: "member"
          });
        },
        status: 403,
        code: "forbidden"
      },
      {
        name: "already-removed target",
        change: (fixture: MemberRemovalUnitFixture) => {
          fixture.store.getTeamMembers(fixture.teamId)!.delete(fixture.targetUserId);
        },
        status: 404,
        code: "team_member_not_found"
      }
    ] as const;

    for (const scenario of scenarios) {
      await t.test(scenario.name, async () => {
        const fixture = memberRemovalUnitFixture();
        const releaseBlockingTurn = await acquireAccountMutationTurns(fixture.store, [
          fixture.session.user.id,
          fixture.targetUserId
        ]);
        const requestObserved = testSignal();
        let persistenceCalls = 0;
        const server = await listenForMemberRemoval(fixture, {
          requestObserved,
          scheduleStoreSave: () => {
            persistenceCalls += 1;
          }
        });
        let blockingTurnHeld = true;
        try {
          const responsePromise = deleteUnitMember(server, fixture);
          await requestObserved.promise;
          scenario.change(fixture);
          releaseBlockingTurn();
          blockingTurnHeld = false;

          const response = await responsePromise;
          assert.equal(response.status, scenario.status);
          const body = (await response.json()) as { code: string };
          assert.equal(body.code, scenario.code);
          assert.equal(persistenceCalls, 0);
        } finally {
          if (blockingTurnHeld) releaseBlockingTurn();
          await closeMemberRemovalServer(server);
        }
      });
    }
  }
);

interface MemberRemovalUnitFixture {
  store: RelayStore;
  session: AuthSession;
  teamId: string;
  targetUserId: string;
}

function memberRemovalUnitFixture(): MemberRemovalUnitFixture {
  const store = createRelayStore();
  const teamId = "team-race";
  const targetUserId = "github:target";
  const session: AuthSession = {
    sessionIdHash: "member-removal-owner-session".padEnd(64, "0"),
    user: { id: "github:owner", login: "owner" },
    expiresAt: Date.now() + 60_000
  };
  store.authSessions.set(session.sessionIdHash, session);
  store.setTeam({ id: teamId, name: "Race team", members: 2 });
  store.setTeamMembers(
    teamId,
    new Map([
      [
        session.user.id,
        { teamId, userId: session.user.id, role: "owner" as const, joinedAt: new Date().toISOString() }
      ],
      [targetUserId, { teamId, userId: targetUserId, role: "member" as const, joinedAt: new Date().toISOString() }]
    ])
  );
  store.discardDurableMutations();
  return { store, session, teamId, targetUserId };
}

async function listenForMemberRemoval(
  fixture: MemberRemovalUnitFixture,
  options: { requestObserved: ReturnType<typeof testSignal>; scheduleStoreSave: () => void }
) {
  const app = express();
  registerTeamRoutes({
    app,
    store: fixture.store,
    getAuthSession: () => {
      options.requestObserved.resolve();
      return fixture.session;
    },
    allowRead: () => true,
    allowMutation: () => true,
    teamIdsForUser: () => new Set([fixture.teamId]),
    isTeamMember: (teamId, userId) => Boolean(fixture.store.getTeamMember(teamId, userId)),
    teamRoleRank: (role) => ({ owner: 0, admin: 1, member: 2 })[role],
    canSetTeamMemberRole: () => false,
    canRemoveTeamMember: (requesterRole, targetRole) => requesterRole === "owner" && targetRole !== "owner",
    transferTeamOwnership: (members) => members,
    revokeTeamInvites: () => undefined,
    revokeTeamMemberSessions: () => undefined,
    broadcastWorkspaceUpdated: () => undefined,
    broadcastRoomUpdated: () => undefined,
    scheduleStoreSave: options.scheduleStoreSave,
    saveRelayStore: async () => undefined,
    normalizeMetadataText: (value, maximum) =>
      typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null,
    maxTeamNameChars: 120
  });
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

function deleteUnitMember(
  server: Awaited<ReturnType<typeof listenForMemberRemoval>>,
  fixture: MemberRemovalUnitFixture
) {
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}/teams/${fixture.teamId}/members/${fixture.targetUserId}`, {
    method: "DELETE"
  });
}

async function closeMemberRemovalServer(server: Awaited<ReturnType<typeof listenForMemberRemoval>>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function testSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolveSignal!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  return { promise, resolve: resolveSignal };
}

function readTeamWorkspaceRows(dataPath: string): { teams: unknown[]; teamMembers: unknown[] } {
  const database = new Database(dataPath, { readonly: true });
  try {
    return {
      teams: database.prepare("select id, data_json from relay_teams order by id").all(),
      teamMembers: database.prepare("select team_id, data_json from relay_team_members order by team_id").all()
    };
  } finally {
    database.close();
  }
}

function approvedInviteFixture(deviceId: string) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const keyPackageHash = `sha256:${"a".repeat(64)}`;
  return {
    version: 1 as const,
    savedAt: createdAt,
    teams: [{ id: "team-core", name: "Core Team", members: 1 }],
    rooms: [
      {
        id: "room-desktop",
        teamId: "team-core",
        name: "Desktop app",
        host: "Maddie",
        hostUserId: "github:maddiedreese",
        hostStatus: "active",
        activeHostDeviceId: "host-device",
        acceptedMlsEpoch: 0,
        approvalPolicy: "ask_every_turn"
      }
    ],
    invites: [
      {
        id: "invite-approved",
        teamId: "team-core",
        roomId: "room-desktop",
        approvedUserId: "github:peer",
        approvedDeviceId: deviceId,
        keyPackageHash,
        createdAt
      }
    ],
    inviteResponses: [
      {
        requestId: "request-approved",
        inviteId: "invite-approved",
        requesterUserId: "github:peer",
        requesterDeviceId: deviceId,
        keyPackageHash,
        status: "approved" as const,
        responseBinding: {
          version: 3 as const,
          phase: "response" as const,
          inviteId: "invite-approved",
          teamId: "team-core",
          roomId: "room-desktop",
          keyEpoch: 0,
          keyPackageHash,
          requestId: "request-approved",
          requestNonce: "request-nonce",
          requesterUserId: "github:peer",
          requesterDeviceId: deviceId,
          hostUserId: "github:maddiedreese",
          hostDeviceId: "host-device",
          expiresAt,
          status: "approved" as const,
          decidedAt: createdAt
        },
        responseMac: "AA==",
        welcome: "AA==",
        createdAt
      }
    ],
    teamMembers: [
      {
        teamId: "team-core",
        members: [{ teamId: "team-core", userId: "github:maddiedreese", role: "owner", joinedAt: createdAt }]
      }
    ],
    encryptedBacklog: []
  };
}

test("relay assigns team creators owner role", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false"
  });
  const cookie = await createDebugSession(relay.baseUrl, "github:owner", "owner");
  try {
    const createResponse = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Owner Team" })
    });
    assert.equal(createResponse.status, 201);
    const createBody = (await createResponse.json()) as { team: { id: string; members: number; role?: string } };
    assert.equal(createBody.team.members, 1);
    assert.equal(createBody.team.role, "owner");

    const membersResponse = await fetch(`${relay.baseUrl}/teams/${createBody.team.id}/members`, {
      headers: { cookie }
    });
    assert.equal(membersResponse.status, 200);
    const membersBody = (await membersResponse.json()) as {
      members: Array<{ userId: string; role: string }>;
    };
    assert.deepEqual(
      membersBody.members.map((member) => ({ userId: member.userId, role: member.role })),
      [{ userId: "github:owner", role: "owner" }]
    );
  } finally {
    await relay.close();
  }
});

test("relay lets authorized team roles manage non-owner members", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" });
  const ownerCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
  const adminCookie = await createDebugSession(relay.baseUrl, "github:alex", "alex");
  const memberCookie = await createDebugSession(relay.baseUrl, "github:tester", "tester");
  try {
    const promoteResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Atester`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ role: "admin" })
    });
    assert.equal(promoteResponse.status, 200);
    const promoted = (await promoteResponse.json()) as {
      member: { userId: string; role: string };
      members: Array<{ userId: string; role: string }>;
    };
    assert.equal(promoted.member.userId, "github:tester");
    assert.equal(promoted.member.role, "admin");

    const adminDemoteResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Atester`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ role: "member" })
    });
    assert.equal(adminDemoteResponse.status, 403);

    const ownerDemoteResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Atester`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ role: "member" })
    });
    assert.equal(ownerDemoteResponse.status, 200);

    const memberPromoteResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Adesign`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: memberCookie },
      body: JSON.stringify({ role: "admin" })
    });
    assert.equal(memberPromoteResponse.status, 403);

    const adminTransferResponse = await fetch(
      `${relay.baseUrl}/teams/team-core/members/github%3Atester/transfer-owner`,
      {
        method: "POST",
        headers: { cookie: adminCookie }
      }
    );
    assert.equal(adminTransferResponse.status, 403);

    const transferResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Aalex/transfer-owner`, {
      method: "POST",
      headers: { cookie: ownerCookie }
    });
    assert.equal(transferResponse.status, 200);
    const transferred = (await transferResponse.json()) as {
      member: { userId: string; role: string };
      members: Array<{ userId: string; role: string }>;
    };
    assert.equal(transferred.member.userId, "github:alex");
    assert.equal(transferred.member.role, "owner");
    assert.deepEqual(
      transferred.members.filter((member) => member.role === "owner").map((member) => member.userId),
      ["github:alex"]
    );
    assert.equal(transferred.members.find((member) => member.userId === "github:maddiedreese")?.role, "admin");

    const removeOwnerResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Amaddiedreese`, {
      method: "DELETE",
      headers: { cookie: ownerCookie }
    });
    assert.equal(removeOwnerResponse.status, 403);

    const removeMemberResponse = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Adesign`, {
      method: "DELETE",
      headers: { cookie: adminCookie }
    });
    assert.equal(removeMemberResponse.status, 200);
    const removed = (await removeMemberResponse.json()) as { members: Array<{ userId: string }> };
    assert.ok(!removed.members.some((member) => member.userId === "github:design"));
  } finally {
    await relay.close();
  }
});

test("relay archives restores and deletes teams with their rooms", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" });
  const ownerCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
  const adminCookie = await createDebugSession(relay.baseUrl, "github:alex", "alex");
  try {
    const archiveResponse = await fetch(`${relay.baseUrl}/teams/team-core/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ action: "archive" })
    });
    assert.equal(archiveResponse.status, 200);
    const archived = (await archiveResponse.json()) as {
      team: { id: string; archivedAt?: string; deletedAt?: string };
      rooms: Array<{ id: string; archivedAt?: string; deletedAt?: string }>;
    };
    assert.equal(archived.team.id, "team-core");
    assert.ok(archived.team.archivedAt);
    assert.ok(archived.rooms.every((room) => room.archivedAt && !room.deletedAt));

    const createInArchivedTeam = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ teamId: "team-core", name: "Archived Child" })
    });
    assert.equal(createInArchivedTeam.status, 409);

    const restoreResponse = await fetch(`${relay.baseUrl}/teams/team-core/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ action: "restore" })
    });
    assert.equal(restoreResponse.status, 200);
    const restored = (await restoreResponse.json()) as {
      team: { archivedAt?: string };
      rooms: Array<{ archivedAt?: string }>;
    };
    assert.equal(restored.team.archivedAt, undefined);
    assert.ok(restored.rooms.every((room) => room.archivedAt === undefined));

    const adminDeleteResponse = await fetch(`${relay.baseUrl}/teams/team-core/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ action: "delete" })
    });
    assert.equal(adminDeleteResponse.status, 403);

    const deleteResponse = await fetch(`${relay.baseUrl}/teams/team-core/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ action: "delete" })
    });
    assert.equal(deleteResponse.status, 200);
    const deleted = (await deleteResponse.json()) as {
      team: { deletedAt?: string };
      rooms: Array<{ deletedAt?: string }>;
    };
    assert.ok(deleted.team.deletedAt);
    assert.ok(deleted.rooms.every((room) => room.deletedAt));

    const workspaceAfterDelete = await fetch(`${relay.baseUrl}/teams`, { headers: { cookie: ownerCookie } });
    const deletedWorkspace = (await workspaceAfterDelete.json()) as {
      teams: Array<{ id: string }>;
      rooms: Array<{ teamId: string }>;
    };
    assert.ok(!deletedWorkspace.teams.some((team) => team.id === "team-core"));
    assert.ok(!deletedWorkspace.rooms.some((room) => room.teamId === "team-core"));
  } finally {
    await relay.close();
  }
});

test("relay preserves requester team role in workspace updates", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false" });
  const ownerCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
  const socket = new WebSocket(relay.wsUrl, { headers: { cookie: ownerCookie } });
  try {
    await onceOpen(socket);
    socket.send(
      JSON.stringify({
        type: "subscribe.workspace",
        userId: "github:maddiedreese",
        deviceId: "device-owner-123"
      })
    );
    await waitForWorkspaceSubscribed(socket);

    const updatePromise = waitForTeamUpdated(socket);
    const response = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Adesign`, {
      method: "DELETE",
      headers: { cookie: ownerCookie }
    });
    assert.equal(response.status, 200);

    const updatedTeam = await updatePromise;
    assert.equal(updatedTeam.id, "team-core");
    assert.equal(updatedTeam.members, 3);
    assert.equal(updatedTeam.role, "owner");
  } finally {
    socket.close();
    await relay.close();
  }
});
