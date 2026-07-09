import type { ApprovalDelegationPolicy, CodexTurnSummary, RoomMode, RoomRecord } from "@multaiplayer/protocol";
import { isLocalUserActiveHostForRoom, type LocalHostUser } from "./roomHost";
import type { CodexTurnRiskFlag } from "./codexTurn";

export function isChatOnlyCodexTurn(summary: CodexTurnSummary): boolean {
  return (
    summary.attachments.length === 0 &&
    summary.git === null &&
    summary.browserAccess.length === 0 &&
    summary.terminals.length === 0
  );
}

export function shouldAutoApproveChatOnlyTurn(
  summary: CodexTurnSummary,
  activeHost: boolean,
  riskFlags: readonly CodexTurnRiskFlag[] = []
): boolean {
  void summary;
  void activeHost;
  void riskFlags;
  return false;
}

export function canApproveCodexTurn(room: RoomRecord, user: LocalHostUser, locked = false): boolean {
  return (
    !locked &&
    room.approvalPolicy !== "never_host" &&
    isLocalUserActiveHostForRoom(room, user)
  );
}

export function canDelegateApproveCodexTurn(room: RoomRecord, user: LocalHostUser, locked = false): boolean {
  void room;
  void user;
  void locked;
  return false;
}

export function canUserApprovalAuthorizeHostExecution(room: RoomRecord, approverUserId: string): boolean {
  void room;
  void approverUserId;
  return false;
}

export function isDelegatedApprovalExecutionPolicy(policy: ApprovalDelegationPolicy): policy is "members_can_approve" | "trusted_members_only" {
  return policy === "members_can_approve" || policy === "trusted_members_only";
}

export function shouldResetCodexApprovalForRoomModeChange(mode: keyof RoomMode): boolean {
  void mode;
  return false;
}

export function shouldResetCodexApprovalForRoomUpdate(previous: RoomRecord, next: RoomRecord): boolean {
  return (
    previous.projectPath !== next.projectPath ||
    previous.codexModel !== next.codexModel ||
    previous.codexReasoningEffort !== next.codexReasoningEffort ||
    previous.codexSpeed !== next.codexSpeed ||
    previous.approvalPolicy !== next.approvalPolicy ||
    previous.approvalDelegationPolicy !== next.approvalDelegationPolicy ||
    !sameStrings(previous.trustedApproverUserIds ?? [], next.trustedApproverUserIds ?? []) ||
    previous.browserProfilePersistent !== next.browserProfilePersistent ||
    !sameStrings(previous.browserAllowedOrigins ?? [], next.browserAllowedOrigins ?? [])
  );
}

function sameStrings(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
