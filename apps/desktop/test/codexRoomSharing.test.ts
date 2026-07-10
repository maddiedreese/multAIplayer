import assert from "node:assert/strict";
import test from "node:test";

import {
  codexHostFailureRoomMessage,
  projectCodexRoomEvent,
  projectCodexRoomStatus
} from "../src/lib/codexRoomSharing.ts";

test("room event projection keeps protocol names and strips native diagnostics", () => {
  assert.equal(projectCodexRoomEvent("item/started"), "item/started");
  assert.equal(projectCodexRoomEvent("turn/start acknowledged"), "turn/start acknowledged");
  assert.equal(projectCodexRoomEvent("thread/resume: 019abc"), "thread/resume");
  assert.equal(projectCodexRoomEvent('{"error":{"message":"/Users/alice/private"}}'), null);
  assert.equal(projectCodexRoomEvent("failed to connect to https://private.example"), null);
});

test("room status and failure messages are fixed bounded values", () => {
  assert.equal(projectCodexRoomStatus("interrupted"), "interrupted");
  assert.equal(projectCodexRoomStatus("failed: /Users/alice/private"), "failed");
  assert.doesNotMatch(codexHostFailureRoomMessage, /error|stderr|path|connector/i);
});
