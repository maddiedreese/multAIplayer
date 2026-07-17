import { defaultTestRoom } from "./support/workspaceFixtures";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFirstWorkspaceCreator,
  firstWorkspaceSafeRoomSettings,
  type WorkspaceCreationRuntime
} from "../src/application/history/firstWorkspaceCreation";
import type { RoomCreationSettings } from "../src/application/workspace/workspaceClient";
import type { ClientRoomRecord, TeamRecord } from "@multaiplayer/protocol";

const team: TeamRecord = { id: "team-first", name: "Core", members: 1, role: "owner" };
const room: ClientRoomRecord = {
  ...defaultTestRoom,
  id: "room-first",
  teamId: team.id,
  name: "Desktop",
  projectPath: "/tmp/project",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.6-sol",
  unread: 0
};

function runtimeFixture(options: { failFirstRoom?: Error } = {}) {
  const teams = new Map<string, TeamRecord>();
  const roomSettings: RoomCreationSettings[] = [];
  const localEffects: string[] = [];
  let teamCreates = 0;
  let roomCreates = 0;
  const runtime: WorkspaceCreationRuntime = {
    createTeam: async (name) => {
      teamCreates += 1;
      return { ...team, name };
    },
    createRoom: async (teamId, name, projectPath, settings) => {
      roomCreates += 1;
      roomSettings.push(settings);
      if (options.failFirstRoom && roomCreates === 1) throw options.failFirstRoom;
      return { ...room, teamId, name, projectPath };
    },
    findTeam: (teamId) => teams.get(teamId),
    upsertTeam: (createdTeam) => {
      teams.set(createdTeam.id, createdTeam);
      localEffects.push(`upsert-team:${createdTeam.id}`);
    },
    upsertRoom: (createdRoom) => localEffects.push(`upsert-room:${createdRoom.id}`),
    selectTeam: (teamId) => localEffects.push(`select-team:${teamId}`),
    selectRoom: (roomId) => localEffects.push(`select-room:${roomId}`),
    restoreRoomAccess: (roomId) => localEffects.push(`restore-room:${roomId}`),
    restoreTeamAccess: (teamId) => localEffects.push(`restore-team:${teamId}`),
    restoreForgottenRoom: (roomId) => localEffects.push(`restore-forgotten:${roomId}`),
    setInviteApprovalGate: (roomId, enabled) => localEffects.push(`invite-gate:${roomId}:${enabled}`),
    loadTeamHistorySettings: () => ({ enabled: true, retentionDays: 30 }),
    seedNewRoomHistorySettings: (roomId, settings) => {
      localEffects.push(`history:${roomId}:${settings.enabled}:${settings.retentionDays}`);
      return settings;
    },
    initializeMessages: (roomId) => localEffects.push(`messages:${roomId}`)
  };
  return {
    runtime,
    roomSettings,
    localEffects,
    counts: () => ({ teamCreates, roomCreates })
  };
}

const input = {
  workspaceName: "  Core  ",
  roomName: "  Desktop  ",
  projectPath: "  /tmp/project  "
};

test("first workspace validates every field before a remote mutation", async () => {
  for (const invalid of [
    { ...input, workspaceName: " " },
    { ...input, roomName: " " },
    { ...input, projectPath: " " }
  ]) {
    const fixture = runtimeFixture();
    await assert.rejects(createFirstWorkspaceCreator(fixture.runtime)(invalid));
    assert.deepEqual(fixture.counts(), { teamCreates: 0, roomCreates: 0 });
  }
});

test("first workspace sends the exact reviewed safe room settings and initializes local room state", async () => {
  const fixture = runtimeFixture();
  const result = await createFirstWorkspaceCreator(fixture.runtime)(input);

  assert.equal(result.status, "success");
  assert.deepEqual(fixture.counts(), { teamCreates: 1, roomCreates: 1 });
  assert.deepEqual(fixture.roomSettings, [firstWorkspaceSafeRoomSettings]);
  assert.deepEqual(fixture.localEffects, [
    "upsert-team:team-first",
    "select-team:team-first",
    "restore-room:room-first",
    "restore-team:team-first",
    "restore-forgotten:room-first",
    "invite-gate:room-first:true",
    "history:room-first:true:30",
    "messages:room-first",
    "upsert-room:room-first",
    "select-room:room-first"
  ]);
  assert.deepEqual(fixture.roomSettings[0], {
    approvalPolicy: "ask_every_turn",
    codexModel: "gpt-5.6-sol",
    codexModelPolicy: "auto",
    codexReasoningEffort: "medium",
    codexReasoningEffortPolicy: "auto",
    codexRawReasoningEnabled: false,
    codexSpeed: "standard",
    codexServiceTierPolicy: "auto",
    codexSandboxLevel: "workspace_write"
  });
});

test("room failure returns a resumable team and retry never duplicates it", async () => {
  const roomFailure = new Error("room relay unavailable");
  const fixture = runtimeFixture({ failFirstRoom: roomFailure });
  const createFirstWorkspace = createFirstWorkspaceCreator(fixture.runtime);

  const first = await createFirstWorkspace(input);
  assert.equal(first.status, "partial_team");
  if (first.status !== "partial_team") throw new Error("expected a resumable partial team");
  assert.equal(first.existingTeamId, team.id);
  assert.equal(first.error, roomFailure);
  assert.deepEqual(fixture.counts(), { teamCreates: 1, roomCreates: 1 });

  const retried = await createFirstWorkspace({ ...input, existingTeamId: first.existingTeamId });
  assert.equal(retried.status, "success");
  assert.deepEqual(fixture.counts(), { teamCreates: 1, roomCreates: 2 });
});

test("retry fails before room mutation when its saved team no longer exists", async () => {
  const fixture = runtimeFixture();
  await assert.rejects(
    createFirstWorkspaceCreator(fixture.runtime)({ ...input, existingTeamId: "missing-team" }),
    /saved workspace no longer exists/
  );
  assert.deepEqual(fixture.counts(), { teamCreates: 0, roomCreates: 0 });
});
