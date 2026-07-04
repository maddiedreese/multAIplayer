import assert from "node:assert/strict";
import test from "node:test";
import { isMembershipRemovedRelayError, membershipRemovedRoomMessage } from "../src/lib/relayAccess";

test("isMembershipRemovedRelayError detects relay membership revocation", () => {
  assert.equal(
    isMembershipRemovedRelayError("Your team membership was removed. Rejoin with a fresh invite before continuing."),
    true
  );
  assert.equal(isMembershipRemovedRelayError("Sign in and use a valid invite before joining this room."), false);
});

test("membershipRemovedRoomMessage names the affected room", () => {
  assert.equal(
    membershipRemovedRoomMessage("Desktop client"),
    "Access to Desktop client was removed on the relay. Rejoin with a fresh invite before continuing."
  );
});
