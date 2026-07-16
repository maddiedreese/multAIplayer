import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexActivityTimelineView } from "../src/components/CodexActivityTimeline";
import {
  emptyLocalRoomHistoryPayload,
  maxLocalHistoryItemsPerContainer,
  normalizeLocalRoomHistory,
  normalizeRetainedLocalRoomHistory,
  pruneLocalRoomHistory,
  InvalidLocalRoomHistoryError,
  UnsupportedLocalRoomHistoryVersionError
} from "../src/lib/history/localRoomHistoryPayload";
import { useAppStore } from "../src/store/appStore";
import type { CodexActivity } from "../src/types";

function activity(overrides: Partial<CodexActivity> = {}): CodexActivity {
  return {
    eventType: "codex.activity",
    activityId: "turn-1-item-1",
    turnId: "turn-1",
    itemId: "item-1",
    kind: "command",
    status: "started",
    title: "Command execution",
    startedAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
    host: "Host",
    hostUserId: "user-host",
    ...overrides
  };
}

test.beforeEach(() => useAppStore.getState().resetAppStore());

test("activity lifecycle updates upsert in one room without leaking to another", () => {
  useAppStore.getState().upsertCodexActivity("room-a", activity());
  useAppStore.getState().upsertCodexActivity(
    "room-a",
    activity({
      status: "completed",
      updatedAt: "2026-07-09T12:00:02.000Z"
    })
  );
  const runtime = useAppStore.getState().codexRuntimeByRoom;
  assert.equal(runtime["room-a"]?.activities?.length, 1);
  assert.equal(runtime["room-a"]?.activities?.[0]?.status, "completed");
  assert.equal(runtime["room-b"]?.activities, undefined);
});

test("activity timeline retains only the newest bounded room items", () => {
  for (let index = 0; index < 170; index += 1) {
    useAppStore.getState().upsertCodexActivity(
      "room-a",
      activity({
        activityId: `turn-1-item-${index}`,
        itemId: `item-${index}`,
        updatedAt: new Date(Date.UTC(2026, 6, 9, 12, 0, index)).toISOString()
      })
    );
  }
  const activities = useAppStore.getState().codexRuntimeByRoom["room-a"]?.activities ?? [];
  assert.equal(activities.length, 160);
  assert.equal(activities[0]?.itemId, "item-10");
});

test("local-history round trips omit absent optional state", () => {
  const empty = emptyLocalRoomHistoryPayload();
  assert.equal(Object.hasOwn(empty, "readState"), false);

  const roundTripped = normalizeLocalRoomHistory(JSON.parse(JSON.stringify({ ...empty, readState: undefined })));
  assert.equal(Object.hasOwn(roundTripped, "readState"), false);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(roundTripped)), "readState"), false);
});

test("local-history normalization rejects non-objects and unknown schema versions", () => {
  assert.throws(() => normalizeLocalRoomHistory(null), InvalidLocalRoomHistoryError);
  assert.throws(() => normalizeLocalRoomHistory("not history"), InvalidLocalRoomHistoryError);
  assert.throws(
    () => normalizeRetainedLocalRoomHistory({ version: 99, messages: [{ body: "untrusted" }] }, 30),
    UnsupportedLocalRoomHistoryVersionError
  );
});

test("current local-history schema fails closed on malformed required containers and entries", () => {
  const current = emptyLocalRoomHistoryPayload();
  assert.throws(
    () => normalizeRetainedLocalRoomHistory({ ...current, messages: "not-an-array" }, 30),
    InvalidLocalRoomHistoryError
  );
  assert.throws(
    () => normalizeRetainedLocalRoomHistory({ ...current, browserRequests: [{}] }, 30),
    InvalidLocalRoomHistoryError
  );
  assert.throws(
    () =>
      normalizeRetainedLocalRoomHistory(
        { ...current, codexThreadGraph: { activeThreadId: "missing", nodesById: {} } },
        30
      ),
    InvalidLocalRoomHistoryError
  );
});

test("canonical history retains the newest bounded messages and round trips through strict v3", () => {
  const createdAt = new Date().toISOString();
  const payload = {
    ...emptyLocalRoomHistoryPayload(),
    messages: Array.from({ length: maxLocalHistoryItemsPerContainer + 1 }, (_, index) => ({
      id: `message-${index}`,
      author: "Maddie",
      role: "human" as const,
      body: `Message ${index}`,
      time: createdAt,
      createdAt
    }))
  };
  const normalized = pruneLocalRoomHistory(payload, 30);
  assert.equal(normalized.messages.length, maxLocalHistoryItemsPerContainer);
  assert.equal(normalized.messages[0]?.id, "message-1");
  assert.equal(
    normalizeLocalRoomHistory(JSON.parse(JSON.stringify(normalized))).messages.length,
    maxLocalHistoryItemsPerContainer
  );
});

test("activity timeline renders safe lifecycle metadata", () => {
  const html = renderToStaticMarkup(
    React.createElement(CodexActivityTimelineView, {
      activities: [activity({ status: "running" })]
    })
  );
  assert.match(html, /Codex activity/);
  assert.match(html, /Command execution/);
  assert.match(html, /in progress/i);
  assert.doesNotMatch(html, /secret|command-argument/i);
});

test("activity disclosures render bounded reasoning, edits, commands, and subagent state behind details", () => {
  const html = renderToStaticMarkup(
    React.createElement(CodexActivityTimelineView, {
      activities: [
        activity({
          activityId: "reasoning",
          kind: "reasoning",
          title: "Reasoning",
          details: {
            type: "reasoning",
            summaries: ["Checking the room boundary before editing."],
            rawContent: ["Provider-supplied raw reasoning detail."]
          }
        }),
        activity({
          activityId: "command",
          details: { type: "command", command: "npm test", output: "15 passing", exitCode: 0 }
        }),
        activity({
          activityId: "files",
          kind: "file_change",
          details: { type: "file_change", changes: [{ path: "src/chat.tsx", action: "update", diff: "+ safe" }] }
        }),
        activity({
          activityId: "agent",
          kind: "agent",
          agent: { action: "spawn", senderId: "root", receiverIds: ["child"] },
          details: {
            type: "agent",
            prompt: "Audit the chat renderer",
            states: [{ threadId: "child", status: "running", message: "Inspecting tests" }]
          }
        })
      ]
    })
  );
  assert.match(html, /<details/);
  assert.match(html, /Thinking/);
  assert.match(html, /Checking the room boundary/);
  assert.match(html, /Raw reasoning shared with this room/);
  assert.match(html, /Provider-supplied raw reasoning detail/);
  assert.match(html, /npm test/);
  assert.match(html, /src\/chat.tsx/);
  assert.match(html, /Spawned a subagent/);
  assert.match(html, /Inspecting tests/);
});
