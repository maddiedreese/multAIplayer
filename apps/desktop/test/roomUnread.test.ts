import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import {
  applyLocalRoomReadState,
  hideUnreadForLockedRooms,
  localRoomReadStateForHistory,
  markRoomRead,
  markRoomUnreadForIncomingChat,
  replaceRoomPreservingUnread,
  sanitizeLocalRoomReadState,
  upsertRoomPreservingUnread
} from "../src/lib/history/roomUnread";

const room: ClientRoomRecord = {
  id: "room-a",
  teamId: "team-a",
  name: "Alpha",
  projectPath: "/tmp/alpha",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: false },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://github.com"],
  browserProfilePersistent: true,
  unread: 2
};

test("markRoomRead clears only the selected room unread count", () => {
  const rooms = markRoomRead([room, { ...room, id: "room-b", unread: 3 }], "room-a");

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

test("replaceRoomPreservingUnread keeps local unread on existing room replacement", () => {
  const updated = replaceRoomPreservingUnread([room], { ...room, name: "Renamed", unread: 0 });

  assert.equal(updated[0].name, "Renamed");
  assert.equal(updated[0].unread, 2);
});

test("replaceRoomPreservingUnread does not append missing rooms", () => {
  const updated = replaceRoomPreservingUnread([room], { ...room, id: "room-b", name: "Beta", unread: 0 });

  assert.deepEqual(updated, [room]);
});

test("applyLocalRoomReadState restores encrypted local unread state", () => {
  const updated = applyLocalRoomReadState([room], "room-a", {
    lastReadMessageId: "message-a",
    unread: 4
  });

  assert.equal(updated[0].unread, 4);
});

test("hideUnreadForLockedRooms suppresses forgotten and revoked room badges", () => {
  const rooms = hideUnreadForLockedRooms(
    [
      room,
      { ...room, id: "room-b", teamId: "team-b", unread: 5 },
      { ...room, id: "room-c", teamId: "team-c", unread: 6 }
    ],
    new Set(["room-a"]),
    new Set(["room-b"]),
    new Set(["team-c"])
  );

  assert.deepEqual(
    rooms.map((item) => item.unread),
    [0, 0, 0]
  );
});

test("localRoomReadStateForHistory stores the last read id only when a room is read", () => {
  const messages = [
    { id: "message-a", author: "Avery", role: "human" as const, body: "one", time: "9:41" },
    { id: "message-b", author: "Jordan", role: "human" as const, body: "two", time: "9:42" }
  ];

  assert.deepEqual(localRoomReadStateForHistory({ ...room, unread: 0 }, messages), {
    lastReadMessageId: "message-b",
    unread: 0
  });
  assert.deepEqual(localRoomReadStateForHistory({ ...room, unread: 2 }, messages), {
    unread: 2
  });
});

test("sanitizeLocalRoomReadState bounds malformed unread state", () => {
  assert.deepEqual(sanitizeLocalRoomReadState({ lastReadMessageId: " message-a ", unread: 4000 }), {
    lastReadMessageId: "message-a",
    unread: 999
  });
  assert.deepEqual(sanitizeLocalRoomReadState({ unread: -2 }), { unread: 0 });
  assert.equal(sanitizeLocalRoomReadState(null), undefined);
});
