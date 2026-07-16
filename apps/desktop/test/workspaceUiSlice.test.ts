import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { useAppStore } from "../src/store/appStore";

const teamA: TeamRecord = { id: "team-a", name: "Team A", members: 1, role: "owner" };
const teamB: TeamRecord = { id: "team-b", name: "Team B", members: 2 };

const roomA: ClientRoomRecord = {
  id: "room-a",
  teamId: teamA.id,
  name: "Room A",
  projectPath: "/tmp/a",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  unread: 2
};

const roomB: ClientRoomRecord = {
  ...roomA,
  id: "room-b",
  teamId: teamB.id,
  name: "Room B",
  projectPath: "/tmp/b",
  unread: 0
};

test.beforeEach(() => useAppStore.getState().resetAppStore());

test("workspace UI initializes once from the React seed and resets coherently", () => {
  let store = useAppStore.getState();
  store.initializeWorkspaceUi({
    teams: [teamA, teamB],
    rooms: [roomA, roomB],
    projectPath: "/tmp/new",
    roomId: roomB.id
  });
  store.initializeWorkspaceUi({
    teams: [],
    rooms: [],
    projectPath: "/ignored",
    roomId: "ignored"
  });

  store = useAppStore.getState();
  assert.equal(store.workspaceUiInitialized, true);
  assert.deepEqual(store.teams, [teamA, teamB]);
  assert.deepEqual(store.rooms, [roomA, roomB]);
  assert.equal(store.selectedTeam, teamA.id);
  assert.equal(store.selectedRoomId, roomB.id);
  assert.equal(store.newRoomProjectPath, "/tmp/new");

  store.resetAppStore();
  store = useAppStore.getState();
  store.initializeWorkspaceUi({
    teams: [teamA],
    rooms: [roomA],
    projectPath: "/tmp/new",
    roomId: "missing-room"
  });
  assert.equal(useAppStore.getState().selectedRoomId, roomA.id);

  store.setWorkspaceStatusError("problem");
  store.setActiveSidebarPanel("settings");
  store.setNewTeamName("New team");
  store.setNewRoomName("New room");
  store.setSidebarQuery("needle");
  store.resetAppStore();

  store = useAppStore.getState();
  assert.equal(store.workspaceUiInitialized, false);
  assert.equal(store.workspaceBootstrapStatus, "loading");
  assert.equal(store.workspaceBootstrapError, null);
  assert.equal(store.workspaceBootstrapAttempt, 0);
  assert.deepEqual(store.teams, []);
  assert.deepEqual(store.rooms, []);
  assert.equal(store.workspaceError, null);
  assert.equal(store.activeSidebarPanel, null);
  assert.equal(store.newTeamName, "");
  assert.equal(store.newRoomName, "");
  assert.equal(store.newRoomProjectPath, "");
  assert.equal(store.sidebarQuery, "");
});

test("workspace bootstrap readiness transitions and retries independently of room relay state", () => {
  const store = useAppStore.getState();
  assert.equal(store.workspaceBootstrapStatus, "loading");
  assert.equal(store.relayStatus, "closed");

  store.completeWorkspaceBootstrap();
  assert.equal(useAppStore.getState().workspaceBootstrapStatus, "ready");
  assert.equal(useAppStore.getState().relayStatus, "closed");

  store.failWorkspaceBootstrap("Relay HTTP failed");
  assert.equal(useAppStore.getState().workspaceBootstrapStatus, "error");
  assert.equal(useAppStore.getState().workspaceBootstrapError, "Relay HTTP failed");

  store.retryWorkspaceBootstrap();
  const state = useAppStore.getState();
  assert.equal(state.workspaceBootstrapStatus, "loading");
  assert.equal(state.workspaceBootstrapError, null);
  assert.equal(state.workspaceBootstrapAttempt, 1);
  assert.equal(state.relayStatus, "closed");
});

test("team replacement and upsert keep selection valid and preserve record update semantics", () => {
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({ teams: [teamA, teamB], rooms: [], projectPath: "/tmp", roomId: "" });
  store.setSelectedTeam(teamB.id);

  store.replaceTeams([
    { ...teamA, members: 3 },
    { ...teamB, deletedAt: new Date().toISOString() }
  ]);
  let state = useAppStore.getState();
  assert.deepEqual(state.teams, [{ ...teamA, members: 3 }]);
  assert.equal(state.selectedTeam, teamA.id);

  state.upsertTeamRecord(teamB);
  state.updateTeamRoleForTeam(teamB.id, "admin");
  state.updateTeamMemberCountForTeam(teamB.id, 4);
  state = useAppStore.getState();
  assert.deepEqual(state.teams.at(-1), { ...teamB, members: 4, role: "admin" });

  state.setSelectedTeam(teamA.id);
  state.upsertTeamRecord({ ...teamA, deletedAt: new Date().toISOString() });
  state = useAppStore.getState();
  assert.equal(state.selectedTeam, teamB.id);
  assert.deepEqual(state.teams, [{ ...teamB, members: 4, role: "admin" }]);
});

test("room mutations preserve unread state and repair selection atomically", () => {
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({
    teams: [teamA, teamB],
    rooms: [roomA, roomB],
    projectPath: "/tmp",
    roomId: roomA.id
  });

  store.upsertRoomRecord({ ...roomA, name: "Renamed", unread: 0 });
  assert.equal(useAppStore.getState().rooms[0]?.unread, 2);
  assert.equal(useAppStore.getState().rooms[0]?.name, "Renamed");

  store.markIncomingChatUnread(roomA.id, roomB.id, "remote", "local");
  assert.equal(useAppStore.getState().rooms[0]?.unread, 3);
  store.markRoomReadById(roomA.id);
  assert.equal(useAppStore.getState().rooms[0]?.unread, 0);
  store.hydrateRoomReadState(roomA.id, { unread: 7 });
  assert.equal(useAppStore.getState().rooms[0]?.unread, 7);

  store.replaceRoomRecord({ ...roomA, name: "Server name", unread: 99 });
  assert.equal(useAppStore.getState().rooms[0]?.unread, 7);
  store.replaceRoomRecord({ ...roomA, deletedAt: new Date().toISOString() });
  assert.equal(useAppStore.getState().selectedRoomId, roomB.id);
  assert.equal(useAppStore.getState().selectedTeam, teamB.id);
  assert.deepEqual(
    useAppStore.getState().rooms.map((room) => room.id),
    [roomB.id]
  );
});

test("room collection replacement repairs a cross-team fallback atomically", () => {
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({
    teams: [teamA, teamB],
    rooms: [roomA, roomB],
    projectPath: "/tmp",
    roomId: roomA.id
  });

  store.replaceRooms([roomB]);

  const state = useAppStore.getState();
  assert.equal(state.selectedRoomId, roomB.id);
  assert.equal(state.selectedTeam, teamB.id);
});

test("room upsert deletion repairs a cross-team fallback atomically", () => {
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({
    teams: [teamA, teamB],
    rooms: [roomA, roomB],
    projectPath: "/tmp",
    roomId: roomA.id
  });

  store.upsertRoomRecord({ ...roomA, deletedAt: new Date().toISOString() });

  const state = useAppStore.getState();
  assert.equal(state.selectedRoomId, roomB.id);
  assert.equal(state.selectedTeam, teamB.id);
});

test("room selection moves from none to hydrated data and back to none when the final room leaves", () => {
  const store = useAppStore.getState();
  assert.equal(store.selectedRoomId, "");
  assert.deepEqual(store.rooms, []);

  store.replaceRooms([roomA]);
  let state = useAppStore.getState();
  assert.equal(state.selectedRoomId, roomA.id);
  assert.equal(
    state.rooms.find((room) => room.id === state.selectedRoomId),
    roomA
  );

  state.replaceRoomRecord({ ...roomA, deletedAt: new Date().toISOString() });
  state = useAppStore.getState();
  assert.equal(state.selectedRoomId, "");
  assert.equal(state.selectedTeam, teamA.id);
  assert.deepEqual(state.rooms, []);
});

test("workspace selection helpers preserve explicit and team-relative navigation semantics", () => {
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({
    teams: [teamA, teamB],
    rooms: [roomA, roomB],
    projectPath: "/tmp",
    roomId: roomA.id
  });

  store.selectWorkspaceRoom(teamB.id, roomB.id);
  assert.equal(useAppStore.getState().selectedTeam, teamB.id);
  assert.equal(useAppStore.getState().selectedRoomId, roomB.id);

  store.selectTeamRoom(teamA.id, roomB.id);
  assert.equal(useAppStore.getState().selectedTeam, teamA.id);
  assert.equal(useAppStore.getState().selectedRoomId, roomA.id);

  store.selectExistingRoomOrFirst([{ ...roomA, deletedAt: new Date().toISOString() }, roomB]);
  assert.equal(useAppStore.getState().selectedRoomId, roomB.id);
});

test("room fallback synchronizes the selected team when the first team has no rooms", () => {
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({ teams: [teamA, teamB], rooms: [], projectPath: "/tmp", roomId: "" });

  store.selectExistingTeamOrFirst([teamA, teamB]);
  store.selectExistingRoomOrFirst([roomB]);

  const state = useAppStore.getState();
  assert.equal(state.selectedTeam, teamB.id);
  assert.equal(state.selectedRoomId, roomB.id);
});

test("room fallback preserves an existing valid room and team selection", () => {
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({
    teams: [teamA, teamB],
    rooms: [roomA, roomB],
    projectPath: "/tmp",
    roomId: roomA.id
  });
  store.selectWorkspaceRoom(teamB.id, roomB.id);

  store.selectExistingTeamOrFirst([teamA, teamB]);
  store.selectExistingRoomOrFirst([roomA, roomB]);

  const state = useAppStore.getState();
  assert.equal(state.selectedTeam, teamB.id);
  assert.equal(state.selectedRoomId, roomB.id);
});
