import assert from "node:assert/strict";
import test from "node:test";
import {
  canActOnRoomInviteRequest,
  findRoomInviteRequest,
  roomInviteRequestMessage
} from "../src/lib/invite/inviteApproval";

const request = {
  id: "invite-request-1",
  requester: "Peer",
  requesterUserId: "github:peer",
  requesterDeviceId: "device-peer",
  requestedAt: "2026-07-04T12:00:00.000Z",
  status: "pending" as const
};

test("invite request decisions require a pending request from the current room list", () => {
  const requests = [request, { ...request, id: "invite-request-2", status: "approved" as const }];

  assert.deepEqual(findRoomInviteRequest(requests, request.id), request);
  assert.equal(canActOnRoomInviteRequest(requests, request.id), true);
  assert.equal(canActOnRoomInviteRequest(requests, "invite-request-2"), false);
  assert.equal(canActOnRoomInviteRequest(requests, "missing"), false);
  assert.equal(roomInviteRequestMessage(requests, "invite-request-2"), "Invite request is approved, not pending.");
  assert.equal(roomInviteRequestMessage(requests, "missing"), "Invite request is no longer available in this room.");
});
