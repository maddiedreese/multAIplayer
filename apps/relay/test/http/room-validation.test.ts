import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "express";
import { allowTotalRoomQuota } from "../../src/http/room-validation.js";
import { createRelayStore } from "../../src/state.js";

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

function roomRecord(id: string, teamId: string, deletedAt?: string) {
  return {
    id,
    teamId,
    name: id,
    host: "Maddie",
    hostStatus: "offline" as const,
    approvalPolicy: "ask_every_turn" as const,
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
  return { response, statusCode: () => statusCode, body: () => body };
}
