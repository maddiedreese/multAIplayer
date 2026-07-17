import { defaultTestRoom } from "./support/workspaceFixtures";
import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { createCodexBrowserOpenCommand } from "../src/application/codex/codexBrowserOpenCommand";
import { buildRoomNotices } from "../src/hooks/roomNotices";
import { useAppStore } from "../src/store/appStore";

const room: ClientRoomRecord = {
  ...defaultTestRoom,
  id: "room-store-helpers",
  teamId: "team-store-helpers",
  name: "Store helpers",
  projectPath: "/tmp/store-helpers",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.4",
  unread: 0
};

test.beforeEach(() => {
  useAppStore.getState().resetAppStore();
});

test("room notice dismissals resolve store actions when invoked", () => {
  const store = useAppStore.getState();
  store.setHostMessageForRoom(room.id, "Host notice");
  store.setChatMessageForRoom(room.id, "Chat notice");

  const notices = buildRoomNotices({
    roomId: room.id,
    hostMessage: "Host notice",
    chatMessage: "Chat notice"
  });
  notices[0]?.onDismiss();
  notices[1]?.onDismiss();

  const state = useAppStore.getState();
  assert.equal(state.roomSettingsByRoom[room.id]?.hostMessage, undefined);
  assert.equal(state.roomChatByRoom[room.id]?.message, undefined);
});

test("local host Codex browser commands open directly", () => {
  const handleCommand = createCodexBrowserOpenCommand({
    localUser: { id: "github:maddie", name: "Maddie" },
    selectedRoomIdRef: { current: room.id },
    forgottenRoomIds: new Set(),
    revokedRoomIds: new Set(),
    revokedTeamIds: new Set(),
    defaultBrowserUrl: "https://default.example.com"
  });

  assert.equal(
    handleCommand(
      {
        id: "message-browser-open",
        author: "Codex",
        role: "codex",
        body: "@codex open docs.example.com/guide",
        time: "10:00"
      },
      room,
      { kind: "local_host" }
    ),
    true
  );

  const state = useAppStore.getState();
  assert.equal(state.browserByRoom[room.id]?.requests?.length, 1);
  assert.equal(state.browserByRoom[room.id]?.activeUrl, "http://docs.example.com/guide");
  assert.match(state.browserByRoom[room.id]?.message ?? "", /Opened in-room browser/);
  assert.equal(state.historyPresenceByRoom[room.id]?.inspectorTab, "browser");
});

test("incoming room Codex browser commands stay pending without navigation", () => {
  const handleCommand = createCodexBrowserOpenCommand({
    localUser: { id: "github:maddie", name: "Maddie" },
    selectedRoomIdRef: { current: room.id },
    forgottenRoomIds: new Set(),
    revokedRoomIds: new Set(),
    revokedTeamIds: new Set(),
    defaultBrowserUrl: "https://default.example.com"
  });

  assert.equal(
    handleCommand(
      {
        id: "message-remote-browser-open",
        author: "Rowan",
        authorUserId: "github:rowan",
        role: "human",
        body: "@codex open review.example/path",
        time: "10:01"
      },
      room,
      { kind: "incoming_room", senderUserId: "github:rowan" }
    ),
    true
  );

  const state = useAppStore.getState();
  const request = state.browserByRoom[room.id]?.requests?.[0];
  assert.equal(request?.status, "pending");
  assert.equal(request?.requester, "Rowan");
  assert.equal(request?.requesterUserId, "github:rowan");
  assert.equal(request?.url, "http://review.example/path");
  assert.equal(state.browserByRoom[room.id]?.activeUrl, undefined);
  assert.equal(state.browserByRoom[room.id]?.activeTabId, undefined);
  assert.equal(state.browserByRoom[room.id]?.url, undefined);
  assert.match(state.browserByRoom[room.id]?.message ?? "", /Rowan requested browser access/);
  assert.equal(state.historyPresenceByRoom[room.id]?.inspectorTab, "browser");
});
