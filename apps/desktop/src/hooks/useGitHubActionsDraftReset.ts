import { useEffect } from "react";
import type { GitWorkflowDraft } from "../lib/gitWorkflowDraft";
import { useAppStore } from "../store/appStore";

interface UseGitHubActionsDraftResetOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
  gitWorkflowDraft: GitWorkflowDraft;
}

export function useGitHubActionsDraftReset({
  hasSelectedRoom,
  selectedRoomId,
  gitWorkflowDraft
}: UseGitHubActionsDraftResetOptions) {
  const resetGitHubActionsStateForRoom = useAppStore((state) => state.resetGitHubActionsStateForRoom);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    resetGitHubActionsStateForRoom(selectedRoomId);
  }, [
    gitWorkflowDraft.branchName,
    gitWorkflowDraft.prOwner,
    gitWorkflowDraft.prRepo,
    hasSelectedRoom,
    selectedRoomId,
    resetGitHubActionsStateForRoom
  ]);
}
