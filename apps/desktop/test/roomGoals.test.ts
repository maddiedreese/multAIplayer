import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRoomGoalDuration, parseRoomGoalCommand, updateRoomGoalElapsed } from "../src/lib/room/roomGoals";

test("parseRoomGoalCommand accepts /goal commands only", () => {
  assert.equal(parseRoomGoalCommand("/goal build the editor"), "build the editor");
  assert.equal(parseRoomGoalCommand("/goals: polish alpha"), null);
  assert.equal(parseRoomGoalCommand("@Codex /goal build"), null);
  assert.equal(parseRoomGoalCommand("/goal   "), null);
});

test("room goal elapsed time advances only while active", () => {
  const goal = {
    id: "codex-goal-1",
    text: "Ship the multiplayer IDE",
    status: "active" as const,
    startedAt: "2026-07-07T10:00:00.000Z",
    updatedAt: "2026-07-07T10:00:00.000Z",
    elapsedMs: 0
  };
  const ticked = updateRoomGoalElapsed(goal, new Date("2026-07-07T10:00:05.000Z"));
  assert.equal(ticked.elapsedMs, 5000);
  const paused = { ...ticked, status: "paused" as const };
  assert.equal(updateRoomGoalElapsed(paused, new Date("2026-07-07T10:00:20.000Z")).elapsedMs, 5000);
});

test("formatRoomGoalDuration keeps popup timers compact", () => {
  assert.equal(formatRoomGoalDuration(9000), "9s");
  assert.equal(formatRoomGoalDuration(65_000), "1m 5s");
  assert.equal(formatRoomGoalDuration(3_900_000), "1h 5m");
});
