import assert from "node:assert/strict";
import test from "node:test";
import { buildRoomNotices, isActionableRoomNotice } from "../src/hooks/roomNotices";

test("routine room status does not become a global toast", () => {
  assert.equal(isActionableRoomNotice("You are hosting Tiny Quest Live."), false);
  assert.equal(isActionableRoomNotice("Codex model set to GPT-5.6 Sol."), false);
  assert.deepEqual(
    buildRoomNotices({
      roomId: "room-one",
      hostMessage: "You are hosting Tiny Quest Live.",
      chatMessage: "Shared local preview: https://example.test"
    }),
    []
  );
});

test("warnings, bugs, and required user action remain visible", () => {
  const notices = buildRoomNotices({
    roomId: "room-one",
    hostMessage: "Security warning: rejoin this room if the warning persists.",
    chatMessage: "The relay is not connected."
  });
  assert.equal(notices.length, 2);
  assert.match(notices[0]?.message ?? "", /warning/i);
  assert.match(notices[1]?.message ?? "", /not connected/i);
});
