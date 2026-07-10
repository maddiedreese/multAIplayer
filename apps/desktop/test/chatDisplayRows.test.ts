import assert from "node:assert/strict";
import test from "node:test";
import { buildRoomChatMessageRows } from "../src/lib/chatDisplayRows";
import type { ChatMessage, CodexRoomEvent } from "../src/types";

const ownMessage: ChatMessage = {
  id: "message-1",
  author: "Maddie",
  authorUserId: "github:maddie",
  role: "human",
  body: "Please fix the parser.",
  time: "9:43",
  createdAt: "2026-07-08T12:00:00.000Z"
};

function rows(messages: ChatMessage[], codexEvents: CodexRoomEvent[] = []) {
  return buildRoomChatMessageRows({
    messages,
    markdownSelectionMode: false,
    selectedMessageIds: [],
    localUserId: "github:maddie",
    codexEvents
  });
}

test("buildRoomChatMessageRows hides edit and delete once a started Codex event consumed the message", () => {
  const started: CodexRoomEvent = {
    eventType: "codex.turn",
    turnId: "turn-1",
    status: "started",
    message: "Started Codex turn.",
    model: "gpt-5.5",
    consumedMessageIds: ["message-1"],
    host: "Maddie",
    hostUserId: "github:maddie",
    createdAt: "2026-07-08T12:01:00.000Z"
  };

  const [row] = rows([ownMessage], [started]);
  assert.equal(row.canEdit, false);
  assert.equal(row.canDelete, false);
});

test("buildRoomChatMessageRows keeps queued-but-not-started messages editable", () => {
  const [row] = rows([ownMessage]);
  assert.equal(row.canEdit, true);
  assert.equal(row.canDelete, true);
});

test("buildRoomChatMessageRows shows deleter attribution on tombstones", () => {
  const [row] = rows([
    {
      ...ownMessage,
      body: "",
      deletedAt: "2026-07-08T12:02:00.000Z",
      deletedBy: "Maddie",
      deletedByUserId: "github:maddie"
    }
  ]);

  assert.equal(row.body, "Message deleted by Maddie");
  assert.equal(row.deleted, true);
});
