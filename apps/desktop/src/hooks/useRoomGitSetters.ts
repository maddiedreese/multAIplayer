import type { Dispatch, SetStateAction } from "react";
import {
  updateGitWorkflowDraftRecord,
  type GitWorkflowDraft
} from "../lib/gitWorkflowDraft";
import type { GitStatusSummary } from "../lib/localBackend";

interface UseRoomGitSettersOptions {
  selectedRoomId: string;
  hasSelectedRoom: boolean;
  setGitWorkflowMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setGitWorkflowDraftsByRoom: Dispatch<SetStateAction<Record<string, Partial<GitWorkflowDraft>>>>;
  setGitStatusByRoom: Dispatch<SetStateAction<Record<string, GitStatusSummary | null>>>;
}

export function useRoomGitSetters({
  selectedRoomId,
  hasSelectedRoom,
  setGitWorkflowMessagesByRoom,
  setGitWorkflowDraftsByRoom,
  setGitStatusByRoom
}: UseRoomGitSettersOptions) {
  function setGitWorkflowMessageForRoom(roomId: string, message: string | null) {
    setGitWorkflowMessagesByRoom((current) => ({
      ...current,
      [roomId]: message
    }));
  }

  function setSelectedGitWorkflowMessage(message: string | null) {
    setGitWorkflowMessageForRoom(selectedRoomId, message);
  }

  function setGitStatusForRoom(roomId: string, status: GitStatusSummary | null) {
    setGitStatusByRoom((current) => ({
      ...current,
      [roomId]: status
    }));
  }

  function updateSelectedGitWorkflowDraft(patch: Partial<GitWorkflowDraft>) {
    if (!hasSelectedRoom) return;
    setGitWorkflowDraftsByRoom((current) => updateGitWorkflowDraftRecord(current, selectedRoomId, patch));
  }

  return {
    setGitWorkflowMessageForRoom,
    setSelectedGitWorkflowMessage,
    setGitStatusForRoom,
    updateSelectedGitWorkflowDraft
  };
}
