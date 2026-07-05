import type { CodexTurnSummary, RoomMode, RoomRecord } from "@multaiplayer/protocol";
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

export function shouldResetCodexApprovalForRoomModeChange(mode: keyof RoomMode): boolean {
  return mode === "code" || mode === "workspace" || mode === "browser";
}
