import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import {
  browserAccessGateMessage,
  canActOnRoomBrowserRequest,
  canHostBrowserAction,
  canRequestBrowserAccess,
  findRoomBrowserRequest,
  roomBrowserRequestMessage
} from "../src/lib/browser/browserPolicy";

const room: ClientRoomRecord = {
  id: "room-browser",
  teamId: "team-alpha",
  name: "Browser",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.4",
  unread: 0
};

test("browser access requests require an unlocked room", () => {
  assert.equal(canRequestBrowserAccess(room), true);
  assert.equal(canRequestBrowserAccess(room, true), false);
});

test("browser host actions require active host access", () => {
  assert.equal(canHostBrowserAction(room, { id: "github:maddiedreese", name: "Maddie" }), true);
  assert.equal(canHostBrowserAction(room, { id: "github:peer", name: "Peer" }), false);
  assert.equal(
    canHostBrowserAction({ ...room, hostStatus: "offline" }, { id: "github:maddiedreese", name: "Maddie" }),
    false
  );
  assert.equal(canHostBrowserAction(room, { id: "github:maddiedreese", name: "Maddie" }, true), false);
});

test("browser access gate messages explain missing browser access", () => {
  assert.equal(browserAccessGateMessage(room, true), "Unlock this room before using browser access.");
  assert.equal(browserAccessGateMessage(room), "Browser access is available for this room.");
});

test("browser request actions require a request from the current room list", () => {
  const requests = [
    { id: "request-1", status: "pending" as const },
    { id: "request-2", status: "approved" as const }
  ];

  assert.deepEqual(findRoomBrowserRequest(requests, "request-1"), requests[0]);
  assert.equal(canActOnRoomBrowserRequest(requests, "request-1", "pending"), true);
  assert.equal(canActOnRoomBrowserRequest(requests, "request-1", "approved"), false);
  assert.equal(canActOnRoomBrowserRequest(requests, "missing", "pending"), false);
  assert.equal(
    roomBrowserRequestMessage(requests, "request-1", "approved"),
    "Browser request is pending, not approved."
  );
  assert.equal(roomBrowserRequestMessage(requests, "missing"), "Browser request is no longer available in this room.");
});
