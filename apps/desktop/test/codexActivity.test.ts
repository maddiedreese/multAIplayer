import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexActivityTimelineView } from "../src/components/CodexActivityTimeline";
import { emptyLocalRoomHistoryPayload, normalizeLocalRoomHistory } from "../src/lib/localRoomHistoryPayload";
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

test("legacy local history migrates to an empty canonical activity timeline", () => {
  const legacy = emptyLocalRoomHistoryPayload();
  delete legacy.codexActivities;
  assert.deepEqual(normalizeLocalRoomHistory(legacy).codexActivities, []);
});

test("activity timeline renders safe lifecycle metadata", () => {
  const html = renderToStaticMarkup(
    React.createElement(CodexActivityTimelineView, {
      activities: [activity({ status: "running" })]
    })
  );
  assert.match(html, /Codex activity/);
  assert.match(html, /Command execution/);
  assert.match(html, /in progress/);
  assert.doesNotMatch(html, /secret|command-argument/i);
});
