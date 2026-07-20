import { defaultTestRoom } from "./support/workspaceFixtures";
import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { canCreateRoomInvite } from "../src/lib/invite/invitePolicy";

const room: ClientRoomRecord = {
  ...defaultTestRoom,
  id: "room-invite",
  teamId: "team-alpha",
  name: "Invite",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
  activeHostDeviceId: "device-host",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.4",
  unread: 0
};

test("room invites require the active host", () => {
  assert.equal(canCreateRoomInvite(room, { id: "github:peer", name: "Peer" }, "device-host"), false);
  assert.equal(canCreateRoomInvite(room, { id: "github:maddiedreese", name: "Maddie" }, "device-peer"), false);
});

test("offline rooms cannot create invites", () => {
  assert.equal(
    canCreateRoomInvite(
      { ...room, hostStatus: "offline" },
      { id: "github:maddiedreese", name: "Maddie" },
      "device-host"
    ),
    false
  );
});

test("locked rooms cannot create invites", () => {
  assert.equal(canCreateRoomInvite(room, { id: "github:maddiedreese", name: "Maddie" }, "device-host", true), false);
});
