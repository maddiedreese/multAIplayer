import type { Dispatch, SetStateAction } from "react";
import type { FilePreviewTab } from "../lib/filePreview";
import type { GitDiffResult, ProjectFileContent, ProjectFileEntry } from "../lib/localBackend";
import { omitRecordKey } from "../lib/setUtils";

interface UseRoomFileSettersOptions {
  selectedRoomId: string;
  setFileQueriesByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setProjectFilesByRoom: Dispatch<SetStateAction<Record<string, ProjectFileEntry[]>>>;
  setSelectedFilesByRoom: Dispatch<SetStateAction<Record<string, ProjectFileContent | null>>>;
  setSelectedDiffsByRoom: Dispatch<SetStateAction<Record<string, GitDiffResult | null>>>;
  setFilePreviewTabsByRoom: Dispatch<SetStateAction<Record<string, FilePreviewTab>>>;
  setFileBusyByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setFileMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
}

export function useRoomFileSetters({
  selectedRoomId,
  setFileQueriesByRoom,
  setProjectFilesByRoom,
  setSelectedFilesByRoom,
  setSelectedDiffsByRoom,
  setFilePreviewTabsByRoom,
  setFileBusyByRoom,
  setFileMessagesByRoom
}: UseRoomFileSettersOptions) {
  function setFileQueryForRoom(roomId: string, query: string) {
    setFileQueriesByRoom((current) => query ? { ...current, [roomId]: query } : omitRecordKey(current, roomId));
  }

  function setProjectFilesForRoom(roomId: string, files: ProjectFileEntry[]) {
    setProjectFilesByRoom((current) => ({
      ...current,
      [roomId]: files
    }));
  }

  function setSelectedFileForRoom(roomId: string, file: ProjectFileContent | null) {
    setSelectedFilesByRoom((current) => file ? { ...current, [roomId]: file } : omitRecordKey(current, roomId));
  }

  function setSelectedDiffForRoom(roomId: string, diff: GitDiffResult | null) {
    setSelectedDiffsByRoom((current) => diff ? { ...current, [roomId]: diff } : omitRecordKey(current, roomId));
  }

  function setFilePreviewTabForRoom(roomId: string, tab: FilePreviewTab) {
    setFilePreviewTabsByRoom((current) => tab === "file" ? omitRecordKey(current, roomId) : { ...current, [roomId]: tab });
  }

  function setFileMessageForRoom(roomId: string, message: string | null) {
    setFileMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedFileMessage(message: string | null) {
    setFileMessageForRoom(selectedRoomId, message);
  }

  function resetFileContextForRoom(roomId: string) {
    setSelectedFileForRoom(roomId, null);
    setSelectedDiffForRoom(roomId, null);
    setFileQueryForRoom(roomId, "");
    setProjectFilesByRoom((current) => omitRecordKey(current, roomId));
    setFileBusyByRoom((current) => omitRecordKey(current, roomId));
    setFileMessagesByRoom((current) => omitRecordKey(current, roomId));
  }

  return {
    setFileQueryForRoom,
    setProjectFilesForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom,
    setFilePreviewTabForRoom,
    setFileMessageForRoom,
    setSelectedFileMessage,
    resetFileContextForRoom
  };
}
