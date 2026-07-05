import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAcceptRoomHostHandoff,
  createHandoffSettingsPatch,
  findRoomHostHandoff,
  isRoomHostMutationInFlight,
  roomHostHandoffMessage,
  roomHostMutationInFlightMessage
} from "../src/lib/hostHandoff";
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

test("host handoff acceptance requires an available handoff from the current room list", () => {
  const available = { ...baseHandoff, status: "available" as const };
  const accepted = { ...baseHandoff, id: "handoff-2", status: "accepted" as const };
  const handoffs = [available, accepted];

  assert.deepEqual(findRoomHostHandoff(handoffs, available.id), available);
  assert.equal(canAcceptRoomHostHandoff(handoffs, available.id), true);
  assert.equal(canAcceptRoomHostHandoff(handoffs, accepted.id), false);
  assert.equal(canAcceptRoomHostHandoff(handoffs, "missing"), false);
  assert.equal(
    roomHostHandoffMessage(handoffs, accepted.id),
    "Host handoff is accepted, not available."
  );
  assert.equal(
    roomHostHandoffMessage(handoffs, "missing"),
    "Host handoff is no longer available in this room."
  );
});

test("host mutation in-flight guard is scoped to one room", () => {
  assert.equal(isRoomHostMutationInFlight({ "room-a": true }, "room-a"), true);
  assert.equal(isRoomHostMutationInFlight({ "room-a": true }, "room-b"), false);
  assert.equal(isRoomHostMutationInFlight({ "room-a": false }, "room-a"), false);
  assert.equal(roomHostMutationInFlightMessage(), "Host change is already in progress for this room.");
});
