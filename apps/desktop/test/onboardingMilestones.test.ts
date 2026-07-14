import assert from "node:assert/strict";
import test from "node:test";
import { completedTurnIds, hasNewCompletedTurn, newestInviteRequestForDevice } from "../src/lib/onboardingMilestones";
import type { CodexRoomEvent, InviteJoinRequest } from "../src/types";

test("invite reconciliation is bound to both the signed-in user and this device", () => {
  const requests = [
    inviteRequest("other-user", "this-device", "approved"),
    inviteRequest("same-user", "other-device", "approved"),
    inviteRequest("same-user", "this-device", "pending")
  ];
  assert.equal(newestInviteRequestForDevice(requests, "same-user", "this-device")?.status, "pending");
  assert.equal(newestInviteRequestForDevice(requests, "same-user", "missing-device"), null);
  assert.equal(newestInviteRequestForDevice(requests, undefined, "this-device"), null);
});

test("historical completed turns form a baseline and only a later completion advances setup", () => {
  const historical = [codexEvent("turn-old", "completed"), codexEvent("turn-running", "started")];
  const baseline = completedTurnIds(historical);
  assert.deepEqual([...baseline], ["turn-old"]);
  assert.equal(hasNewCompletedTurn(historical, baseline), false);
  assert.equal(hasNewCompletedTurn([...historical, codexEvent("turn-failed", "failed")], baseline), false);
  assert.equal(hasNewCompletedTurn([...historical, codexEvent("turn-new", "completed")], baseline), true);
});

function inviteRequest(
  requesterUserId: string,
  requesterDeviceId: string,
  status: InviteJoinRequest["status"]
): InviteJoinRequest {
  return {
    id: crypto.randomUUID(),
    inviteId: "invite",
    requester: "User",
    requesterUserId,
    requesterDeviceId,
    keyPackageId: "package",
    keyPackageHash: "hash",
    requestedAt: new Date().toISOString(),
    note: "request",
    status
  };
}

function codexEvent(turnId: string, status: CodexRoomEvent["status"]): CodexRoomEvent {
  return {
    eventType: "codex.turn",
    turnId,
    status,
    message: "event",
    model: "gpt-5",
    host: "Host",
    hostUserId: "host",
    createdAt: new Date().toISOString()
  };
}
