import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { createWorkspaceRecordActions } from "../src/application/workspace/workspaceRecordActions";
import { useAppStore } from "../src/store/appStore";

const room: ClientRoomRecord = {
  id: "room-records",
  teamId: "team-records",
  name: "Records",
  projectPath: "/tmp/records",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.4",
  browserProfilePersistent: true,
  unread: 0
};

function createActions(overrides: Partial<Parameters<typeof createWorkspaceRecordActions>[0]> = {}) {
  return createWorkspaceRecordActions({
    upsertTeamRecord: () => undefined,
    upsertRoomRecord: () => undefined,
    replaceRoomRecord: () => undefined,
    resetCodexApprovalForRoom: () => undefined,
    revokeWorkspaceAccess: () => undefined,
    forgetRevokedRoomLocalData: async () => undefined,
    setInviteLinkForRoom: () => undefined,
    setInviteMessageForRoom: () => undefined,
    setChatMessageForRoom: () => undefined,
    setHostMessageForRoom: () => undefined,
    setWorkspaceStatusError: () => undefined,
    ...overrides
  });
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test.beforeEach(() => {
  const store = useAppStore.getState();
  store.resetAppStore();
  store.replaceCurrentUser({ id: "github:maddie", login: "maddie", name: "Maddie" });
});

test("workspace record actions resolve Zustand actions when invoked", () => {
  const team: TeamRecord = { id: room.teamId, name: "Records Team", members: 1, role: "owner" };
  const actions = createActions();

  actions.upsertTeam(team);

  assert.deepEqual(
    useAppStore.getState().teamRosterByTeam[team.id]?.members?.map((member) => ({
      userId: member.userId,
      role: member.role
    })),
    [{ userId: "github:maddie", role: "owner" }]
  );
});

test("membership removal clears only rooms in the explicitly scoped team", async () => {
  const calls: string[] = [];
  const siblingRoom = { ...room, id: "room-sibling", name: "Sibling" };
  const unaffectedRoom = { ...room, id: "room-other", teamId: "team-other", name: "Other" };
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({
    teams: [],
    rooms: [room, siblingRoom, unaffectedRoom],
    projectPath: unaffectedRoom.projectPath,
    roomId: unaffectedRoom.id
  });
  useAppStore.setState({
    messagesByRoom: {
      [room.id]: [{ id: "secret" } as never],
      [siblingRoom.id]: [{ id: "sibling-secret" } as never],
      [unaffectedRoom.id]: []
    }
  });
  store.setInviteAdmissionForRoom(room.id, "invite-1");
  store.setRoomPresenceForDevice(room.id, "device-alex", {
    userId: "github:alex",
    deviceId: "device-alex",
    displayName: "Alex",
    status: "online"
  });
  const actions = createActions({
    revokeWorkspaceAccess: (teamId, roomId) => calls.push(`revoke:${teamId}:${roomId}`),
    forgetRevokedRoomLocalData: async (roomId) => {
      calls.push(`history:${roomId}`);
    },
    setInviteLinkForRoom: (roomId, link) => calls.push(`link:${roomId}:${link}`),
    setInviteMessageForRoom: (roomId, message) => calls.push(`invite:${roomId}:${message}`),
    setChatMessageForRoom: (roomId, message) => calls.push(`chat:${roomId}:${message}`),
    setHostMessageForRoom: (roomId, message) => calls.push(`host:${roomId}:${message}`),
    setWorkspaceStatusError: (message) => calls.push(`workspace:${message}`)
  });

  actions.handleRelayError({ type: "error", message: "Team membership was removed", teamId: room.teamId });
  await Promise.resolve();

  const current = useAppStore.getState();
  assert.equal(current.inviteByRoom[room.id]?.admission, undefined);
  assert.equal(current.historyPresenceByRoom[room.id]?.presence, undefined);
  assert.equal(current.messagesByRoom[room.id], undefined);
  assert.equal(current.messagesByRoom[siblingRoom.id], undefined);
  assert.deepEqual(current.messagesByRoom[unaffectedRoom.id], []);
  assert.ok(calls.includes(`revoke:${room.teamId}:${room.id}`));
  assert.ok(calls.includes(`revoke:${siblingRoom.teamId}:${siblingRoom.id}`));
  assert.ok(calls.includes(`link:${room.id}:`));
  assert.ok(calls.includes(`history:${room.id}`));
  assert.ok(calls.includes(`history:${siblingRoom.id}`));
  assert.equal(
    calls.some((call) => call.includes(unaffectedRoom.id)),
    false
  );
  assert.match(calls.find((call) => call.startsWith(`chat:${room.id}:`)) ?? "", /deleting/i);
  assert.match(calls.at(-1) ?? "", /rejoin with a fresh invite/i);
});

test("unscoped membership errors never revoke or delete a selected room", async () => {
  const calls: string[] = [];
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({ teams: [], rooms: [room], projectPath: room.projectPath, roomId: room.id });
  const actions = createActions({
    revokeWorkspaceAccess: () => calls.push("revoke"),
    forgetRevokedRoomLocalData: async () => void calls.push("delete")
  });
  actions.handleRelayError({ type: "error", message: "Team membership was removed" });
  await Promise.resolve();
  assert.deepEqual(calls, []);
  assert.equal(useAppStore.getState().revokedRoomIds.has(room.id), false);
});

test("failed scoped revocation cleanup is visible and leaves the room locked", async () => {
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({ teams: [], rooms: [room], projectPath: room.projectPath, roomId: room.id });
  const actions = createActions({
    revokeWorkspaceAccess: (teamId, roomId) => store.revokeWorkspaceAccess(teamId, roomId),
    forgetRevokedRoomLocalData: async () => {
      throw new Error("keychain unavailable");
    },
    setWorkspaceStatusError: (message) => store.setWorkspaceStatusError(message)
  });
  actions.handleRelayError({ type: "error", message: "Team membership was removed", teamId: room.teamId });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(useAppStore.getState().revokedRoomIds.has(room.id), true);
  assert.match(useAppStore.getState().workspaceError ?? "", /could not delete its local encrypted room data/i);
});

test("one room cleanup success cannot hide another revoked room cleanup failure", async () => {
  const selectedCleanup = deferred();
  const siblingCleanup = deferred();
  const siblingRoom = { ...room, id: "room-sibling", name: "Sibling" };
  const roomMessages = new Map<string, string>();
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({
    teams: [],
    rooms: [room, siblingRoom],
    projectPath: room.projectPath,
    roomId: room.id
  });
  const actions = createActions({
    revokeWorkspaceAccess: (teamId, roomId) => store.revokeWorkspaceAccess(teamId, roomId),
    forgetRevokedRoomLocalData: (roomId) => (roomId === room.id ? selectedCleanup.promise : siblingCleanup.promise),
    setInviteMessageForRoom: (roomId, message) => message && roomMessages.set(roomId, message),
    setChatMessageForRoom: (roomId, message) => message && roomMessages.set(roomId, message),
    setHostMessageForRoom: (roomId, message) => message && roomMessages.set(roomId, message),
    setWorkspaceStatusError: (message) => store.setWorkspaceStatusError(message)
  });

  actions.handleRelayError({ type: "error", message: "Team membership was removed", teamId: room.teamId });
  siblingCleanup.reject(new Error("keychain unavailable"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  selectedCleanup.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(roomMessages.get(siblingRoom.id) ?? "", /could not delete/i);
  assert.match(roomMessages.get(room.id) ?? "", /rejoin with a fresh invite/i);
  assert.match(useAppStore.getState().workspaceError ?? "", /Sibling.*could not delete/i);
});
