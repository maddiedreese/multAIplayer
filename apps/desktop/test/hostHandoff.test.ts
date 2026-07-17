import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAcceptRoomHostHandoff,
  createHandoffSettingsPatch,
  findRoomHostHandoff,
  handoffRepoIdentity,
  hostHandoffDetail,
  hostHandoffTitle,
  isRoomHostMutationInFlight,
  roomHostHandoffMessage,
  roomHostMutationInFlightMessage,
  sameHandoffRepo
} from "../src/lib/handoff/hostHandoff";
import type { HostHandoffPlaintextPayload } from "@multaiplayer/protocol";

const baseHandoff: HostHandoffPlaintextPayload = {
  id: "handoff-1",
  fromHost: "Maddie",
  fromUserId: "github:maddie",
  reason: "manual",
  projectPath: " /tmp/multaiplayer ",
  codexModel: " gpt-5.4-thinking ",
  codexModelPolicy: "pinned",
  codexReasoningEffort: "medium",
  codexReasoningEffortPolicy: "pinned",
  codexRawReasoningEnabled: false,
  codexSpeed: "standard",
  codexServiceTierPolicy: "pinned",
  codexSandboxLevel: "workspace_write",
  approvalPolicy: "ask_every_turn",
  messagesSinceLastCodex: 3,
  queuedCodexTurns: [],
  attachmentNames: ["README.md"],
  terminals: ["tests"],
  createdAt: new Date().toISOString(),
  status: "available"
};

test("createHandoffSettingsPatch trims and returns inherited room settings", () => {
  assert.deepEqual(createHandoffSettingsPatch(baseHandoff), {
    projectPath: "/tmp/multaiplayer",
    codexModel: "gpt-5.4-thinking",
    codexModelPolicy: "pinned",
    codexReasoningEffort: "medium",
    codexReasoningEffortPolicy: "pinned",
    codexRawReasoningEnabled: false,
    codexSpeed: "standard",
    codexServiceTierPolicy: "pinned",
    codexSandboxLevel: "workspace_write",
    approvalPolicy: "ask_every_turn"
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
  assert.throws(
    () => createHandoffSettingsPatch({ ...baseHandoff, projectPath: "/tmp/project\u0000secret" }),
    /project path/
  );
  assert.throws(
    () => createHandoffSettingsPatch({ ...baseHandoff, codexModel: "bad model with spaces" }),
    /Codex model/
  );
  assert.throws(
    () =>
      createHandoffSettingsPatch({
        ...baseHandoff,
        codexSandboxLevel: "nope" as unknown as HostHandoffPlaintextPayload["codexSandboxLevel"]
      }),
    /sandbox/
  );
});

test("host handoff acceptance requires an available handoff from the current room list", () => {
  const available = { ...baseHandoff, status: "available" as const };
  const accepted = { ...baseHandoff, id: "handoff-2", status: "accepted" as const };
  const handoffs = [available, accepted];

  assert.deepEqual(findRoomHostHandoff(handoffs, available.id), available);
  assert.equal(canAcceptRoomHostHandoff(handoffs, available.id), true);
  assert.equal(canAcceptRoomHostHandoff(handoffs, accepted.id), false);
  assert.equal(canAcceptRoomHostHandoff(handoffs, "missing"), false);
  assert.equal(roomHostHandoffMessage(handoffs, accepted.id), "Host handoff is accepted, not available.");
  assert.equal(roomHostHandoffMessage(handoffs, "missing"), "Host handoff is no longer available in this room.");
});

test("host handoff helpers describe usage-limit continuation", () => {
  const handoff = {
    ...baseHandoff,
    reason: "usage_limit" as const,
    gitRepoOwner: "maddiedreese",
    gitRepoName: "multAIplayer",
    gitBranch: "main",
    gitPatch: "diff --git a/README.md b/README.md\n",
    gitPatchTruncated: false
  };

  assert.deepEqual(handoffRepoIdentity(handoff), {
    owner: "maddiedreese",
    repo: "multAIplayer"
  });
  assert.equal(sameHandoffRepo(handoffRepoIdentity(handoff), { owner: "MADDIEDREESE", repo: "multaiplayer" }), true);
  assert.equal(hostHandoffTitle(handoff), "Continue with another host");
  assert.equal(
    hostHandoffDetail(handoff),
    "Maddie is out of Codex usage. Attach maddiedreese/multAIplayer@main to continue from the room context."
  );
});

test("host mutation in-flight guard is scoped to one room", () => {
  assert.equal(isRoomHostMutationInFlight({ "room-a": true }, "room-a"), true);
  assert.equal(isRoomHostMutationInFlight({ "room-a": true }, "room-b"), false);
  assert.equal(isRoomHostMutationInFlight({ "room-a": false }, "room-a"), false);
  assert.equal(roomHostMutationInFlightMessage(), "Host change is already in progress for this room.");
});
