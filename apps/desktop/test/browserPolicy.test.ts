import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import {
  browserAccessGateMessage,
  canActOnRoomBrowserRequest,
  canHostBrowserAction,
  canRequestBrowserAccess,
  findRoomBrowserRequest,
  isBrowserUrlAllowed,
  normalizeBrowserAllowedOrigins,
  roomBrowserRequestMessage,
  shouldAutoApproveBrowserRequest,
  shouldAutoApproveBrowserRequestLegacy
} from "../src/lib/browserPolicy";

const room: RoomRecord = {
  id: "room-browser",
  teamId: "team-alpha",
  name: "Browser",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddiedreese",
  hostStatus: "active",
  approvalPolicy: "auto_browser_allowed_sites",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://docs.example.com", "https://github.com"],
  browserProfilePersistent: true,
  unread: 0
};

test("normalizeBrowserAllowedOrigins accepts only bare http(s) origins", () => {
  assert.deepEqual(
    normalizeBrowserAllowedOrigins(" https://docs.example.com/path , https://github.com "),
    null
  );
  assert.deepEqual(
    normalizeBrowserAllowedOrigins("https://docs.example.com, https://github.com/"),
    ["https://docs.example.com", "https://github.com"]
  );
  assert.deepEqual(normalizeBrowserAllowedOrigins("file:///tmp"), null);
});

test("isBrowserUrlAllowed matches approved origins", () => {
  assert.equal(isBrowserUrlAllowed("https://docs.example.com/guide?query=1", ["https://docs.example.com"]), true);
  assert.equal(isBrowserUrlAllowed("https://evil.example.com/guide", ["https://docs.example.com"]), false);
  assert.equal(isBrowserUrlAllowed("not a url", ["https://docs.example.com"]), false);
});

test("shouldAutoApproveBrowserRequest no longer auto-approves browser pages", () => {
  assert.equal(shouldAutoApproveBrowserRequest("https://docs.example.com/guide", room, true), false);
  assert.equal(shouldAutoApproveBrowserRequest("https://github.com/maddiedreese/multAIplayer", room, true), false);
  assert.equal(shouldAutoApproveBrowserRequest("https://docs.example.com/account/security", room, true), false);
});

test("legacy browser auto-approval helper keeps old records conservative", () => {
  assert.equal(shouldAutoApproveBrowserRequestLegacy("https://docs.example.com/guide", room, true), true);
  assert.equal(shouldAutoApproveBrowserRequestLegacy("https://github.com/maddiedreese/multAIplayer", room, true), false);
  assert.equal(shouldAutoApproveBrowserRequestLegacy("https://docs.example.com/account/security", room, true), false);
  assert.equal(shouldAutoApproveBrowserRequestLegacy("https://docs.example.com/guide", { ...room, approvalPolicy: "ask_every_turn" }, true), false);
  assert.equal(shouldAutoApproveBrowserRequestLegacy("https://docs.example.com/guide", room, false), false);
});

test("browser access requests require an unlocked room", () => {
  assert.equal(canRequestBrowserAccess(room), true);
  assert.equal(canRequestBrowserAccess({ ...room, mode: { ...room.mode, browser: false } }), true);
  assert.equal(canRequestBrowserAccess(room, true), false);
});

test("browser host actions require active host access", () => {
  assert.equal(canHostBrowserAction(room, { id: "github:maddiedreese", name: "Maddie" }), true);
  assert.equal(canHostBrowserAction(room, { id: "github:peer", name: "Peer" }), false);
  assert.equal(canHostBrowserAction({ ...room, hostStatus: "offline" }, { id: "github:maddiedreese", name: "Maddie" }), false);
  assert.equal(canHostBrowserAction(room, { id: "github:maddiedreese", name: "Maddie" }, true), false);
});

test("browser access gate messages explain missing browser access", () => {
  assert.equal(browserAccessGateMessage(room, true), "Unlock this room before using browser access.");
  assert.equal(browserAccessGateMessage({ ...room, mode: { ...room.mode, browser: false } }), "Browser access is available for this room.");
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
  assert.equal(
    roomBrowserRequestMessage(requests, "missing"),
    "Browser request is no longer available in this room."
  );
});
