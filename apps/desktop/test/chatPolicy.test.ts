import { defaultTestRoom } from "./support/workspaceFixtures";
import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { canStageRoomChatAttachment, canUseRoomChat, roomChatGateMessage } from "../src/lib/chat/chatPolicy";

const room: ClientRoomRecord = {
  ...defaultTestRoom,
  id: "room-chat",
  teamId: "team-alpha",
  name: "Chat",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.4",
  unread: 0
};

test("room chat requires an unlocked room", () => {
  assert.equal(canUseRoomChat(room), true);
  assert.equal(canUseRoomChat(room, true), false);
});

test("room chat attachments require an unlocked room", () => {
  assert.equal(canStageRoomChatAttachment(room), true);
  assert.equal(canStageRoomChatAttachment(room, true), false);
});

test("room chat gate messages explain why chat is unavailable", () => {
  assert.equal(roomChatGateMessage(room, true), "Unlock this room before using chat.");
  assert.equal(roomChatGateMessage(room), "Chat is available.");
});
