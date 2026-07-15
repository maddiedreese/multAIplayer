import test from "node:test";
import assert from "node:assert/strict";
import type { ClientRoomRecord, RoomConfigPlaintextPayload } from "@multaiplayer/protocol";
import {
  applyRoomConfig,
  resolveRoomConfigForPublish,
  roomConfigPayload,
  shouldApplyRoomConfig
} from "../src/lib/roomConfigSnapshot";
import { ensureRoomDefaults } from "../src/lib/roomDefaults";
import { seededRooms } from "./support/workspaceFixtures";

function room(overrides: Partial<ClientRoomRecord> = {}): ClientRoomRecord {
  return {
    ...seededRooms[0]!,
    codexModelPolicy: "pinned",
    codexReasoningEffort: "high",
    codexReasoningEffortPolicy: "pinned",
    codexRawReasoningEnabled: false,
    codexSpeed: "standard",
    codexServiceTierPolicy: "pinned",
    codexSandboxLevel: "workspace_write",
    configRevision: 4,
    configEpoch: 7,
    configPending: false,
    ...overrides
  };
}

test("room config snapshots carry the complete member-only configuration", () => {
  const payload = roomConfigPayload(room(), 8, 5);
  assert.deepEqual(
    Object.keys(payload).sort(),
    [
      "codexModel",
      "codexModelPolicy",
      "codexRawReasoningEnabled",
      "codexReasoningEffort",
      "codexReasoningEffortPolicy",
      "codexSandboxLevel",
      "codexServiceTierPolicy",
      "codexSpeed",
      "configRevision",
      "emittingEpoch",
      "eventType",
      "projectPath"
    ].sort()
  );
  assert.equal(payload.eventType, "room.config");
  assert.equal(payload.emittingEpoch, 8);
});

test("joiners converge on a post-Add snapshot and stale snapshots cannot roll config back", () => {
  const pending = room({ projectPath: "", configRevision: 0, configEpoch: 0, configPending: true });
  const current = roomConfigPayload(room({ projectPath: "/current", codexModel: "gpt-5.4" }), 8, 9);
  const converged = applyRoomConfig(pending, current, 8);
  assert.equal(converged.projectPath, "/current");
  assert.equal(converged.configPending, false);
  const staleRevision = { ...current, projectPath: "/stale", configRevision: 8 } satisfies RoomConfigPlaintextPayload;
  assert.equal(shouldApplyRoomConfig(converged, staleRevision, 8), false);
  assert.equal(applyRoomConfig(converged, staleRevision, 8), converged);
});

test("snapshot epoch must match MLS authenticated data", () => {
  const current = room();
  const forgedEpoch = roomConfigPayload(current, 9, 10);
  assert.equal(shouldApplyRoomConfig(current, forgedEpoch, 8), false);
  assert.equal(shouldApplyRoomConfig(current, forgedEpoch, 9), true);
});

test("public relay room updates cannot overwrite an MLS-derived local config", () => {
  const configured = room({ projectPath: "/private/current", configRevision: 12, configEpoch: 9 });
  const {
    projectPath: _path,
    codexModel: _model,
    configRevision: _revision,
    configEpoch: _epoch,
    ...metadata
  } = configured;
  const merged = ensureRoomDefaults(metadata, configured);
  assert.equal(merged.projectPath, "/private/current");
  assert.equal(merged.codexModel, configured.codexModel);
  assert.equal(merged.configRevision, 12);
  assert.equal(merged.configEpoch, 9);
});

test("post-Add publication recovers host configuration from the encrypted native store", async () => {
  const configured = room({ projectPath: "/private/current", configRevision: 12, configEpoch: 9 });
  const lostInMemory = room({ projectPath: "", configRevision: 0, configEpoch: 0, configPending: true });
  const persisted = roomConfigPayload(configured, 9, 12);
  const recovered = await resolveRoomConfigForPublish(lostInMemory, async (roomId) => {
    assert.equal(roomId, lostInMemory.id);
    return persisted;
  });
  assert.equal(recovered.projectPath, "/private/current");
  assert.equal(recovered.configRevision, 12);
  assert.equal(recovered.configEpoch, 9);
  assert.equal(recovered.configPending, false);
});

test("post-Add publication fails closed when no valid local configuration survives", async () => {
  const lostInMemory = room({ projectPath: "", configRevision: 0, configEpoch: 0, configPending: true });
  await assert.rejects(
    resolveRoomConfigForPublish(lostInMemory, async () => null),
    /no longer has the encrypted room configuration/
  );
});
