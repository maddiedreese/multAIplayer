import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { canCreateRoomInvite } from "../src/lib/invite/invitePolicy";

const room: ClientRoomRecord = {
  id: "room-invite",
  teamId: "team-alpha",
  name: "Invite",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserProfilePersistent: true,
  unread: 0
};

test("room invites require the active host", () => {
  assert.equal(canCreateRoomInvite(room, { id: "github:peer", name: "Peer" }), false);
});

test("room invites remain unavailable during host handoff", () => {
  assert.equal(canCreateRoomInvite(room, { id: "github:maddiedreese", name: "Maddie" }), true);
  assert.equal(canCreateRoomInvite(room, { id: "github:peer", name: "Peer" }), false);
  assert.equal(
    canCreateRoomInvite({ ...room, hostStatus: "handoff" }, { id: "github:maddiedreese", name: "Maddie" }),
    false
  );
});

test("locked rooms cannot create invites", () => {
  assert.equal(canCreateRoomInvite(room, { id: "github:maddiedreese", name: "Maddie" }, true), false);
});
