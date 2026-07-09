import assert from "node:assert/strict";
import test from "node:test";
import type { CodexTurnSummary, RoomRecord } from "@multaiplayer/protocol";
import {
  canDelegateApproveCodexTurn,
  canUserApprovalAuthorizeHostExecution,
  canApproveCodexTurn,
  isChatOnlyCodexTurn,
  shouldAutoApproveChatOnlyTurn,
  shouldResetCodexApprovalForRoomModeChange,
  shouldResetCodexApprovalForRoomUpdate
} from "../src/lib/codexApproval";

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
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: false, browser: false },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: ["https://github.com"],
  browserProfilePersistent: true,
  unread: 0
};

test("chat-only Codex turns still require active-host approval", () => {
  assert.equal(isChatOnlyCodexTurn(baseSummary), true);
  assert.equal(shouldAutoApproveChatOnlyTurn(baseSummary, true), false);
});

test("chat-only Codex turns with risk flags fall back to host approval", () => {
  assert.equal(shouldAutoApproveChatOnlyTurn(baseSummary, true, [{
    id: "message-1:agent-directed",
    label: "message 1 (@Maddie) contains agent-directed phrasing",
    source: "message 1 (@Maddie)",
    risk: "Agent-directed phrasing",
    severity: "warning"
  }]), false);
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

test("selected workspace path alone can still be chat-only but not auto-approved", () => {
  const summary = { ...baseSummary, workspacePath: "/Users/maddie/project" };

  assert.equal(isChatOnlyCodexTurn(summary), true);
  assert.equal(shouldAutoApproveChatOnlyTurn(summary, true), false);
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

test("Codex approval requires an unlocked active host", () => {
  const host = { id: "github:maddie", name: "Maddie" };
  assert.equal(canApproveCodexTurn(room, host), true);
  assert.equal(canApproveCodexTurn(room, host, true), false);
  assert.equal(canApproveCodexTurn(room, { id: "github:peer", name: "Peer" }), false);
  assert.equal(canApproveCodexTurn({ ...room, mode: { ...room.mode, code: false } }, host), true);
  assert.equal(canApproveCodexTurn({ ...room, approvalPolicy: "never_host" }, host), false);
});

test("delegated Codex approvals do not authorize host execution", () => {
  const member = { id: "github:peer", name: "Peer" };
  assert.equal(canDelegateApproveCodexTurn(room, member), false);
  assert.equal(canUserApprovalAuthorizeHostExecution(room, member.id), false);

  const delegatedRoom = { ...room, approvalDelegationPolicy: "members_can_approve" as const };
  assert.equal(canApproveCodexTurn(delegatedRoom, member), false);
  assert.equal(canDelegateApproveCodexTurn(delegatedRoom, member), false);
  assert.equal(canUserApprovalAuthorizeHostExecution(delegatedRoom, member.id), false);
});

test("trusted-only delegated approvals still cannot authorize host execution", () => {
  const member = { id: "github:peer", name: "Peer" };
  const trustedRoom = {
    ...room,
    approvalDelegationPolicy: "trusted_members_only" as const,
    trustedApproverUserIds: [member.id]
  };
  const untrustedRoom = {
    ...trustedRoom,
    trustedApproverUserIds: ["github:other"]
  };

  assert.equal(canDelegateApproveCodexTurn(trustedRoom, member), false);
  assert.equal(canUserApprovalAuthorizeHostExecution(trustedRoom, member.id), false);
  assert.equal(canDelegateApproveCodexTurn(untrustedRoom, member), false);
  assert.equal(canUserApprovalAuthorizeHostExecution(untrustedRoom, member.id), false);
});

test("Codex approvals do not reset for compatibility room mode changes", () => {
  assert.equal(shouldResetCodexApprovalForRoomModeChange("code"), false);
  assert.equal(shouldResetCodexApprovalForRoomModeChange("workspace"), false);
  assert.equal(shouldResetCodexApprovalForRoomModeChange("browser"), false);
  assert.equal(shouldResetCodexApprovalForRoomModeChange("chat"), false);
});

test("Codex approvals reset when room execution context changes", () => {
  assert.equal(shouldResetCodexApprovalForRoomUpdate(room, { ...room, codexModel: "gpt-5.4-high" }), true);
  assert.equal(shouldResetCodexApprovalForRoomUpdate(room, { ...room, projectPath: "/Users/maddie/other-project" }), true);
  assert.equal(shouldResetCodexApprovalForRoomUpdate(room, { ...room, approvalPolicy: "auto_chat_only" }), true);
  assert.equal(shouldResetCodexApprovalForRoomUpdate(room, { ...room, approvalDelegationPolicy: "members_can_approve" }), true);
  assert.equal(shouldResetCodexApprovalForRoomUpdate(room, { ...room, trustedApproverUserIds: ["github:peer"] }), true);
  assert.equal(
    shouldResetCodexApprovalForRoomUpdate(room, { ...room, mode: { ...room.mode, workspace: true } }),
    false
  );
  assert.equal(
    shouldResetCodexApprovalForRoomUpdate(room, { ...room, browserAllowedOrigins: ["https://github.com", "https://docs.github.com"] }),
    true
  );
  assert.equal(
    shouldResetCodexApprovalForRoomUpdate(room, { ...room, browserProfilePersistent: false }),
    true
  );
  assert.equal(
    shouldResetCodexApprovalForRoomUpdate(room, { ...room, host: "Jordan", hostUserId: "github:jordan" }),
    false
  );
  assert.equal(
    shouldResetCodexApprovalForRoomUpdate(room, { ...room, hostStatus: "handoff" }),
    false
  );
  assert.equal(shouldResetCodexApprovalForRoomUpdate(room, { ...room, unread: 2 }), false);
});
