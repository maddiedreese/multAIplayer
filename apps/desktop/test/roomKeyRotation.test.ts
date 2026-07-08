import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import {
  isRoomKeyRotationEnvelopeAuthorized,
  isRoomKeyRotationInFlight,
  roomKeyRotationInFlightMessage
} from "../src/lib/roomKeyRotation";

const activeRoom: RoomRecord = {
  id: "room-alpha",
  teamId: "team-alpha",
  name: "Alpha",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
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

test("room key rotation in-flight guard is scoped to one room", () => {
  assert.equal(isRoomKeyRotationInFlight({ "room-a": true }, "room-a"), true);
  assert.equal(isRoomKeyRotationInFlight({ "room-a": true }, "room-b"), false);
  assert.equal(isRoomKeyRotationInFlight({ "room-a": false }, "room-a"), false);
  assert.equal(roomKeyRotationInFlightMessage(), "Room key rotation is already in progress.");
});

test("room key rotation envelope must come from the active host", () => {
  assert.equal(
    isRoomKeyRotationEnvelopeAuthorized(
      activeRoom,
      { senderUserId: "github:maddiedreese" },
      { rotatedByUserId: "github:maddiedreese" }
    ),
    true
  );
  assert.equal(
    isRoomKeyRotationEnvelopeAuthorized(
      activeRoom,
      { senderUserId: "github:member" },
      { rotatedByUserId: "github:member" }
    ),
    false
  );
  assert.equal(
    isRoomKeyRotationEnvelopeAuthorized(
      activeRoom,
      { senderUserId: "github:maddiedreese" },
      { rotatedByUserId: "github:member" }
    ),
    false
  );
});
