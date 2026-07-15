import assert from "node:assert/strict";
import test from "node:test";
import { shouldApplyRoomScopedUiUpdate } from "../src/lib/room/roomScopedUi";

test("shouldApplyRoomScopedUiUpdate allows only the originating room", () => {
  assert.equal(shouldApplyRoomScopedUiUpdate("room-a", "room-a"), true);
  assert.equal(shouldApplyRoomScopedUiUpdate("room-b", "room-a"), false);
});
