import test from "node:test";
import { assert, patchHostStatus, startRelayWithWorkspace } from "../support/relay.js";
import { createRelayRoomSocketManager } from "../../src/ws/rooms.js";
import { InMemoryRelayStore } from "../../src/state.js";
import { createRelayAuthz } from "../../src/authz.js";
import { revokeRoomInvites } from "../../src/relay-domain.js";

test("direct host release and reclaim cannot bypass signed MLS handoff", async () => {
  const relay = await startRelayWithWorkspace();
  try {
    assert.equal(
      await patchHostStatus(relay.baseUrl, {
        host: "Maddie",
        hostUserId: "github:maddiedreese",
        hostStatus: "offline"
      }),
      400
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, { host: "Peer", hostUserId: "github:peer", hostStatus: "active" }),
      409
    );
    const workspace = (await (await fetch(`${relay.baseUrl}/teams`)).json()) as {
      rooms: Array<{ id: string; hostUserId?: string; activeHostDeviceId?: string; hostStatus: string }>;
    };
    const room = workspace.rooms.find((candidate) => candidate.id === "room-desktop");
    assert.equal(room?.hostUserId, "github:maddiedreese");
    assert.equal(room?.activeHostDeviceId, "host-device-1");
    assert.equal(room?.hostStatus, "active");
  } finally {
    await relay.close();
  }
});

test("invite admission requires the exact durable Welcome, approved user, and device and consumes once", () => {
  const keyPackageHash = `sha256:${"a".repeat(64)}`;
  const store = new InMemoryRelayStore();
  store.setTeam({ id: "team", name: "Team", members: 1 });
  store.setRoom({
    id: "room",
    teamId: "team",
    name: "Room",
    projectPath: "/",
    host: "Host",
    hostStatus: "active",
    approvalPolicy: "ask_every_turn",
    codexModel: "gpt-5.4",
    codexModelPolicy: "pinned",
    codexReasoningEffort: "medium",
    codexReasoningEffortPolicy: "pinned",
    codexSpeed: "standard",
    codexServiceTierPolicy: "pinned",
    codexSandboxLevel: "workspace-write",
    browserProfilePersistent: false,
    acceptedMlsEpoch: 0
  });
  const invite = {
    id: "invite",
    teamId: "team",
    roomId: "room",
    approvedUserId: "github:joiner",
    approvedDeviceId: "device-approved",
    keyPackageHash,
    createdAt: new Date().toISOString()
  };
  store.setInvite(invite);
  const session = {
    socket: {} as never,
    authSession: {
      user: { id: "github:joiner", login: "joiner" },
      expiresAt: Date.now() + 60_000
    },
    rateClientId: "test",
    subscribedTeamIds: new Set<string>(),
    workspaceSubscribed: false
  };
  const authz = createRelayAuthz(store);
  const manager = createRelayRoomSocketManager({
    store,
    roomSockets: new Map(),
    teamSockets: new Map(),
    workspaceSockets: new Set(),
    roomPresence: new Map(),
    sessions: new Map(),
    mutationsRequireAuth: true,
    roomKey: (teamId, roomId) => `${teamId}:${roomId}`,
    canAccessRoom: authz.canAccessRoom,
    isTeamMember: authz.isTeamMember,
    addTeamMember: (teamId, userId) => {
      store.setTeamMembers(
        teamId,
        new Map([[userId, { teamId, userId, role: "member", joinedAt: new Date().toISOString() }]])
      );
    },
    scheduleStoreSave: () => {},
    send: () => {},
    broadcast: () => {}
  });
  assert.equal(manager.canJoinRoom(session, "team", "room", "github:joiner", "device-wrong", "invite"), false);
  assert.equal(store.getInvite("invite")?.id, "invite");
  assert.equal(manager.canJoinRoom(session, "team", "room", "github:joiner", "device-approved", "invite"), false);
  assert.equal(store.getInvite("invite")?.id, "invite");
  store.inviteResponses.set("request", {
    requestId: "request",
    inviteId: "invite",
    requesterUserId: "github:joiner",
    requesterDeviceId: "device-approved",
    keyPackageHash,
    status: "approved",
    welcome: "AA==",
    responseBinding: { teamId: "team" }
  } as never);
  assert.equal(manager.canJoinRoom(session, "team", "room", "github:joiner", "device-approved", "invite"), true);
  assert.equal(store.getInvite("invite"), undefined);
  assert.equal(manager.canJoinRoom(session, "team", "room", "github:joiner", "device-approved"), true);

  store.setTeam({ ...store.getTeam("team")!, archivedAt: new Date().toISOString() });
  assert.equal(manager.isKnownRoom("team", "room"), false);
  assert.equal(manager.canSubscribeTeam(session, "team", "github:joiner"), false);
  store.setTeam({ ...store.getTeam("team")!, archivedAt: undefined, deletedAt: new Date().toISOString() });
  assert.equal(manager.canSubscribeTeam(session, "team", "github:joiner"), false);
  store.setTeam({ ...store.getTeam("team")!, deletedAt: undefined });

  store.setTeamMembers("team", new Map());
  store.setInvite(invite);
  store.inviteRequests.set("request", {
    requestId: "request",
    inviteId: "invite",
    requesterUserId: "github:joiner",
    requesterDeviceId: "device-approved"
  } as never);
  store.inviteResponses.set("request", {
    requestId: "request",
    inviteId: "invite",
    requesterUserId: "github:joiner",
    requesterDeviceId: "device-approved",
    keyPackageHash,
    status: "approved",
    welcome: "AA==",
    responseBinding: { teamId: "team" }
  } as never);
  store.setRoom({ ...store.getRoom("room")!, deletedAt: new Date().toISOString() });
  assert.equal(revokeRoomInvites(store, "team", "room"), true);
  assert.equal(store.getInvite("invite"), undefined);
  assert.equal(store.inviteRequests.size, 0);
  assert.equal(store.inviteResponses.size, 0);
  assert.equal(manager.isKnownRoom("team", "room"), false);
  assert.equal(manager.canJoinRoom(session, "team", "room", "github:joiner", "device-approved"), false);
  assert.equal(store.hasTeamMember("team", "github:joiner"), false);
});
