import assert from "node:assert/strict";
import test from "node:test";
import { buildRoomChatMessageRows, safeInlineImageSource } from "../src/presentation/chat/chatDisplayRows";
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
  assert.ok(row);
  assert.equal(row.canEdit, false);
  assert.equal(row.canDelete, false);
});

test("buildRoomChatMessageRows keeps queued-but-not-started messages editable", () => {
  const [row] = rows([ownMessage]);
  assert.ok(row);
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
  assert.ok(row);

  assert.equal(row.body, "Message deleted by Maddie");
  assert.equal(row.deleted, true);
});

test("buildRoomChatMessageRows exposes only allowlisted embedded raster images", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const [row] = rows([
    {
      ...ownMessage,
      attachments: [
        { id: "png", name: "result.png", type: "image/png", size: 8, content: png },
        {
          id: "svg",
          name: "unsafe.svg",
          type: "image/svg+xml",
          size: 20,
          content: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="
        },
        { id: "remote", name: "remote.png", type: "image/png", size: 8, content: "https://example.com/a.png" }
      ]
    }
  ]);
  assert.ok(row);

  assert.deepEqual(row.attachments[0]?.image, { src: png, alt: "result.png" });
  assert.equal(row.attachments[1]?.image, undefined);
  assert.equal(row.attachments[2]?.image, undefined);
});

test("safeInlineImageSource rejects raster data mislabeled as a non-image attachment", () => {
  assert.equal(
    safeInlineImageSource({
      id: "text",
      name: "notes.txt",
      type: "text/plain",
      size: 8,
      content: "data:image/png;base64,iVBORw0KGgo="
    }),
    null
  );
});
