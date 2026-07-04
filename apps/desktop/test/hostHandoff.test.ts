import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandoffSettingsPatch } from "../src/lib/hostHandoff";
import type { HostHandoffPlaintextPayload } from "@multaiplayer/protocol";

const baseHandoff: HostHandoffPlaintextPayload = {
  id: "handoff-1",
  fromHost: "Maddie",
  fromUserId: "github:maddie",
  projectPath: " /tmp/multaiplayer ",
  codexModel: " gpt-5.4-thinking ",
  approvalPolicy: "auto_chat_only",
  messagesSinceLastCodex: 3,
  attachmentNames: ["README.md"],
  terminals: ["tests"],
  createdAt: new Date().toISOString()
};

test("createHandoffSettingsPatch trims and returns inherited room settings", () => {
  assert.deepEqual(createHandoffSettingsPatch(baseHandoff), {
    projectPath: "/tmp/multaiplayer",
    codexModel: "gpt-5.4-thinking",
    approvalPolicy: "auto_chat_only"
  });
});

test("createHandoffSettingsPatch rejects incomplete handoff packages", () => {
  assert.throws(() => createHandoffSettingsPatch({ ...baseHandoff, projectPath: " " }), /project path/);
  assert.throws(() => createHandoffSettingsPatch({ ...baseHandoff, codexModel: " " }), /Codex model/);
  assert.throws(
    () => createHandoffSettingsPatch({ ...baseHandoff, approvalPolicy: "surprise-policy" }),
    /approval policy/
  );
});

test("createHandoffSettingsPatch rejects unsupported handoff room metadata", () => {
  assert.throws(() => createHandoffSettingsPatch({ ...baseHandoff, projectPath: "/tmp/project\u0000secret" }), /project path/);
  assert.throws(() => createHandoffSettingsPatch({ ...baseHandoff, codexModel: "bad model with spaces" }), /Codex model/);
});
