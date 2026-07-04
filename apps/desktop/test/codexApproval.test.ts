import assert from "node:assert/strict";
import test from "node:test";
import type { CodexTurnSummary } from "@multaiplayer/protocol";
import { isChatOnlyCodexTurn, shouldAutoApproveChatOnlyTurn } from "../src/lib/codexApproval";

const baseSummary: CodexTurnSummary = {
  messagesSinceLastCodex: 2,
  attachments: [],
  workspacePath: null,
  git: null,
  browserAccess: [],
  terminals: []
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

test("workspace context requires host approval", () => {
  const summary = { ...baseSummary, workspacePath: "/Users/maddie/project" };

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
