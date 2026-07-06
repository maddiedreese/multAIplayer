import { useEffect, type Dispatch, type SetStateAction } from "react";
import { omitRecordKey } from "../lib/setUtils";
import type { GitWorkflowDraft } from "../lib/gitWorkflowDraft";
import type { GitHubActionRun } from "../lib/authClient";

interface UseGitHubActionsDraftResetOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
  gitWorkflowDraft: GitWorkflowDraft;
  setActionRunsByRoom: Dispatch<SetStateAction<Record<string, GitHubActionRun[]>>>;
  setActionsLastCheckedByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setActionsMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setActionsBusyByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export function useGitHubActionsDraftReset({
  hasSelectedRoom,
  selectedRoomId,
  gitWorkflowDraft,
  setActionRunsByRoom,
  setActionsLastCheckedByRoom,
  setActionsMessagesByRoom,
  setActionsBusyByRoom
}: UseGitHubActionsDraftResetOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) return;
    setActionRunsByRoom((current) => ({
      ...current,
      [selectedRoomId]: []
    }));
    setActionsLastCheckedByRoom((current) => omitRecordKey(current, selectedRoomId));
    setActionsMessagesByRoom((current) => omitRecordKey(current, selectedRoomId));
    setActionsBusyByRoom((current) => omitRecordKey(current, selectedRoomId));
  }, [
    gitWorkflowDraft.branchName,
    gitWorkflowDraft.prOwner,
    gitWorkflowDraft.prRepo,
    hasSelectedRoom,
    selectedRoomId,
    setActionRunsByRoom,
    setActionsBusyByRoom,
    setActionsLastCheckedByRoom,
    setActionsMessagesByRoom
  ]);
}
