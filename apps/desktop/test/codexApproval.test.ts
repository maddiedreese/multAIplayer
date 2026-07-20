import { defaultTestRoom } from "./support/workspaceFixtures";
import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { canApproveCodexTurn, shouldResetCodexApprovalForRoomUpdate } from "../src/lib/codex/codexApproval";

const room: ClientRoomRecord = {
  ...defaultTestRoom,
  id: "room-codex",
  teamId: "team-core",
  name: "Codex",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddie",
  activeHostDeviceId: "device-host",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.4",
  unread: 0
};

test("Codex approval requires an unlocked active host", () => {
  const host = { id: "github:maddie", name: "Maddie" };
  assert.equal(canApproveCodexTurn(room, host, "device-host"), true);
  assert.equal(canApproveCodexTurn(room, host, "device-host", true), false);
  assert.equal(canApproveCodexTurn(room, { id: "github:peer", name: "Peer" }, "device-host"), false);
  assert.equal(canApproveCodexTurn(room, host, "device-peer"), false);
  assert.equal(canApproveCodexTurn({ ...room, approvalPolicy: "never_host" }, host, "device-host"), false);
});

test("Codex approvals reset when room execution context changes", () => {
  assert.equal(shouldResetCodexApprovalForRoomUpdate(room, { ...room, codexModel: "gpt-5.4-high" }), true);
  assert.equal(
    shouldResetCodexApprovalForRoomUpdate(room, { ...room, projectPath: "/Users/maddie/other-project" }),
    true
  );
  assert.equal(shouldResetCodexApprovalForRoomUpdate(room, { ...room, approvalPolicy: "never_host" }), true);
  assert.equal(
    shouldResetCodexApprovalForRoomUpdate(room, { ...room, host: "Jordan", hostUserId: "github:jordan" }),
    false
  );
  assert.equal(shouldResetCodexApprovalForRoomUpdate(room, { ...room, unread: 2 }), false);
});
