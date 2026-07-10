import assert from "node:assert/strict";
import test from "node:test";
import {
  RoomRecord,
  defaultCodexModelPolicy,
  defaultCodexReasoningEffortPolicy,
  defaultCodexServiceTierPolicy
} from "../src/index.js";

test("room protocol accepts explicit catalog intent and none reasoning", () => {
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
    codexReasoningEffort: "none",
    codexReasoningEffortPolicy: "pinned",
    codexSpeed: "standard",
    codexServiceTierPolicy: "auto",
    codexSandboxLevel: "workspace_write",
    browserAllowedOrigins: [],
    browserProfilePersistent: true,
    unread: 0
  });

  assert.equal(room.codexReasoningEffort, "none");
  assert.equal(defaultCodexModelPolicy, "auto");
  assert.equal(defaultCodexReasoningEffortPolicy, "auto");
  assert.equal(defaultCodexServiceTierPolicy, "auto");
});
