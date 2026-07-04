import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { isLocalUserActiveHostForRoom } from "../src/lib/roomHost";

const activeRoom: RoomRecord = {
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
  unread: 0
};

test("isLocalUserActiveHostForRoom prefers stable host user id", () => {
  assert.equal(
    isLocalUserActiveHostForRoom(activeRoom, { id: "github:maddiedreese", name: "Different Display Name" }),
    true
  );
  assert.equal(
    isLocalUserActiveHostForRoom(activeRoom, { id: "github:someone-else", name: "Maddie" }),
    false
  );
});

test("isLocalUserActiveHostForRoom falls back to host name for legacy rooms", () => {
  const legacyRoom = { ...activeRoom, hostUserId: undefined };
  assert.equal(isLocalUserActiveHostForRoom(legacyRoom, { id: "github:someone", name: "Maddie" }), true);
  assert.equal(isLocalUserActiveHostForRoom(legacyRoom, { id: "github:maddiedreese", name: "Someone" }), false);
});

test("isLocalUserActiveHostForRoom rejects inactive host states", () => {
  assert.equal(
    isLocalUserActiveHostForRoom({ ...activeRoom, hostStatus: "handoff" }, { id: "github:maddiedreese", name: "Maddie" }),
    false
  );
  assert.equal(
    isLocalUserActiveHostForRoom({ ...activeRoom, hostStatus: "offline" }, { id: "github:maddiedreese", name: "Maddie" }),
    false
  );
});
