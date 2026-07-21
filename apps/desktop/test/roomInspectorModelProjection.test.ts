import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed,
  type ClientRoomRecord
} from "@multaiplayer/protocol";
import { buildRoomInspectorModelProjection } from "../src/presentation/rooms/roomInspectorModelProjection";
import { seededRooms } from "./support/workspaceFixtures";

test("room inspector model projection applies protocol defaults without duplicating state", () => {
  const room = seededRooms[0];
  assert.ok(room);
  const legacyRoom = JSON.parse(
    JSON.stringify({
      ...room,
      codexModel: undefined,
      codexReasoningEffort: undefined,
      codexRawReasoningEnabled: undefined,
      codexSpeed: undefined,
      codexSandboxLevel: undefined
    })
  ) as ClientRoomRecord;
  const projection = buildRoomInspectorModelProjection(legacyRoom, null);

  assert.equal(projection.selectedModel, defaultCodexModel);
  assert.equal(projection.selectedReasoningEffort, defaultCodexReasoningEffort);
  assert.equal(projection.rawReasoningEnabled, false);
  assert.equal(projection.selectedSpeed, defaultCodexSpeed);
  assert.equal(projection.selectedSandboxLevel, defaultCodexSandboxLevel);
  assert.equal(projection.customModel, defaultCodexModel);
});

test("room inspector model projection exposes the room raw-reasoning sharing decision", () => {
  const room = seededRooms[0];
  assert.ok(room);
  const projection = buildRoomInspectorModelProjection({ ...room, codexRawReasoningEnabled: true }, null);
  assert.equal(projection.rawReasoningEnabled, true);
});

test("room inspector model projection keeps a room-scoped custom draft", () => {
  const room = seededRooms[0];
  assert.ok(room);
  const projection = buildRoomInspectorModelProjection({ ...room, codexModel: "gpt-stable" }, null, "gpt-next");
  assert.equal(projection.selectedModel, "gpt-stable");
  assert.equal(projection.customModel, "gpt-next");
});

test("room inspector projects the same resolved model and controls as the room header", () => {
  const room = seededRooms[0];
  assert.ok(room);
  const projection = buildRoomInspectorModelProjection(
    {
      ...room,
      codexModel: "stored-fallback",
      codexModelPolicy: "auto",
      codexReasoningEffort: "low",
      codexReasoningEffortPolicy: "auto",
      codexSpeed: "standard",
      codexServiceTierPolicy: "auto"
    },
    {
      available: true,
      version: "test",
      error: null,
      modelError: null,
      models: [
        {
          id: "active-model",
          model: "active-model",
          label: "Active model",
          description: "The runtime default",
          hidden: false,
          isDefault: true,
          supportedReasoningEfforts: ["high"],
          defaultReasoningEffort: "high",
          serviceTiers: ["fast"],
          defaultServiceTier: "fast"
        }
      ]
    }
  );

  assert.equal(projection.selectedModel, "active-model");
  assert.equal(projection.selectedReasoningEffort, "high");
  assert.equal(projection.selectedSpeed, "fast");
});
