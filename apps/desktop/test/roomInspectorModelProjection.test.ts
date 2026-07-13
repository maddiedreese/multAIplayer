import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed
} from "@multaiplayer/protocol";
import { buildRoomInspectorModelProjection } from "../src/lib/roomInspectorModelProjection";
import { seededRooms } from "./support/workspaceFixtures";

test("room inspector model projection applies protocol defaults without duplicating state", () => {
  const room = seededRooms[0];
  assert.ok(room);
  const projection = buildRoomInspectorModelProjection(
    {
      ...room,
      codexModel: undefined,
      codexReasoningEffort: undefined,
      codexSpeed: undefined,
      codexSandboxLevel: undefined
    },
    null
  );

  assert.equal(projection.selectedModel, defaultCodexModel);
  assert.equal(projection.selectedReasoningEffort, defaultCodexReasoningEffort);
  assert.equal(projection.selectedSpeed, defaultCodexSpeed);
  assert.equal(projection.selectedSandboxLevel, defaultCodexSandboxLevel);
  assert.equal(projection.customModel, defaultCodexModel);
});

test("room inspector model projection keeps a room-scoped custom draft", () => {
  const room = seededRooms[0];
  assert.ok(room);
  const projection = buildRoomInspectorModelProjection({ ...room, codexModel: "gpt-stable" }, null, "gpt-next");
  assert.equal(projection.selectedModel, "gpt-stable");
  assert.equal(projection.customModel, "gpt-next");
});
