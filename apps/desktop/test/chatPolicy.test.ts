import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { canStageRoomChatAttachment, canUseRoomChat, roomChatGateMessage } from "../src/lib/chatPolicy";

const room: RoomRecord = {
  id: "room-chat",
  teamId: "team-alpha",
  name: "Chat",
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

test("room chat requires chat mode and an unlocked room", () => {
  assert.equal(canUseRoomChat(room), true);
  assert.equal(canUseRoomChat({ ...room, mode: { ...room.mode, chat: false } }), false);
  assert.equal(canUseRoomChat(room, true), false);
});

test("room chat attachments require chat mode and an unlocked room", () => {
  assert.equal(canStageRoomChatAttachment(room), true);
  assert.equal(canStageRoomChatAttachment({ ...room, mode: { ...room.mode, chat: false } }), false);
  assert.equal(canStageRoomChatAttachment(room, true), false);
});

test("room chat gate messages explain why chat is unavailable", () => {
  assert.equal(roomChatGateMessage(room, true), "Unlock this room before using chat.");
  assert.equal(
    roomChatGateMessage({ ...room, mode: { ...room.mode, chat: false } }),
    "Chat mode is disabled for this room."
  );
});
