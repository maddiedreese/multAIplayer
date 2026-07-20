import { defaultTestRoom } from "./support/workspaceFixtures";
import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import {
  findEnvelopeRoom,
  isEnvelopeFromActiveRoomHost,
  isLocalUserActiveHostForRoom,
  roomHostEnvelopeRejectionMessage
} from "../src/lib/access/roomHost";

const activeRoom: ClientRoomRecord = {
  ...defaultTestRoom,
  id: "room-alpha",
  teamId: "team-alpha",
  name: "Alpha",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
  activeHostDeviceId: "device-host",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.4",
  unread: 0
};

test("isLocalUserActiveHostForRoom prefers stable host user id", () => {
  assert.equal(
    isLocalUserActiveHostForRoom(
      activeRoom,
      { id: "github:maddiedreese", name: "Different Display Name" },
      "device-host"
    ),
    true
  );
  assert.equal(
    isLocalUserActiveHostForRoom(activeRoom, { id: "github:someone-else", name: "Maddie" }, "device-host"),
    false
  );
  assert.equal(
    isLocalUserActiveHostForRoom(activeRoom, { id: "github:maddiedreese", name: "Maddie" }, "device-peer"),
    false
  );
});

test("isLocalUserActiveHostForRoom rejects active rooms without a stable host identity", () => {
  const invalidRoom = { ...activeRoom, hostUserId: undefined };
  assert.equal(
    isLocalUserActiveHostForRoom(invalidRoom, { id: "github:someone", name: "Maddie" }, "device-host"),
    false
  );
  assert.equal(
    isLocalUserActiveHostForRoom(invalidRoom, { id: "github:maddiedreese", name: "Maddie" }, "device-host"),
    false
  );
  assert.equal(
    isLocalUserActiveHostForRoom(
      { ...activeRoom, activeHostDeviceId: undefined },
      { id: "github:maddiedreese", name: "Maddie" },
      "device-host"
    ),
    false
  );
});

test("isLocalUserActiveHostForRoom rejects inactive host states", () => {
  assert.equal(
    isLocalUserActiveHostForRoom(
      { ...activeRoom, hostStatus: "offline" },
      { id: "github:maddiedreese", name: "Maddie" },
      "device-host"
    ),
    false
  );
});

test("room host envelopes must come from stable active host identity", () => {
  assert.equal(
    isEnvelopeFromActiveRoomHost(activeRoom, {
      senderUserId: "github:maddiedreese",
      senderDeviceId: "device-host"
    }),
    true
  );
  assert.equal(
    isEnvelopeFromActiveRoomHost(activeRoom, { senderUserId: "github:member", senderDeviceId: "device-host" }),
    false
  );
  assert.equal(
    isEnvelopeFromActiveRoomHost(activeRoom, {
      senderUserId: "github:maddiedreese",
      senderDeviceId: "device-peer"
    }),
    false
  );
  assert.equal(
    isEnvelopeFromActiveRoomHost(
      { ...activeRoom, hostUserId: undefined },
      { senderUserId: "github:maddiedreese", senderDeviceId: "device-host" }
    ),
    false
  );
  assert.equal(
    isEnvelopeFromActiveRoomHost(
      { ...activeRoom, hostStatus: "offline" },
      { senderUserId: "github:maddiedreese", senderDeviceId: "device-host" }
    ),
    false
  );
});

test("room host envelope helpers find known rooms and explain rejections", () => {
  assert.equal(findEnvelopeRoom([activeRoom], "room-alpha")?.name, "Alpha");
  assert.equal(findEnvelopeRoom([activeRoom], "missing"), null);
  assert.equal(
    roomHostEnvelopeRejectionMessage(activeRoom, "host handoff"),
    "Rejected host handoff because it was not sent by Maddie."
  );
});
