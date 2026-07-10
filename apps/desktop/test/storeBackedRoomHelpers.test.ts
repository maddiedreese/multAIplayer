import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import { createCodexBrowserOpenCommand } from "../src/lib/codexBrowserOpenCommand";
import { buildRoomNotices } from "../src/lib/roomNotices";
import { useAppStore } from "../src/store/appStore";

const room: RoomRecord = {
  id: "room-store-helpers",
  teamId: "team-store-helpers",
  name: "Store helpers",
  projectPath: "/tmp/store-helpers",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://docs.example.com"],
  browserProfilePersistent: true,
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

test("Codex browser open commands write directly to the room store", () => {
  const handleCommand = createCodexBrowserOpenCommand({
    localUser: { id: "github:maddie", name: "Maddie" },
    selectedRoomIdRef: { current: room.id },
    forgottenRoomIds: new Set(),
    revokedRoomIds: new Set(),
    revokedTeamIds: new Set(),
    defaultBrowserUrl: "https://default.example.com"
  });

  assert.equal(handleCommand({
    id: "message-browser-open",
    author: "Codex",
    role: "codex",
    body: "@codex open docs.example.com/guide",
    time: "10:00"
  }, room), true);

  const state = useAppStore.getState();
  assert.equal(state.browserByRoom[room.id]?.requests?.length, 1);
  assert.equal(state.browserByRoom[room.id]?.activeUrl, "http://docs.example.com/guide");
  assert.match(state.browserByRoom[room.id]?.message ?? "", /Opened in-room browser/);
  assert.equal(state.historyPresenceByRoom[room.id]?.inspectorTab, "browser");
});
