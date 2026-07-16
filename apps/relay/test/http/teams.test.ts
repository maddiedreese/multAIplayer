import { test } from "node:test";
import {
  WebSocket,
  assert,
  createDebugSession,
  onceOpen,
  startRelay,
  waitForClose,
  waitForError,
  waitForErrorDetails,
  waitForJoined,
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
        approvalPolicy: "ask_every_turn",
        browserProfilePersistent: false
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
