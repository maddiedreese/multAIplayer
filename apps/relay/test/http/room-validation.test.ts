import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "express";
import {
  allowTotalRoomQuota,
  consumeDailyCreationQuota,
  normalizeCatalogSelectionPolicy
} from "../../src/http/room-validation.js";
import { createRelayStore } from "../../src/state.js";

test("catalog selection policy accepts only defined policy values and preserves fallback", () => {
  assert.equal(normalizeCatalogSelectionPolicy(undefined), undefined);
  assert.equal(normalizeCatalogSelectionPolicy(undefined, "pinned"), "pinned");
  assert.equal(normalizeCatalogSelectionPolicy("auto"), "auto");
  assert.equal(normalizeCatalogSelectionPolicy("pinned"), "pinned");
  assert.equal(normalizeCatalogSelectionPolicy("manual"), null);
  assert.equal(normalizeCatalogSelectionPolicy(null), null);
});

test("total room quota counts only live rooms in the user's teams", () => {
  const store = createRelayStore();
  store.setRoom(roomRecord("live-a", "team-a"));
  store.setRoom(roomRecord("live-b", "team-a"));
  store.setRoom(roomRecord("deleted", "team-a", "2026-01-01T00:00:00.000Z"));
  store.setRoom(roomRecord("other-team", "team-b"));
  const rejectionTypes: string[] = [];
  const belowCap = responseRecorder();
  assert.equal(
    allowTotalRoomQuota({
      store,
      teamIds: new Set(["team-a"]),
      cap: 3,
      res: belowCap.response,
      recordQuotaRejection: (type) => rejectionTypes.push(type)
    }),
    true
  );
  assert.equal(belowCap.statusCode(), 200);
  assert.equal(belowCap.body(), undefined);
  assert.deepEqual(rejectionTypes, []);

  const atCap = responseRecorder();
  assert.equal(
    allowTotalRoomQuota({
      store,
      teamIds: new Set(["team-a"]),
      cap: 2,
      res: atCap.response,
      recordQuotaRejection: (type) => rejectionTypes.push(type)
    }),
    false
  );
  assert.equal(atCap.statusCode(), 429);
  assert.deepEqual(atCap.body(), {
    error: "Total room quota exceeded.",
    code: "quota_exceeded",
    quota: { type: "total_user_rooms", limit: 2, used: 2, remaining: 0 }
  });
  assert.deepEqual(rejectionTypes, ["total_user_rooms"]);
});

test("daily room creation quota increments, expires stale entries, and reports exact reset metadata", (t) => {
  const now = Date.UTC(2026, 6, 15, 12, 0, 0);
  t.mock.method(Date, "now", () => now);
  const counts = new Map([
    ["expired:user", { count: 99, resetAt: now }],
    ["unrelated:user", { count: 4, resetAt: now + 60_000 }]
  ]);
  const quota = "daily_user_room_creations" as const;
  const userId = "github:maddie";
  const accepted = responseRecorder();
  assert.equal(consumeDailyCreationQuota({ cap: 2, counts, quota, userId, res: accepted.response }), true);
  const expectedReset = Date.UTC(2026, 6, 16);
  assert.deepEqual(counts.get(`${quota}:${userId}`), { count: 1, resetAt: expectedReset });
  assert.equal(counts.has("expired:user"), false);
  assert.deepEqual(counts.get("unrelated:user"), { count: 4, resetAt: now + 60_000 });

  assert.equal(consumeDailyCreationQuota({ cap: 2, counts, quota, userId, res: accepted.response }), true);
  assert.deepEqual(counts.get(`${quota}:${userId}`), { count: 2, resetAt: expectedReset });

  const rejected = responseRecorder();
  const rejectionTypes: string[] = [];
  assert.equal(
    consumeDailyCreationQuota({
      cap: 2,
      counts,
      quota,
      userId,
      res: rejected.response,
      recordQuotaRejection: (type) => rejectionTypes.push(type)
    }),
    false
  );
  assert.equal(rejected.statusCode(), 429);
  assert.equal(rejected.headers().get("Retry-After"), 43_200);
  assert.deepEqual(rejected.body(), {
    error: "Daily room creation quota exceeded.",
    code: "quota_exceeded",
    retryAfterSeconds: 43_200,
    quota: {
      type: quota,
      limit: 2,
      used: 2,
      remaining: 0,
      resetsAt: "2026-07-16T00:00:00.000Z"
    }
  });
  assert.deepEqual(rejectionTypes, [quota]);
});

function roomRecord(id: string, teamId: string, deletedAt?: string) {
  return {
    id,
    teamId,
    name: id,
    host: "Maddie",
    hostStatus: "offline" as const,
    approvalPolicy: "ask_every_turn" as const,
    mode: { chat: true, code: true, workspace: true, browser: true },
    browserAllowedOrigins: [],
    browserProfilePersistent: false,
    ...(deletedAt ? { deletedAt } : {})
  };
}

function responseRecorder() {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string | number>();
  const response = {
    status(value: number) {
      statusCode = value;
      return response;
    },
    json(value: unknown) {
      body = value;
      return response;
    },
    setHeader(name: string, value: string | number) {
      headers.set(name, value);
      return response;
    }
  } as unknown as Response;
  return { response, statusCode: () => statusCode, body: () => body, headers: () => headers };
}
