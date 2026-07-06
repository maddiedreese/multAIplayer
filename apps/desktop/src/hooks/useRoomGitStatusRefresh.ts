import { useEffect } from "react";
import { getGitStatus, type GitStatusSummary } from "../lib/localBackend";

interface UseRoomGitStatusRefreshOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string;
  selectedRoomProjectPath: string;
  setGitStatusForRoom: (roomId: string, status: GitStatusSummary | null) => void;
}

export function useRoomGitStatusRefresh({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedRoomProjectPath,
  setGitStatusForRoom
}: UseRoomGitStatusRefreshOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) {
      return;
    }
    if (!canReadLocalWorkspace) {
      setGitStatusForRoom(selectedRoomId, null);
      return;
    }
    setGitStatusForRoom(selectedRoomId, null);
    getGitStatus(selectedRoomProjectPath)
      .then((status) => setGitStatusForRoom(selectedRoomId, status))
      .catch((error) => {
        setGitStatusForRoom(selectedRoomId, {
          branch: "unknown",
          files: [{ path: String(error), status: "error", added: 0, removed: 0 }]
        });
      });
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoomId, selectedRoomProjectPath]);
}
