import { useEffect } from "react";
import {
  searchProjectFiles,
  type GitDiffResult,
  type ProjectFileContent,
  type ProjectFileEntry
} from "../lib/localBackend";

interface UseProjectFilesSearchOptions {
  hasSelectedRoom: boolean;
  canReadLocalWorkspace: boolean;
  selectedRoomId: string;
  selectedRoomProjectPath: string;
  fileQuery: string;
  localWorkspaceMessage: string;
  setProjectFilesForRoom: (roomId: string, files: ProjectFileEntry[]) => void;
  setSelectedFileForRoom: (roomId: string, file: ProjectFileContent | null) => void;
  setSelectedDiffForRoom: (roomId: string, diff: GitDiffResult | null) => void;
  setFileBusyForRoom: (roomId: string, busy: boolean) => void;
  setFileMessageForRoom: (roomId: string, message: string | null) => void;
}

export function useProjectFilesSearch({
  hasSelectedRoom,
  canReadLocalWorkspace,
  selectedRoomId,
  selectedRoomProjectPath,
  fileQuery,
  localWorkspaceMessage,
  setProjectFilesForRoom,
  setSelectedFileForRoom,
  setSelectedDiffForRoom,
  setFileBusyForRoom,
  setFileMessageForRoom
}: UseProjectFilesSearchOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) {
      return;
    }
    const roomId = selectedRoomId;
    if (!canReadLocalWorkspace) {
      setProjectFilesForRoom(roomId, []);
      setSelectedFileForRoom(roomId, null);
      setSelectedDiffForRoom(roomId, null);
      setFileBusyForRoom(roomId, false);
      setFileMessageForRoom(roomId, localWorkspaceMessage);
      return;
    }
    let cancelled = false;
    setFileBusyForRoom(roomId, true);
    searchProjectFiles(selectedRoomProjectPath, fileQuery, 80)
      .then((files) => {
        if (cancelled) return;
        setProjectFilesForRoom(roomId, files);
        setFileMessageForRoom(roomId, null);
      })
      .catch((error) => {
        if (!cancelled) setFileMessageForRoom(roomId, String(error));
      })
      .finally(() => {
        if (!cancelled) setFileBusyForRoom(roomId, false);
      });
    return () => {
      cancelled = true;
    };
  }, [canReadLocalWorkspace, fileQuery, hasSelectedRoom, localWorkspaceMessage, selectedRoomId, selectedRoomProjectPath]);
}
