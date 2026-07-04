import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import {
  isBrowserUrlAllowed,
  normalizeBrowserAllowedOrigins,
  shouldAutoApproveBrowserRequest
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
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://docs.example.com", "https://github.com"],
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

test("shouldAutoApproveBrowserRequest refuses signed-in and credential-risk pages", () => {
  assert.equal(shouldAutoApproveBrowserRequest("https://docs.example.com/guide", room, true), true);
  assert.equal(shouldAutoApproveBrowserRequest("https://github.com/maddiedreese/multAIplayer", room, true), false);
  assert.equal(shouldAutoApproveBrowserRequest("https://docs.example.com/account/security", room, true), false);
  assert.equal(shouldAutoApproveBrowserRequest("https://docs.example.com/guide", { ...room, approvalPolicy: "ask_every_turn" }, true), false);
  assert.equal(shouldAutoApproveBrowserRequest("https://docs.example.com/guide", room, false), false);
});
