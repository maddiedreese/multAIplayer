import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { createWorkspaceRecordActions } from "../src/lib/workspaceRecordActions";
import { useAppStore } from "../src/store/appStore";

const room: RoomRecord = {
  id: "room-records",
  teamId: "team-records",
  name: "Records",
  projectPath: "/tmp/records",
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
  unread: 0
};

function createActions(overrides: Partial<Parameters<typeof createWorkspaceRecordActions>[0]> = {}) {
  return createWorkspaceRecordActions({
    upsertTeamRecord: () => undefined,
    upsertRoomRecord: () => undefined,
    replaceRoomRecord: () => undefined,
    resetCodexApprovalForRoom: () => undefined,
    revokeWorkspaceAccess: () => undefined,
    setInviteLinkForRoom: () => undefined,
    setInviteMessageForRoom: () => undefined,
    setChatMessageForRoom: () => undefined,
    setHostMessageForRoom: () => undefined,
    setWorkspaceStatusError: () => undefined,
    ...overrides
  });
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

test("membership removal clears current room relay state and reports through external callbacks", () => {
  const calls: string[] = [];
  const store = useAppStore.getState();
  store.initializeWorkspaceUi({ teams: [], rooms: [room], projectPath: room.projectPath, roomId: room.id });
  store.setInviteAdmissionForRoom(room.id, "invite-1");
  store.setRoomPresenceForDevice(room.id, "device-alex", {
    userId: "github:alex",
    deviceId: "device-alex",
    displayName: "Alex",
    status: "online"
  });
  const actions = createActions({
    revokeWorkspaceAccess: (teamId, roomId) => calls.push(`revoke:${teamId}:${roomId}`),
    setInviteLinkForRoom: (roomId, link) => calls.push(`link:${roomId}:${link}`),
    setInviteMessageForRoom: (roomId, message) => calls.push(`invite:${roomId}:${message}`),
    setChatMessageForRoom: (roomId, message) => calls.push(`chat:${roomId}:${message}`),
    setHostMessageForRoom: (roomId, message) => calls.push(`host:${roomId}:${message}`),
    setWorkspaceStatusError: (message) => calls.push(`workspace:${message}`)
  });

  actions.handleRelayError("Team membership was removed");

  const current = useAppStore.getState();
  assert.equal(current.inviteByRoom[room.id]?.admission, undefined);
  assert.equal(current.historyPresenceByRoom[room.id]?.presence, undefined);
  assert.equal(calls[0], `revoke:${room.teamId}:${room.id}`);
  assert.equal(calls[1], `link:${room.id}:`);
  assert.equal(calls.length, 6);
  assert.match(calls.at(-1) ?? "", /Access to Records was removed/);
});
