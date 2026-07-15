import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveMainColumnValues,
  guidedActivityKind,
  mainColumnLocalUser,
  replyTargetDisplay
} from "../src/hooks/roomMainColumnCompositionValues";
import type { ChatMessage } from "../src/types";

const message: ChatMessage = {
  id: "message-1",
  author: "Maddie",
  role: "human",
  body: "Ship it",
  time: "9:43",
  createdAt: "2026-07-15T12:00:00.000Z"
};

test("main-column derivation uses stable empty defaults and resolves replies", () => {
  const emptyA = deriveMainColumnValues(undefined, undefined, []);
  const emptyB = deriveMainColumnValues(undefined, undefined, []);
  assert.equal(emptyA.pendingAttachments, emptyB.pendingAttachments);
  assert.equal(emptyA.codexEvents, emptyB.codexEvents);

  const derived = deriveMainColumnValues({ replyToMessageId: message.id } as never, undefined, [message]);
  assert.equal(derived.replyTargetMessage, message);
  assert.deepEqual(replyTargetDisplay(message), { author: "Maddie", body: "Ship it" });
});

test("main-column presentation helpers preserve local identity and activity grouping", () => {
  assert.deepEqual(mainColumnLocalUser(null, "device-1"), { id: "local:device-1", name: "Local user" });
  assert.equal(guidedActivityKind("reasoning"), "thinking");
  assert.equal(guidedActivityKind("web_search"), "tools");
  assert.equal(guidedActivityKind("other"), null);
});
