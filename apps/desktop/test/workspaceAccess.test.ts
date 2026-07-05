import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { canRequestWorkspaceAction, canUseLocalWorkspace, localWorkspaceGateMessage } from "../src/lib/workspaceAccess";

const room: RoomRecord = {
  id: "room-workspace",
  teamId: "team-core",
  name: "Workspace",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  mode: { chat: true, code: true, workspace: true, browser: false },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://github.com"],
  browserProfilePersistent: true,
  unread: 0
};

test("local workspace access requires active host, workspace mode, and unlocked room", () => {
  assert.equal(canUseLocalWorkspace(room, { id: "github:maddie", name: "Maddie" }), true);
  assert.equal(canUseLocalWorkspace(room, { id: "github:alex", name: "Alex" }), false);
  assert.equal(canUseLocalWorkspace({ ...room, mode: { ...room.mode, workspace: false } }, { id: "github:maddie", name: "Maddie" }), false);
  assert.equal(canUseLocalWorkspace(room, { id: "github:maddie", name: "Maddie" }, true), false);
});

test("workspace action requests require workspace mode and an unlocked room", () => {
  assert.equal(canRequestWorkspaceAction(room), true);
  assert.equal(canRequestWorkspaceAction({ ...room, mode: { ...room.mode, workspace: false } }), false);
  assert.equal(canRequestWorkspaceAction(room, true), false);
});

test("local workspace gate messages explain the missing permission", () => {
  assert.equal(localWorkspaceGateMessage(room, true), "Unlock this room before reading local project files.");
  assert.equal(
    localWorkspaceGateMessage({ ...room, mode: { ...room.mode, workspace: false } }),
    "Workspace mode is disabled for this room."
  );
  assert.equal(localWorkspaceGateMessage(room), "Only Maddie can read this room's local project files.");
  assert.equal(
    localWorkspaceGateMessage({ ...room, host: "No host", hostUserId: undefined, hostStatus: "offline" }),
    "Claim host before reading local project files."
  );
});
