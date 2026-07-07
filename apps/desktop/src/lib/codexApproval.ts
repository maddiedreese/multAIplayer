import type { ApprovalDelegationPolicy, CodexTurnSummary, RoomMode, RoomRecord } from "@multaiplayer/protocol";
import { isLocalUserActiveHostForRoom, type LocalHostUser } from "./roomHost";

export function isChatOnlyCodexTurn(summary: CodexTurnSummary): boolean {
  return (
    summary.attachments.length === 0 &&
    summary.git === null &&
    summary.browserAccess.length === 0 &&
    summary.terminals.length === 0
  );
}

export function shouldAutoApproveChatOnlyTurn(summary: CodexTurnSummary, activeHost: boolean): boolean {
  return activeHost && isChatOnlyCodexTurn(summary);
}

export function canApproveCodexTurn(room: RoomRecord, user: LocalHostUser, locked = false): boolean {
  return (
    !locked &&
    room.mode.code &&
    room.approvalPolicy !== "never_host" &&
    isLocalUserActiveHostForRoom(room, user)
  );
}

export function canDelegateApproveCodexTurn(room: RoomRecord, user: LocalHostUser, locked = false): boolean {
  if (
    locked ||
    !room.mode.code ||
    room.approvalPolicy === "never_host" ||
    isLocalUserActiveHostForRoom(room, user)
  ) {
    return false;
  }
  if (room.approvalDelegationPolicy === "members_can_approve") return true;
  if (room.approvalDelegationPolicy === "trusted_members_only") {
    return (room.trustedApproverUserIds ?? []).includes(user.id);
  }
  return false;
}

export function canUserApprovalAuthorizeHostExecution(room: RoomRecord, approverUserId: string): boolean {
  if (!room.mode.code || room.approvalPolicy === "never_host") return false;
  if (room.approvalDelegationPolicy === "members_can_approve") return true;
  if (room.approvalDelegationPolicy === "trusted_members_only") {
    return (room.trustedApproverUserIds ?? []).includes(approverUserId);
  }
  return false;
}

export function isDelegatedApprovalExecutionPolicy(policy: ApprovalDelegationPolicy): policy is "members_can_approve" | "trusted_members_only" {
  return policy === "members_can_approve" || policy === "trusted_members_only";
}

export function shouldResetCodexApprovalForRoomModeChange(mode: keyof RoomMode): boolean {
  return mode === "code" || mode === "workspace" || mode === "browser";
}

export function shouldResetCodexApprovalForRoomUpdate(previous: RoomRecord, next: RoomRecord): boolean {
  return (
    previous.projectPath !== next.projectPath ||
    previous.codexModel !== next.codexModel ||
    previous.approvalPolicy !== next.approvalPolicy ||
    previous.approvalDelegationPolicy !== next.approvalDelegationPolicy ||
    !sameStrings(previous.trustedApproverUserIds ?? [], next.trustedApproverUserIds ?? []) ||
    previous.hostStatus !== next.hostStatus ||
    previous.hostUserId !== next.hostUserId ||
    previous.mode.code !== next.mode.code ||
    previous.mode.workspace !== next.mode.workspace ||
    previous.mode.browser !== next.mode.browser ||
    previous.browserProfilePersistent !== next.browserProfilePersistent ||
    !sameStrings(previous.browserAllowedOrigins ?? [], next.browserAllowedOrigins ?? [])
  );
}

function sameStrings(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
