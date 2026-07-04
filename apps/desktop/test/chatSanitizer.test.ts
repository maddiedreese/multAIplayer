import assert from "node:assert/strict";
import test from "node:test";
import { maxEmbeddedAttachmentBytes } from "@multaiplayer/protocol";
import { normalizeChatAttachment, normalizeChatMessage } from "../src/lib/chatSanitizer";

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
  assert.equal(normalizeChatMessage({ id: "m1", author: "Maddie", role: "assistant", body: "bad role", time: "10:00" }), null);
});
