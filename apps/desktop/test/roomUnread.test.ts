import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { markRoomRead, markRoomUnreadForIncomingChat, upsertRoomPreservingUnread } from "../src/lib/roomUnread";

const room: RoomRecord = {
  id: "room-a",
  teamId: "team-a",
  name: "Alpha",
  projectPath: "/tmp/alpha",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  mode: { chat: true, code: true, workspace: true, browser: false },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://github.com"],
  browserProfilePersistent: true,
  unread: 2
};

test("markRoomRead clears only the selected room unread count", () => {
  const rooms = markRoomRead([
    room,
    { ...room, id: "room-b", unread: 3 }
  ], "room-a");

  assert.equal(rooms[0].unread, 0);
  assert.equal(rooms[1].unread, 3);
});

test("markRoomUnreadForIncomingChat increments inactive rooms only", () => {
  const rooms = [{ ...room, unread: 0 }];

  assert.equal(markRoomUnreadForIncomingChat(rooms, "room-a", "room-b", "remote-device", "local-device")[0].unread, 1);
  assert.equal(markRoomUnreadForIncomingChat(rooms, "room-a", "room-a", "remote-device", "local-device")[0].unread, 0);
  assert.equal(markRoomUnreadForIncomingChat(rooms, "room-a", "room-b", "local-device", "local-device")[0].unread, 0);
});

test("upsertRoomPreservingUnread keeps local unread on room updates", () => {
  const updated = upsertRoomPreservingUnread([room], { ...room, name: "Renamed", unread: 0 });

  assert.equal(updated[0].name, "Renamed");
  assert.equal(updated[0].unread, 2);
});
