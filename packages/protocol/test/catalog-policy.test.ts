import assert from "node:assert/strict";
import test from "node:test";
import {
  RoomRecord,
  RoomSettingsPlaintextPayload,
  codexReasoningEffortIds,
  codexReasoningEffortOptions,
  defaultCodexModelPolicy,
  defaultCodexReasoningEffortPolicy,
  defaultCodexRawReasoningEnabled,
  defaultCodexServiceTierPolicy
} from "../src/index.js";

test("room protocol derives its reasoning enum from the shared options", () => {
  const room = RoomRecord.parse({
    id: "room-catalog",
    teamId: "team-core",
    name: "Catalog",
    projectPath: "/tmp/catalog",
    host: "No host",
    hostStatus: "offline",
    approvalPolicy: "ask_every_turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    mode: { chat: true, code: true, workspace: true, browser: false },
    codexModel: "fallback-model",
    codexModelPolicy: "auto",
    codexReasoningEffort: "max",
    codexReasoningEffortPolicy: "pinned",
    codexRawReasoningEnabled: true,
    codexSpeed: "standard",
    codexServiceTierPolicy: "auto",
    codexSandboxLevel: "workspace_write",
    browserAllowedOrigins: [],
    browserProfilePersistent: true,
    unread: 0
  });

  assert.equal(room.codexReasoningEffort, "max");
  assert.equal(room.codexRawReasoningEnabled, true);
  assert.deepEqual(
    codexReasoningEffortIds,
    codexReasoningEffortOptions.map(({ id }) => id)
  );
  assert.equal(defaultCodexModelPolicy, "auto");
  assert.equal(defaultCodexReasoningEffortPolicy, "auto");
  assert.equal(defaultCodexRawReasoningEnabled, false);
  assert.equal(defaultCodexServiceTierPolicy, "auto");
});

test("room settings protocol carries the host's raw-reasoning sharing decision", () => {
  const event = RoomSettingsPlaintextPayload.parse({
    eventType: "room.settings",
    id: "settings-raw-reasoning",
    setting: "codexRawReasoningEnabled",
    previousValue: "false",
    nextValue: "true",
    changedBy: "Maddie",
    changedByUserId: "github:maddie",
    changedAt: new Date().toISOString()
  });

  assert.equal(event.setting, "codexRawReasoningEnabled");
});
