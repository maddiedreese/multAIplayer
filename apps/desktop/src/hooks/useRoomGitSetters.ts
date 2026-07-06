import type { Dispatch, SetStateAction } from "react";
import type { GitStatusSummary } from "../lib/localBackend";

interface UseRoomGitSettersOptions {
  selectedRoomId: string;
  setGitWorkflowMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setGitStatusByRoom: Dispatch<SetStateAction<Record<string, GitStatusSummary | null>>>;
}

export function useRoomGitSetters({
  selectedRoomId,
  setGitWorkflowMessagesByRoom,
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

  return {
    setGitWorkflowMessageForRoom,
    setSelectedGitWorkflowMessage,
    setGitStatusForRoom
  };
}
