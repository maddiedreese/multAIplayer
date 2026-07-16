import { useEffect } from "react";
import { searchProjectFiles } from "../lib/platform/localBackend";
import { useAppStore } from "../store/appStore";

interface UseProjectFilesSearchOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string | null;
  selectedRoomProjectPath: string;
  fileQuery: string;
  localWorkspaceMessage: string;
}

export function useProjectFilesSearch({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedRoomProjectPath,
  fileQuery,
  localWorkspaceMessage
}: UseProjectFilesSearchOptions) {
  useEffect(() => {
    if (!hasSelectedRoom || !selectedRoomId) {
      return;
    }
    const roomId = selectedRoomId;
    if (!canReadLocalWorkspace) {
      const { setProjectFilesForRoom, setSelectedFileForRoom, setSelectedDiffForRoom, setFileMessageForRoom } =
        useAppStore.getState();
      setProjectFilesForRoom(roomId, []);
      setSelectedFileForRoom(roomId, null);
      setSelectedDiffForRoom(roomId, null);
      setFileMessageForRoom(roomId, localWorkspaceMessage);
      return;
    }
    let cancelled = false;
    searchProjectFiles(selectedRoomProjectPath, fileQuery, 80)
      .then((files) => {
        if (cancelled) return;
        const { setProjectFilesForRoom, setFileMessageForRoom } = useAppStore.getState();
        setProjectFilesForRoom(roomId, files);
        setFileMessageForRoom(roomId, null);
      })
      .catch((error) => {
        if (!cancelled) useAppStore.getState().setFileMessageForRoom(roomId, String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [
    canReadLocalWorkspace,
    fileQuery,
    hasSelectedRoom,
    localWorkspaceMessage,
    selectedRoomId,
    selectedRoomProjectPath
  ]);
}
