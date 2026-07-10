import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import {
  canApproveCodexTurn,
  shouldResetCodexApprovalForRoomUpdate
} from "../src/lib/codexApproval";

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

test("Codex approval requires an unlocked active host", () => {
  const host = { id: "github:maddie", name: "Maddie" };
  assert.equal(canApproveCodexTurn(room, host), true);
  assert.equal(canApproveCodexTurn(room, host, true), false);
  assert.equal(canApproveCodexTurn(room, { id: "github:peer", name: "Peer" }), false);
  assert.equal(canApproveCodexTurn({ ...room, mode: { ...room.mode, code: false } }, host), true);
  assert.equal(canApproveCodexTurn({ ...room, approvalPolicy: "never_host" }, host), false);
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
