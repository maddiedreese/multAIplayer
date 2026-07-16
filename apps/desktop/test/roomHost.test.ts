import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import {
  findEnvelopeRoom,
  isEnvelopeFromActiveRoomHost,
  isEnvelopeFromHandoffInitiator,
  isLocalUserActiveHostForRoom,
  roomHostEnvelopeRejectionMessage
} from "../src/lib/access/roomHost";

const activeRoom: ClientRoomRecord = {
  id: "room-alpha",
  teamId: "team-alpha",
  name: "Alpha",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://docs.example.com"],
  browserProfilePersistent: true,
  unread: 0
};

test("isLocalUserActiveHostForRoom prefers stable host user id", () => {
  assert.equal(
    isLocalUserActiveHostForRoom(activeRoom, { id: "github:maddiedreese", name: "Different Display Name" }),
    true
  );
  assert.equal(isLocalUserActiveHostForRoom(activeRoom, { id: "github:someone-else", name: "Maddie" }), false);
});

test("isLocalUserActiveHostForRoom rejects active rooms without a stable host identity", () => {
  const invalidRoom = { ...activeRoom, hostUserId: undefined };
  assert.equal(isLocalUserActiveHostForRoom(invalidRoom, { id: "github:someone", name: "Maddie" }), false);
  assert.equal(isLocalUserActiveHostForRoom(invalidRoom, { id: "github:maddiedreese", name: "Maddie" }), false);
});

test("isLocalUserActiveHostForRoom rejects inactive host states", () => {
  assert.equal(
    isLocalUserActiveHostForRoom(
      { ...activeRoom, hostStatus: "handoff" },
      { id: "github:maddiedreese", name: "Maddie" }
    ),
    false
  );
  assert.equal(
    isLocalUserActiveHostForRoom(
      { ...activeRoom, hostStatus: "offline" },
      { id: "github:maddiedreese", name: "Maddie" }
    ),
    false
  );
});

test("room host envelopes must come from stable active host identity", () => {
  assert.equal(isEnvelopeFromActiveRoomHost(activeRoom, { senderUserId: "github:maddiedreese" }), true);
  assert.equal(isEnvelopeFromActiveRoomHost(activeRoom, { senderUserId: "github:member" }), false);
  assert.equal(
    isEnvelopeFromActiveRoomHost({ ...activeRoom, hostStatus: "handoff" }, { senderUserId: "github:maddiedreese" }),
    false
  );
  assert.equal(
    isEnvelopeFromActiveRoomHost({ ...activeRoom, hostUserId: undefined }, { senderUserId: "github:maddiedreese" }),
    false
  );
});

test("handoff packages remain bound to the initiating host across the room-state race", () => {
  const handoffRoom = { ...activeRoom, hostStatus: "handoff" as const };
  assert.equal(isEnvelopeFromHandoffInitiator(activeRoom, { senderUserId: "github:maddiedreese" }), true);
  assert.equal(isEnvelopeFromHandoffInitiator(handoffRoom, { senderUserId: "github:maddiedreese" }), true);
  assert.equal(isEnvelopeFromHandoffInitiator(handoffRoom, { senderUserId: "github:member" }), false);
  assert.equal(
    isEnvelopeFromHandoffInitiator({ ...handoffRoom, hostUserId: undefined }, { senderUserId: "github:maddiedreese" }),
    false
  );
  assert.equal(
    isEnvelopeFromHandoffInitiator({ ...handoffRoom, hostStatus: "offline" }, { senderUserId: "github:maddiedreese" }),
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
