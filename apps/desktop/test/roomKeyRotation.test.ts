import assert from "node:assert/strict";
import test from "node:test";
import {
  isRoomKeyRotationInFlight,
  roomKeyRotationInFlightMessage
} from "../src/lib/roomKeyRotation";

test("room key rotation in-flight guard is scoped to one room", () => {
  assert.equal(isRoomKeyRotationInFlight({ "room-a": true }, "room-a"), true);
  assert.equal(isRoomKeyRotationInFlight({ "room-a": true }, "room-b"), false);
  assert.equal(isRoomKeyRotationInFlight({ "room-a": false }, "room-a"), false);
  assert.equal(roomKeyRotationInFlightMessage(), "Room key rotation is already in progress.");
});
