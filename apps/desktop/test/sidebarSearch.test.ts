import assert from "node:assert/strict";
import test from "node:test";
import { findSidebarMessageHits, mergeSearchableMessages, searchMatches } from "../src/lib/sidebarSearch";

const historyMessages = {
  "room-alpha": [{ id: "old-alpha", author: "Maddie", body: "older local history mention", attachments: [] }],
  "room-beta": [
    { id: "old-beta", author: "Alex", body: "saved restart context", attachments: [{ name: "design-notes.md" }] }
  ]
};

test("mergeSearchableMessages prefers live room messages over local history cache", () => {
  const merged = mergeSearchableMessages(
    {
      "room-alpha": [{ id: "live-alpha", author: "Maddie", body: "fresh loaded chat", attachments: [] }],
      "room-empty": []
    },
    historyMessages
  );

  assert.equal(merged["room-alpha"][0].id, "live-alpha");
  assert.equal(merged["room-beta"][0].id, "old-beta");
  assert.equal(merged["room-empty"], undefined);
});

test("findSidebarMessageHits matches authors, message bodies, and attachment names", () => {
  const hits = findSidebarMessageHits(historyMessages, "design-notes");

  assert.deepEqual(
    hits.map((hit) => `${hit.roomId}:${hit.message.id}`),
    ["room-beta:old-beta"]
  );
});

test("searchMatches normalizes query case and whitespace", () => {
  assert.equal(searchMatches(["Core Desktop"], " desktop "), true);
  assert.equal(searchMatches(["Core Desktop"], "mobile"), false);
});
