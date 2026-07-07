import type { StateCreator } from "zustand";
import type { GitDiffResult, ProjectFileContent, ProjectFileEntry } from "../../lib/localBackend";
import { omitRecordKey } from "../../lib/setUtils";
import type { FilePreviewTab } from "../../lib/filePreview";
import type { MarkdownCopyFallback } from "../../types";
import type { AppStoreState } from "../appStore";

type FileQueriesByRoom = Record<string, string>;
type ProjectFilesByRoom = Record<string, ProjectFileEntry[]>;
type SelectedFilesByRoom = Record<string, ProjectFileContent | null>;
type SelectedDiffsByRoom = Record<string, GitDiffResult | null>;
type FilePreviewTabsByRoom = Record<string, FilePreviewTab>;
type FileBusyByRoom = Record<string, boolean>;
type FileMessagesByRoom = Record<string, string | null>;
type MarkdownCopyFallbacksByRoom = Record<string, MarkdownCopyFallback | null>;

export interface FilePanelSlice {
  fileQueriesByRoom: FileQueriesByRoom;
  projectFilesByRoom: ProjectFilesByRoom;
  selectedFilesByRoom: SelectedFilesByRoom;
  selectedDiffsByRoom: SelectedDiffsByRoom;
  filePreviewTabsByRoom: FilePreviewTabsByRoom;
  fileBusyByRoom: FileBusyByRoom;
  fileMessagesByRoom: FileMessagesByRoom;
  markdownCopyFallbacksByRoom: MarkdownCopyFallbacksByRoom;
  setFileBusyForRoom: (roomId: string, busy: boolean) => void;
  setFileQueryForRoom: (roomId: string, query: string) => void;
  setProjectFilesForRoom: (roomId: string, files: ProjectFileEntry[]) => void;
  setSelectedFileForRoom: (roomId: string, file: ProjectFileContent | null) => void;
  setSelectedDiffForRoom: (roomId: string, diff: GitDiffResult | null) => void;
  setFilePreviewTabForRoom: (roomId: string, tab: FilePreviewTab) => void;
  setFileMessageForRoom: (roomId: string, message: string | null) => void;
  setMarkdownCopyFallbackForRoom: (roomId: string, fallback: MarkdownCopyFallback | null) => void;
  resetFileContextForRoom: (roomId: string) => void;
}

export const emptyFilePanelState: Pick<
  FilePanelSlice,
  | "fileQueriesByRoom"
  | "projectFilesByRoom"
  | "selectedFilesByRoom"
  | "selectedDiffsByRoom"
  | "filePreviewTabsByRoom"
  | "fileBusyByRoom"
  | "fileMessagesByRoom"
  | "markdownCopyFallbacksByRoom"
> = {
  fileQueriesByRoom: {},
  projectFilesByRoom: {},
  selectedFilesByRoom: {},
  selectedDiffsByRoom: {},
  filePreviewTabsByRoom: {},
  fileBusyByRoom: {},
  fileMessagesByRoom: {},
  markdownCopyFallbacksByRoom: {}
};

export const createFilePanelSlice: StateCreator<AppStoreState, [], [], FilePanelSlice> = (set) => ({
  ...emptyFilePanelState,
  setFileBusyForRoom: (roomId, busy) => {
    set((state) => ({
      fileBusyByRoom: busy
        ? { ...state.fileBusyByRoom, [roomId]: true }
        : omitRecordKey(state.fileBusyByRoom, roomId)
    }));
  },
  setFileQueryForRoom: (roomId, query) => {
    set((state) => ({
      fileQueriesByRoom: query
        ? { ...state.fileQueriesByRoom, [roomId]: query }
        : omitRecordKey(state.fileQueriesByRoom, roomId)
    }));
  },
  setProjectFilesForRoom: (roomId, files) => {
    set((state) => ({
      projectFilesByRoom: {
        ...state.projectFilesByRoom,
        [roomId]: files
      }
    }));
  },
  setSelectedFileForRoom: (roomId, file) => {
    set((state) => ({
      selectedFilesByRoom: file
        ? { ...state.selectedFilesByRoom, [roomId]: file }
        : omitRecordKey(state.selectedFilesByRoom, roomId)
    }));
  },
  setSelectedDiffForRoom: (roomId, diff) => {
    set((state) => ({
      selectedDiffsByRoom: diff
        ? { ...state.selectedDiffsByRoom, [roomId]: diff }
        : omitRecordKey(state.selectedDiffsByRoom, roomId)
    }));
  },
  setFilePreviewTabForRoom: (roomId, tab) => {
    set((state) => ({
      filePreviewTabsByRoom: tab === "file"
        ? omitRecordKey(state.filePreviewTabsByRoom, roomId)
        : { ...state.filePreviewTabsByRoom, [roomId]: tab }
    }));
  },
  setFileMessageForRoom: (roomId, message) => {
    set((state) => ({
      fileMessagesByRoom: message
        ? { ...state.fileMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.fileMessagesByRoom, roomId)
    }));
  },
  setMarkdownCopyFallbackForRoom: (roomId, fallback) => {
    set((state) => ({
      markdownCopyFallbacksByRoom: fallback
        ? { ...state.markdownCopyFallbacksByRoom, [roomId]: fallback }
        : omitRecordKey(state.markdownCopyFallbacksByRoom, roomId)
    }));
  },
  resetFileContextForRoom: (roomId) => {
    set((state) => ({
      selectedFilesByRoom: omitRecordKey(state.selectedFilesByRoom, roomId),
      selectedDiffsByRoom: omitRecordKey(state.selectedDiffsByRoom, roomId),
      fileQueriesByRoom: omitRecordKey(state.fileQueriesByRoom, roomId),
      projectFilesByRoom: omitRecordKey(state.projectFilesByRoom, roomId),
      fileBusyByRoom: omitRecordKey(state.fileBusyByRoom, roomId),
      fileMessagesByRoom: omitRecordKey(state.fileMessagesByRoom, roomId)
    }));
  }
});
