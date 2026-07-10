import { useEffect } from "react";
import { getGitStatus } from "../lib/localBackend";
import { useAppStore } from "../store/appStore";

interface UseRoomGitStatusRefreshOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string;
  selectedRoomProjectPath: string;
}

export function useRoomGitStatusRefresh({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedRoomProjectPath
}: UseRoomGitStatusRefreshOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) {
      return;
    }
    if (!canReadLocalWorkspace) {
      useAppStore.getState().setGitStatusForRoom(selectedRoomId, null);
      return;
    }
    useAppStore.getState().setGitStatusForRoom(selectedRoomId, null);
    getGitStatus(selectedRoomProjectPath)
      .then((status) => useAppStore.getState().setGitStatusForRoom(selectedRoomId, status))
      .catch((error) => {
        useAppStore.getState().setGitStatusForRoom(selectedRoomId, {
          branch: "unknown",
          files: [{ path: String(error), status: "error", added: 0, removed: 0 }]
        });
      });
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoomId, selectedRoomProjectPath]);
}
