import { useEffect } from "react";
import { getGitStatus } from "../lib/platform/localBackend";
import { useAppStore } from "../store/appStore";

interface UseRoomGitStatusRefreshOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string | null;
  selectedRoomProjectPath: string;
}

export function useRoomGitStatusRefresh({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedRoomProjectPath
}: UseRoomGitStatusRefreshOptions) {
  useEffect(() => {
    if (!hasSelectedRoom || !selectedRoomId) {
      return;
    }
    if (!canReadLocalWorkspace) {
      useAppStore.getState().setGitStatusForRoom(selectedRoomId, null);
      return;
    }
    let cancelled = false;
    useAppStore.getState().setGitStatusForRoom(selectedRoomId, null);
    getGitStatus(selectedRoomProjectPath)
      .then((status) => {
        if (!cancelled) useAppStore.getState().setGitStatusForRoom(selectedRoomId, status);
      })
      .catch(() => {
        if (cancelled) return;
        const state = useAppStore.getState();
        state.setGitStatusForRoom(selectedRoomId, null);
        state.setGitWorkflowMessageForRoom(
          selectedRoomId,
          "Git status could not be loaded. Check that the attached project is a readable Git workspace."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [canReadLocalWorkspace, hasSelectedRoom, selectedRoomId, selectedRoomProjectPath]);
}
