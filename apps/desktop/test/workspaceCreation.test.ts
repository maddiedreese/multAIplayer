import assert from "node:assert/strict";
import { test } from "node:test";
import {
  maxCodexModelChars,
  maxRoomNameChars,
  maxRoomProjectPathChars,
  maxTeamNameChars,
  normalizeCodexModel,
  planRoomCreation,
  planTeamCreation
} from "../src/lib/workspaceCreation";

test("planTeamCreation trims team names", () => {
  assert.deepEqual(planTeamCreation("  Core Team  "), { name: "Core Team" });
});

test("planTeamCreation rejects blank names", () => {
  assert.throws(() => planTeamCreation("   "), /Enter a team name/);
});

test("planTeamCreation rejects oversized and control-character names", () => {
  assert.throws(() => planTeamCreation("x".repeat(maxTeamNameChars + 1)), /team name/);
  assert.throws(() => planTeamCreation("Core\u0000Team"), /team name/);
});

test("planRoomCreation trims room names and project paths", () => {
  assert.deepEqual(planRoomCreation("team-core", "  Desktop client  ", "  /tmp/project  "), {
    teamId: "team-core",
    name: "Desktop client",
    projectPath: "/tmp/project"
  });
});

test("planRoomCreation rejects missing team, room, or project", () => {
  assert.throws(() => planRoomCreation("", "Room", "/tmp/project"), /Create or select a team/);
  assert.throws(() => planRoomCreation("team-core", " ", "/tmp/project"), /Enter a room name/);
  assert.throws(() => planRoomCreation("team-core", "Room", " "), /local project folder/);
});

test("planRoomCreation rejects oversized and control-character room metadata", () => {
  assert.throws(() => planRoomCreation("team-core", "x".repeat(maxRoomNameChars + 1), "/tmp/project"), /room name/);
  assert.throws(() => planRoomCreation("team-core", "Room\u0007", "/tmp/project"), /room name/);
  assert.throws(() => planRoomCreation("team-core", "Room", `/${"x".repeat(maxRoomProjectPathChars + 1)}`), /project folder/);
  assert.throws(() => planRoomCreation("team-core", "Room", "/tmp/project\u0000secret"), /project folder/);
});

test("normalizeCodexModel accepts known and model-like ids", () => {
  assert.equal(normalizeCodexModel(" gpt-5.4-thinking "), "gpt-5.4-thinking");
  assert.equal(normalizeCodexModel("provider/custom-model:v1"), "provider/custom-model:v1");
});

test("normalizeCodexModel rejects blank, oversized, and non-model-like ids", () => {
  assert.equal(normalizeCodexModel(" "), null);
  assert.equal(normalizeCodexModel("x".repeat(maxCodexModelChars + 1)), null);
  assert.equal(normalizeCodexModel("bad model with spaces"), null);
});
