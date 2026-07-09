import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRoomGoal,
  editRoomGoal,
  formatRoomGoalDuration,
  parseRoomGoalCommand,
  pauseRoomGoal,
  resumeRoomGoal,
  updateRoomGoalElapsed
} from "../src/lib/roomGoals";

test("parseRoomGoalCommand accepts /goal commands only", () => {
  assert.equal(parseRoomGoalCommand("/goal build the editor"), "build the editor");
  assert.equal(parseRoomGoalCommand("/goals: polish alpha"), null);
  assert.equal(parseRoomGoalCommand("@Codex /goal build"), null);
  assert.equal(parseRoomGoalCommand("/goal   "), null);
});

test("room goal lifecycle tracks elapsed time while paused and resumed", () => {
  const start = new Date("2026-07-07T10:00:00.000Z");
  const goal = createRoomGoal("Ship the multiplayer IDE", start);
  const ticked = updateRoomGoalElapsed(goal, new Date("2026-07-07T10:00:05.000Z"));
  assert.equal(ticked.elapsedMs, 5000);

  const paused = pauseRoomGoal(ticked, new Date("2026-07-07T10:00:10.000Z"));
  assert.equal(paused.status, "paused");
  assert.equal(paused.elapsedMs, 10000);
  assert.equal(updateRoomGoalElapsed(paused, new Date("2026-07-07T10:00:20.000Z")).elapsedMs, 10000);

  const resumed = resumeRoomGoal(paused, new Date("2026-07-07T10:01:00.000Z"));
  const edited = editRoomGoal(resumed, "Ship the alpha", new Date("2026-07-07T10:01:01.000Z"));
  assert.equal(edited.text, "Ship the alpha");
  assert.equal(edited.status, "active");
});

test("formatRoomGoalDuration keeps popup timers compact", () => {
  assert.equal(formatRoomGoalDuration(9000), "9s");
  assert.equal(formatRoomGoalDuration(65_000), "1m 5s");
  assert.equal(formatRoomGoalDuration(3_900_000), "1h 5m");
});
