import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { canControlRoomTerminal, roomTerminalControlMessage } from "../src/lib/terminalAccess";

const room: RoomRecord = {
  id: "room-terminal",
  teamId: "team-alpha",
  name: "Terminal",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://docs.example.com"],
  browserProfilePersistent: true,
  unread: 0
};

const host = { id: "github:maddie", name: "Maddie" };
const terminal = { roomId: room.id };

test("terminal control requires active host workspace access and matching room terminal", () => {
  assert.equal(canControlRoomTerminal(room, host, terminal), true);
  assert.equal(canControlRoomTerminal(room, { id: "github:peer", name: "Peer" }, terminal), false);
  assert.equal(canControlRoomTerminal({ ...room, mode: { ...room.mode, workspace: false } }, host, terminal), false);
  assert.equal(canControlRoomTerminal(room, host, { roomId: "other-room" }), false);
  assert.equal(canControlRoomTerminal(room, host, null), false);
  assert.equal(canControlRoomTerminal(room, host, terminal, true), false);
});

test("terminal control messages explain unavailable controls", () => {
  assert.equal(roomTerminalControlMessage(room, terminal, true), "Unlock this room before controlling terminals.");
  assert.equal(
    roomTerminalControlMessage({ ...room, mode: { ...room.mode, workspace: false } }, terminal),
    "Workspace mode is disabled for this room."
  );
  assert.equal(roomTerminalControlMessage(room, null), "Select a terminal in this room before controlling it.");
  assert.equal(
    roomTerminalControlMessage(room, { roomId: "other-room" }),
    "Selected terminal belongs to a different room."
  );
});
