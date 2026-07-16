import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { canControlRoomTerminal, roomTerminalControlMessage } from "../src/lib/terminal/terminalAccess";

const room: ClientRoomRecord = {
  id: "room-terminal",
  teamId: "team-alpha",
  name: "Terminal",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.4",
  browserProfilePersistent: true,
  unread: 0
};

const host = { id: "github:maddie", name: "Maddie" };
const terminal = { roomId: room.id };

test("terminal control requires active host access and matching room terminal", () => {
  assert.equal(canControlRoomTerminal(room, host, terminal), true);
  assert.equal(canControlRoomTerminal(room, { id: "github:peer", name: "Peer" }, terminal), false);
  assert.equal(canControlRoomTerminal(room, host, { roomId: "other-room" }), false);
  assert.equal(canControlRoomTerminal(room, host, null), false);
  assert.equal(canControlRoomTerminal(room, host, terminal, true), false);
});

test("terminal control messages explain unavailable controls", () => {
  assert.equal(roomTerminalControlMessage(room, terminal, true), "Unlock this room before controlling terminals.");
  assert.equal(roomTerminalControlMessage(room, terminal), "Terminal control is available.");
  assert.equal(roomTerminalControlMessage(room, null), "Select a terminal in this room before controlling it.");
  assert.equal(
    roomTerminalControlMessage(room, { roomId: "other-room" }),
    "Selected terminal belongs to a different room."
  );
});
