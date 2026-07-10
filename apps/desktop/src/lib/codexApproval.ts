import type { RoomRecord } from "@multaiplayer/protocol";
import { isLocalUserActiveHostForRoom, type LocalHostUser } from "./roomHost";

export function canApproveCodexTurn(room: RoomRecord, user: LocalHostUser, locked = false): boolean {
  return (
    !locked &&
    room.approvalPolicy !== "never_host" &&
    isLocalUserActiveHostForRoom(room, user)
  );
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
