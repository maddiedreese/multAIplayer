import type { CodexTurnSummary } from "@multaiplayer/protocol";

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
