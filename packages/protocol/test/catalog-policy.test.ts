import assert from "node:assert/strict";
import test from "node:test";
import {
  ClientRoomRecord,
  HostHandoffPlaintextPayload,
  RoomRecord,
  RoomSettingsPlaintextPayload,
  codexReasoningEffortIds,
  codexReasoningEffortOptions,
  defaultCodexModelPolicy,
  defaultCodexReasoningEffortPolicy,
  defaultCodexRawReasoningEnabled,
  defaultCodexServiceTierPolicy
} from "../src/index.js";

test("active rooms require a stable host identity", () => {
  const room = {
    id: "room-active",
    teamId: "team-core",
    acceptedMlsEpoch: 1,
    name: "Active",
    host: "Maddie",
    activeHostDeviceId: "device-maddie",
    hostStatus: "active",
    approvalPolicy: "ask_every_turn",
    mode: { chat: true, code: true, workspace: true, browser: true },
    browserProfilePersistent: true,
    unread: 0
  };

  assert.equal(RoomRecord.safeParse(room).success, false);
  assert.equal(RoomRecord.safeParse({ ...room, hostUserId: "github:maddie" }).success, true);
  assert.equal(RoomRecord.safeParse({ ...room, hostUserId: "github:maddie", hostStatus: "handoff" }).success, false);
});

test("room protocol derives its reasoning enum from the shared options", () => {
  const room = ClientRoomRecord.parse({
    id: "room-catalog",
    teamId: "team-core",
    name: "Catalog",
    projectPath: "/tmp/catalog",
    host: "No host",
    hostStatus: "offline",
    approvalPolicy: "ask_every_turn",
    mode: { chat: true, code: true, workspace: true, browser: false },
    codexModel: "fallback-model",
    codexModelPolicy: "auto",
    codexReasoningEffort: "max",
    codexReasoningEffortPolicy: "pinned",
    codexRawReasoningEnabled: true,
    codexSpeed: "standard",
    codexServiceTierPolicy: "auto",
    codexSandboxLevel: "workspace_write",
    browserProfilePersistent: true,
    unread: 0,
    configRevision: 1,
    configEpoch: 1,
    configPending: false
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

test("host handoff protocol requires the complete current Codex configuration", () => {
  const handoff = {
    id: "handoff-current",
    fromHost: "Maddie",
    fromUserId: "github:maddie",
    reason: "manual",
    projectPath: "/tmp/catalog",
    codexModel: "fallback-model",
    codexModelPolicy: "auto",
    codexReasoningEffort: "medium",
    codexReasoningEffortPolicy: "auto",
    codexRawReasoningEnabled: false,
    codexSpeed: "standard",
    codexServiceTierPolicy: "auto",
    codexSandboxLevel: "workspace_write",
    approvalPolicy: "ask_every_turn",
    messagesSinceLastCodex: 0,
    queuedCodexTurns: [],
    attachmentNames: [],
    terminals: [],
    createdAt: new Date().toISOString(),
    status: "available"
  };
  assert.equal(HostHandoffPlaintextPayload.safeParse(handoff).success, true);
  for (const field of [
    "codexModelPolicy",
    "codexReasoningEffort",
    "codexReasoningEffortPolicy",
    "codexRawReasoningEnabled",
    "codexSpeed",
    "codexServiceTierPolicy",
    "codexSandboxLevel"
  ]) {
    const incomplete = { ...handoff } as Record<string, unknown>;
    delete incomplete[field];
    assert.equal(HostHandoffPlaintextPayload.safeParse(incomplete).success, false, field);
  }
});
