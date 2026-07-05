import assert from "node:assert/strict";
import test from "node:test";
import type { CodexTurnSummary, RoomRecord } from "@multaiplayer/protocol";
import { canApproveCodexTurn, isChatOnlyCodexTurn, shouldAutoApproveChatOnlyTurn } from "../src/lib/codexApproval";

const baseSummary: CodexTurnSummary = {
  messagesSinceLastCodex: 2,
  attachments: [],
  workspacePath: null,
  git: null,
  browserAccess: [],
  terminals: []
};

const room: RoomRecord = {
  id: "room-codex",
  teamId: "team-core",
  name: "Codex",
  projectPath: "/Users/maddie/project",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  mode: { chat: true, code: true, workspace: false, browser: false },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://github.com"],
  browserProfilePersistent: true,
  unread: 0
};

test("chat-only Codex turns are auto-approved for the active host", () => {
  assert.equal(isChatOnlyCodexTurn(baseSummary), true);
  assert.equal(shouldAutoApproveChatOnlyTurn(baseSummary, true), true);
});

test("chat-only Codex turns are not auto-approved for non-host members", () => {
  assert.equal(shouldAutoApproveChatOnlyTurn(baseSummary, false), false);
});

test("attachments require host approval", () => {
  const summary = {
    ...baseSummary,
    attachments: [{
      id: "att-1",
      name: "notes.md",
      type: "code",
      size: 120,
      storage: "inline" as const,
      contentIncluded: true
    }]
  };

  assert.equal(isChatOnlyCodexTurn(summary), false);
  assert.equal(shouldAutoApproveChatOnlyTurn(summary, true), false);
});

test("selected workspace path alone can still be chat-only", () => {
  const summary = { ...baseSummary, workspacePath: "/Users/maddie/project" };

  assert.equal(isChatOnlyCodexTurn(summary), true);
  assert.equal(shouldAutoApproveChatOnlyTurn(summary, true), true);
});

test("git context requires host approval", () => {
  const summary = {
    ...baseSummary,
    workspacePath: "/Users/maddie/project",
    git: {
      branch: "main",
      files: [],
      totalFiles: 0,
      truncated: false
    }
  };

  assert.equal(isChatOnlyCodexTurn(summary), false);
  assert.equal(shouldAutoApproveChatOnlyTurn(summary, true), false);
});

test("browser context requires host approval", () => {
  const summary = { ...baseSummary, browserAccess: ["https://github.com"] };

  assert.equal(isChatOnlyCodexTurn(summary), false);
  assert.equal(shouldAutoApproveChatOnlyTurn(summary, true), false);
});

test("terminal context requires host approval", () => {
  const summary = { ...baseSummary, terminals: ["dev server"] };

  assert.equal(isChatOnlyCodexTurn(summary), false);
  assert.equal(shouldAutoApproveChatOnlyTurn(summary, true), false);
});

test("Codex approval requires an unlocked active host but not workspace mode", () => {
  const host = { id: "github:maddie", name: "Maddie" };
  assert.equal(canApproveCodexTurn(room, host), true);
  assert.equal(canApproveCodexTurn(room, host, true), false);
  assert.equal(canApproveCodexTurn(room, { id: "github:peer", name: "Peer" }), false);
  assert.equal(canApproveCodexTurn({ ...room, mode: { ...room.mode, code: false } }, host), false);
  assert.equal(canApproveCodexTurn({ ...room, approvalPolicy: "never_host" }, host), false);
});
