import assert from "node:assert/strict";
import test from "node:test";
import {
  codexConsumedMessageIds,
  latestCodexStartedAt,
  messageIsBeforeCodexWatermark
} from "../src/lib/codexMessageWatermark";
import type { CodexRoomEvent } from "../src/types";

const startedWithIds: CodexRoomEvent = {
  eventType: "codex.turn",
  turnId: "turn-1",
  status: "started",
  message: "Started Codex turn.",
  model: "gpt-5.5",
  consumedMessageIds: ["message-1"],
  host: "Maddie",
  hostUserId: "github:maddie",
  createdAt: "2026-07-08T12:00:00.000Z"
};

test("codexConsumedMessageIds derives exact started-turn package membership", () => {
  assert.deepEqual([...codexConsumedMessageIds([startedWithIds])], ["message-1"]);
  assert.equal(
    messageIsBeforeCodexWatermark({ id: "message-1", createdAt: "2026-07-08T12:01:00.000Z" }, [startedWithIds]),
    false
  );
  assert.equal(
    messageIsBeforeCodexWatermark({ id: "message-2", createdAt: "2026-07-08T12:01:00.000Z" }, [startedWithIds]),
    true
  );
});

test("messageIsBeforeCodexWatermark falls back to started timestamps for legacy events", () => {
  const legacyStarted: CodexRoomEvent = {
    ...startedWithIds,
    turnId: "turn-legacy",
    consumedMessageIds: undefined,
    createdAt: "2026-07-08T12:05:00.000Z"
  };

  assert.equal(latestCodexStartedAt([legacyStarted]), "2026-07-08T12:05:00.000Z");
  assert.equal(
    messageIsBeforeCodexWatermark({ id: "before", createdAt: "2026-07-08T12:04:59.000Z" }, [legacyStarted]),
    false
  );
  assert.equal(
    messageIsBeforeCodexWatermark({ id: "after", createdAt: "2026-07-08T12:05:01.000Z" }, [legacyStarted]),
    true
  );
  assert.equal(messageIsBeforeCodexWatermark({ id: "missing-created-at" }, [legacyStarted]), false);
});
