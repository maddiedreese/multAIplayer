import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { createInviteRelayActions } from "../src/hooks/inviteRelayActions";
import type { InviteJoinRequest } from "../src/types";

const room: RoomRecord = {
  id: "room-invite",
  teamId: "team-alpha",
  name: "Invite",
  projectPath: "/tmp/project",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  unread: 0
};

function setup(overrides: Record<string, unknown> = {}) {
  const appended: InviteJoinRequest[] = [];
  const statusUpdates: Array<{ requestId: string; status: InviteJoinRequest["status"] }> = [];
  const roomMessages: Array<string | null> = [];
  const selectedMessages: Array<string | null> = [];
  const actions = createInviteRelayActions({
    appendInviteRequest: (_roomId, request) => appended.push(request),
    deviceId: "device-local",
    deviceIdentity: null,
    hasSelectedRoom: true,
    hostGateMessage: "Only the host can decide.",
    inviteRequests: [],
    isActiveHost: true,
    isSelectedRoomLocked: false,
    isSelectedRoomRevoked: false,
    localUser: { id: "github:maddie", name: "Maddie" },
    relayRef: { current: null },
    relayStatus: "closed",
    rememberForgottenRoom: () => undefined,
    restoreForgottenRoom: () => undefined,
    seenEnvelopeIds: { current: new Set<string>() },
    selectedRoom: room,
    selectedRoomIdRef: { current: room.id },
    setInviteMessageForRoom: (_roomId, message) => roomMessages.push(message),
    setSelectedInviteMessage: (message) => selectedMessages.push(message),
    updateInviteRequestStatus: (_roomId, requestId, status) => statusUpdates.push({ requestId, status }),
    ...overrides
  });
  return { actions, appended, roomMessages, selectedMessages, statusUpdates };
}

test("relay invite actions normalize incoming join requests as pending", async () => {
  const { actions, appended } = setup();

  await actions.handleInviteEnvelopePlaintext(room.id, {
    eventType: "invite.request",
    id: "request-1",
    requester: "Peer",
    requesterUserId: "github:peer",
    requesterDeviceId: "device-peer",
    requestedAt: "2026-07-09T12:00:00.000Z"
  });

  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.status, "pending");
});

test("status events always update state but only update UI for this device", async () => {
  const { actions, roomMessages, statusUpdates } = setup();
  const status = {
    eventType: "invite.status",
    requestId: "device-peer:request-1",
    status: "denied",
    decidedBy: "Maddie",
    decidedByUserId: "github:maddie",
    decidedAt: "2026-07-09T12:01:00.000Z"
  } as const;

  await actions.handleInviteEnvelopePlaintext(room.id, status);

  assert.deepEqual(statusUpdates, [{ requestId: status.requestId, status: "denied" }]);
  assert.deepEqual(roomMessages, []);
});

test("decision guards preserve the selected-room user message", async () => {
  const { actions, selectedMessages } = setup({ hasSelectedRoom: false });
  const request: InviteJoinRequest = {
    eventType: "invite.request",
    id: "request-1",
    requester: "Peer",
    requesterUserId: "github:peer",
    requesterDeviceId: "device-peer",
    requestedAt: "2026-07-09T12:00:00.000Z",
    status: "pending"
  };

  await actions.decideInviteJoinRequest(request, "approved");

  assert.deepEqual(selectedMessages, ["Create or join a room before deciding invite requests."]);
});
