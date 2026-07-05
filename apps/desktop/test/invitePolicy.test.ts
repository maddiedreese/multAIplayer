import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { canCreateRoomInvite } from "../src/lib/invitePolicy";

const room: RoomRecord = {
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
  browserAllowedOrigins: ["https://github.com"],
  browserProfilePersistent: true,
  unread: 0
};

test("direct room invites can be created by room members while unlocked", () => {
  assert.equal(canCreateRoomInvite(room, { id: "github:peer", name: "Peer" }), true);
});

test("gated room invites require the active host device", () => {
  assert.equal(canCreateRoomInvite(room, { id: "github:maddiedreese", name: "Maddie" }, false, true), true);
  assert.equal(canCreateRoomInvite(room, { id: "github:peer", name: "Peer" }, false, true), false);
  assert.equal(
    canCreateRoomInvite({ ...room, hostStatus: "handoff" }, { id: "github:maddiedreese", name: "Maddie" }, false, true),
    false
  );
});

test("locked rooms cannot create direct or gated invites", () => {
  assert.equal(canCreateRoomInvite(room, { id: "github:maddiedreese", name: "Maddie" }, true), false);
  assert.equal(canCreateRoomInvite(room, { id: "github:maddiedreese", name: "Maddie" }, true, true), false);
});
