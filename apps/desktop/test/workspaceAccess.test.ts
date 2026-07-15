import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import {
  canRequestWorkspaceAction,
  canUseLocalWorkspace,
  isRoomFileActionInFlight,
  localWorkspaceGateMessage,
  roomFileActionInFlightMessage
} from "../src/lib/access/workspaceAccess";

const room: ClientRoomRecord = {
  id: "room-workspace",
  teamId: "team-core",
  name: "Workspace",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: false },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://github.com"],
  browserProfilePersistent: true,
  unread: 0
};

test("local workspace access requires an unlocked room", () => {
  assert.equal(canUseLocalWorkspace(room, { id: "github:maddie", name: "Maddie" }), true);
  assert.equal(canUseLocalWorkspace(room, { id: "github:alex", name: "Alex" }), true);
  assert.equal(
    canUseLocalWorkspace(
      { ...room, mode: { ...room.mode, workspace: false } },
      { id: "github:maddie", name: "Maddie" }
    ),
    true
  );
  assert.equal(canUseLocalWorkspace(room, { id: "github:maddie", name: "Maddie" }, true), false);
});

test("workspace action requests require an unlocked room", () => {
  assert.equal(canRequestWorkspaceAction(room), true);
  assert.equal(canRequestWorkspaceAction({ ...room, mode: { ...room.mode, workspace: false } }), true);
  assert.equal(canRequestWorkspaceAction(room, true), false);
});

test("local workspace gate messages explain the missing permission", () => {
  assert.equal(localWorkspaceGateMessage(room, true), "Unlock this room before reading local project files.");
  assert.equal(localWorkspaceGateMessage(room), "Project files are available to room members.");
  assert.equal(
    localWorkspaceGateMessage({ ...room, host: "No host", hostUserId: undefined, hostStatus: "offline" }),
    "Project files are available to room members."
  );
});

test("file action in-flight guard is scoped to one room", () => {
  assert.equal(isRoomFileActionInFlight({ "room-a": true }, "room-a"), true);
  assert.equal(isRoomFileActionInFlight({ "room-a": true }, "room-b"), false);
  assert.equal(isRoomFileActionInFlight({ "room-a": false }, "room-a"), false);
  assert.equal(roomFileActionInFlightMessage(), "A file action is already running in this room.");
});
