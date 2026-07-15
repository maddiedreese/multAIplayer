import assert from "node:assert/strict";
import { test } from "node:test";
import {
  maxCodexModelChars,
  maxRoomNameChars,
  maxRoomProjectPathChars,
  maxTeamNameChars,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
  normalizeCodexSandboxLevel,
  normalizeCodexSpeed,
  planRoomCreation,
  planTeamCreation
} from "../src/lib/workspace/workspaceCreation";

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
  assert.throws(
    () => planRoomCreation("team-core", "Room", `/${"x".repeat(maxRoomProjectPathChars + 1)}`),
    /project folder/
  );
  assert.throws(() => planRoomCreation("team-core", "Room", "/tmp/project\u0000secret"), /project folder/);
});

test("normalizeCodexModel accepts known and model-like ids", () => {
  assert.equal(normalizeCodexModel(" gpt-5.3-codex "), "gpt-5.3-codex");
  assert.equal(normalizeCodexModel(" gpt-5.1-codex-max "), "gpt-5.1-codex-max");
  assert.equal(normalizeCodexModel("provider/custom-model:v1"), "provider/custom-model:v1");
});

test("normalizeCodexModel rejects blank, oversized, and non-model-like ids", () => {
  assert.equal(normalizeCodexModel(" "), null);
  assert.equal(normalizeCodexModel("x".repeat(maxCodexModelChars + 1)), null);
  assert.equal(normalizeCodexModel("bad model with spaces"), null);
});

test("normalizeCodexReasoningEffort accepts current Codex reasoning choices", () => {
  assert.equal(normalizeCodexReasoningEffort("none"), "none");
  assert.equal(normalizeCodexReasoningEffort("minimal"), "minimal");
  assert.equal(normalizeCodexReasoningEffort("low"), "low");
  assert.equal(normalizeCodexReasoningEffort("medium"), "medium");
  assert.equal(normalizeCodexReasoningEffort("high"), "high");
  assert.equal(normalizeCodexReasoningEffort("xhigh"), "xhigh");
  assert.equal(normalizeCodexReasoningEffort("max"), "max");
  assert.equal(normalizeCodexReasoningEffort("extra"), null);
});

test("normalizeCodexSpeed accepts current Codex speed choices", () => {
  assert.equal(normalizeCodexSpeed("standard"), "standard");
  assert.equal(normalizeCodexSpeed("fast"), "fast");
  assert.equal(normalizeCodexSpeed("flex"), null);
  assert.equal(normalizeCodexSpeed("urgent"), null);
});

test("normalizeCodexSandboxLevel accepts supported room sandbox choices", () => {
  assert.equal(normalizeCodexSandboxLevel("read_only"), "read_only");
  assert.equal(normalizeCodexSandboxLevel("workspace_write"), "workspace_write");
  assert.equal(normalizeCodexSandboxLevel("workspace_write_network"), "workspace_write_network");
  assert.equal(normalizeCodexSandboxLevel("danger_full_access"), "danger_full_access");
  assert.equal(normalizeCodexSandboxLevel("full-send"), null);
});
