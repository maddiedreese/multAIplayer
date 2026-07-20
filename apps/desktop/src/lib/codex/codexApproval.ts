import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { isLocalUserActiveHostForRoom, type LocalHostUser } from "../access/roomHost";

export function canApproveCodexTurn(
  room: ClientRoomRecord,
  user: LocalHostUser,
  deviceId: string,
  locked = false
): boolean {
  return !locked && room.approvalPolicy !== "never_host" && isLocalUserActiveHostForRoom(room, user, deviceId);
}

export function shouldResetCodexApprovalForRoomUpdate(previous: ClientRoomRecord, next: ClientRoomRecord): boolean {
  return (
    previous.projectPath !== next.projectPath ||
    previous.codexModel !== next.codexModel ||
    previous.codexReasoningEffort !== next.codexReasoningEffort ||
    previous.codexSpeed !== next.codexSpeed ||
    previous.approvalPolicy !== next.approvalPolicy
  );
}
