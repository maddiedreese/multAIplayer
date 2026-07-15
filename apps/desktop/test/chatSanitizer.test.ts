import assert from "node:assert/strict";
import test from "node:test";
import { maxEmbeddedAttachmentBytes } from "@multaiplayer/protocol";
import { normalizeChatAttachment, normalizeChatMessage } from "../src/lib/chat/chatSanitizer";

test("normalizeChatMessage repairs malformed attachments without dropping chat text", () => {
  const message = normalizeChatMessage({
    id: "m1",
    author: "Maddie",
    role: "human",
    body: "please inspect this",
    time: "10:00",
    attachments: [
      { id: "", name: "", type: "", size: Number.NaN, content: "hello" },
      { id: "att-2", name: "design.sketch", size: 2_400_000 }
    ]
  });

  assert.ok(message);
  assert.equal(message.body, "please inspect this");
  assert.deepEqual(message.attachments, [
    {
      id: "attachment-1",
      name: "Attachment 1",
      type: "file",
      size: 5,
      content: "hello"
    },
    {
      id: "att-2",
      name: "design.sketch",
      type: "image",
      size: 2_400_000
    }
  ]);
});

test("normalized chat JSON omits an absent attachment collection", () => {
  const message = normalizeChatMessage({
    id: "m-no-attachments",
    author: "Maddie",
    role: "human",
    body: "No attachment payload",
    time: "10:00",
    attachments: undefined
  });

  assert.ok(message);
  assert.equal(Object.hasOwn(message, "attachments"), false);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(message)), "attachments"), false);
});

test("normalizeChatAttachment bounds oversized inline content", () => {
  const content = "a".repeat(maxEmbeddedAttachmentBytes + 10);
  const attachment = normalizeChatAttachment({
    id: "att-large",
    name: "large.md",
    type: "code",
    size: 1,
    content
  });

  assert.ok(attachment);
  assert.equal(attachment.content?.length, maxEmbeddedAttachmentBytes);
  assert.equal(attachment.truncated, true);
});

test("normalizeChatMessage rejects invalid message envelopes", () => {
  assert.equal(normalizeChatMessage({ id: "m1", author: "Maddie", role: "human", body: "missing time" }), null);
  assert.equal(
    normalizeChatMessage({ id: "m1", author: "Maddie", role: "assistant", body: "bad role", time: "10:00" }),
    null
  );
});

test("normalizeChatMessage preserves valid reply references", () => {
  const message = normalizeChatMessage({
    id: "m2",
    author: "Jordan",
    role: "human",
    body: "agreed, do that",
    time: "10:01",
    replyTo: "m1"
  });

  assert.ok(message);
  assert.equal(message.replyTo, "m1");
  assert.equal(
    normalizeChatMessage({
      id: "m3",
      author: "Jordan",
      role: "human",
      body: "bad reply",
      time: "10:02",
      replyTo: " "
    }),
    null
  );
});

test("normalizeChatMessage preserves valid edit and delete metadata", () => {
  const message = normalizeChatMessage({
    id: "m4",
    author: "Maddie",
    authorUserId: "github:maddie",
    role: "human",
    body: "updated text",
    time: "10:04",
    editedAt: "2026-07-08T12:00:00.000Z",
    editedByUserId: "github:maddie",
    deletedAt: "2026-07-08T12:01:00.000Z",
    deletedBy: "Maddie",
    deletedByUserId: "github:maddie"
  });

  assert.ok(message);
  assert.equal(message.authorUserId, "github:maddie");
  assert.equal(message.editedAt, "2026-07-08T12:00:00.000Z");
  assert.equal(message.deletedBy, "Maddie");
  assert.equal(message.deletedByUserId, "github:maddie");
  assert.equal(
    normalizeChatMessage({
      id: "m5",
      author: "Maddie",
      authorUserId: 123,
      role: "human",
      body: "bad author",
      time: "10:05"
    }),
    null
  );
});
