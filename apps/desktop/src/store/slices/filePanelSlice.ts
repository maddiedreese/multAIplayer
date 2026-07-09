import type { StateCreator } from "zustand";
import type { GitDiffResult, ProjectFileContent, ProjectFileEntry } from "../../lib/localBackend";
import { omitRecordKey } from "../../lib/setUtils";
import type { FilePreviewTab } from "../../lib/filePreview";
import type { MarkdownCopyFallback } from "../../types";
import type { WorkspaceFileSaveRequest } from "../../types";
import type { AppStoreState } from "../appStore";

export interface FilePanelRoomState {
  query?: string;
  projectFiles?: ProjectFileEntry[];
  selectedFile?: ProjectFileContent;
  selectedDiff?: GitDiffResult;
  previewTab?: FilePreviewTab;
  busy?: boolean;
  message?: string;
  markdownCopyFallback?: MarkdownCopyFallback;
  saveRequests?: WorkspaceFileSaveRequest[];
}

export type FilePanelByRoom = Record<string, FilePanelRoomState>;

export interface FilePanelMaps {
  fileQueriesByRoom: Record<string, string>;
  projectFilesByRoom: Record<string, ProjectFileEntry[]>;
  selectedFilesByRoom: Record<string, ProjectFileContent | null>;
  selectedDiffsByRoom: Record<string, GitDiffResult | null>;
  filePreviewTabsByRoom: Record<string, FilePreviewTab>;
  fileBusyByRoom: Record<string, boolean>;
  fileMessagesByRoom: Record<string, string | null>;
  markdownCopyFallbacksByRoom: Record<string, MarkdownCopyFallback | null>;
  fileSaveRequestsByRoom: Record<string, WorkspaceFileSaveRequest[]>;
}

function shallowEqualFilePanelRoomState(left: FilePanelRoomState, right: FilePanelRoomState): boolean {
  const leftKeys = Object.keys(left) as Array<keyof FilePanelRoomState>;
  const rightKeys = Object.keys(right) as Array<keyof FilePanelRoomState>;
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

function updateFilePanelForRoom(
  current: FilePanelByRoom,
  roomId: string,
  update: (roomPanel: FilePanelRoomState) => FilePanelRoomState
): FilePanelByRoom {
  const currentRoomPanel = current[roomId] ?? {};
  const nextRoomPanel = update(currentRoomPanel);
  if (shallowEqualFilePanelRoomState(currentRoomPanel, nextRoomPanel)) return current;
  if (Object.keys(nextRoomPanel).length === 0) return roomId in current ? omitRecordKey(current, roomId) : current;
  return { ...current, [roomId]: nextRoomPanel };
}

export function projectFilePanelMaps(filePanelByRoom: FilePanelByRoom): FilePanelMaps {
  return {
    fileQueriesByRoom: Object.fromEntries(
      Object.entries(filePanelByRoom)
        .filter(([, panel]) => panel.query)
        .map(([roomId, panel]) => [roomId, panel.query ?? ""])
    ),
    projectFilesByRoom: Object.fromEntries(
      Object.entries(filePanelByRoom)
        .filter(([, panel]) => panel.projectFiles)
        .map(([roomId, panel]) => [roomId, panel.projectFiles ?? []])
    ),
    selectedFilesByRoom: Object.fromEntries(
      Object.entries(filePanelByRoom)
        .filter(([, panel]) => panel.selectedFile)
        .map(([roomId, panel]) => [roomId, panel.selectedFile ?? null])
    ),
    selectedDiffsByRoom: Object.fromEntries(
      Object.entries(filePanelByRoom)
        .filter(([, panel]) => panel.selectedDiff)
        .map(([roomId, panel]) => [roomId, panel.selectedDiff ?? null])
    ),
    filePreviewTabsByRoom: Object.fromEntries(
      Object.entries(filePanelByRoom)
        .filter(([, panel]) => panel.previewTab)
        .map(([roomId, panel]) => [roomId, panel.previewTab ?? "file"])
    ),
    fileBusyByRoom: Object.fromEntries(
      Object.entries(filePanelByRoom)
        .filter(([, panel]) => panel.busy)
        .map(([roomId]) => [roomId, true])
    ),
    fileMessagesByRoom: Object.fromEntries(
      Object.entries(filePanelByRoom)
        .filter(([, panel]) => panel.message)
        .map(([roomId, panel]) => [roomId, panel.message ?? null])
    ),
    markdownCopyFallbacksByRoom: Object.fromEntries(
      Object.entries(filePanelByRoom)
        .filter(([, panel]) => panel.markdownCopyFallback)
        .map(([roomId, panel]) => [roomId, panel.markdownCopyFallback ?? null])
    ),
    fileSaveRequestsByRoom: Object.fromEntries(
      Object.entries(filePanelByRoom)
        .filter(([, panel]) => panel.saveRequests)
        .map(([roomId, panel]) => [roomId, panel.saveRequests ?? []])
    )
  };
}

export interface FilePanelSlice {
  filePanelByRoom: FilePanelByRoom;
  setFileBusyForRoom: (roomId: string, busy: boolean) => void;
  setFileQueryForRoom: (roomId: string, query: string) => void;
  setProjectFilesForRoom: (roomId: string, files: ProjectFileEntry[]) => void;
  setSelectedFileForRoom: (roomId: string, file: ProjectFileContent | null) => void;
  setSelectedDiffForRoom: (roomId: string, diff: GitDiffResult | null) => void;
  setFilePreviewTabForRoom: (roomId: string, tab: FilePreviewTab) => void;
  setFileMessageForRoom: (roomId: string, message: string | null) => void;
  setMarkdownCopyFallbackForRoom: (roomId: string, fallback: MarkdownCopyFallback | null) => void;
  appendFileSaveRequest: (roomId: string, request: WorkspaceFileSaveRequest) => void;
  updateFileSaveRequestStatus: (roomId: string, requestId: string, status: WorkspaceFileSaveRequest["status"]) => void;
  resetFileContextForRoom: (roomId: string) => void;
}

export const emptyFilePanelState: Pick<
  FilePanelSlice,
  | "filePanelByRoom"
> = {
  filePanelByRoom: {}
};

export const createFilePanelSlice: StateCreator<AppStoreState, [], [], FilePanelSlice> = (set) => ({
  ...emptyFilePanelState,
  setFileBusyForRoom: (roomId, busy) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => {
        const { busy: _busy, ...rest } = roomPanel;
        return busy ? { ...rest, busy: true } : rest;
      })
    }));
  },
  setFileQueryForRoom: (roomId, query) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => {
        const { query: _query, ...rest } = roomPanel;
        return query ? { ...rest, query } : rest;
      })
    }));
  },
  setProjectFilesForRoom: (roomId, files) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => ({
        ...roomPanel,
        projectFiles: files
      }))
    }));
  },
  setSelectedFileForRoom: (roomId, file) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => {
        const { selectedFile: _selectedFile, ...rest } = roomPanel;
        return file ? { ...rest, selectedFile: file } : rest;
      })
    }));
  },
  setSelectedDiffForRoom: (roomId, diff) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => {
        const { selectedDiff: _selectedDiff, ...rest } = roomPanel;
        return diff ? { ...rest, selectedDiff: diff } : rest;
      })
    }));
  },
  setFilePreviewTabForRoom: (roomId, tab) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => {
        const { previewTab: _previewTab, ...rest } = roomPanel;
        return tab === "file" ? rest : { ...rest, previewTab: tab };
      })
    }));
  },
  setFileMessageForRoom: (roomId, message) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => {
        const { message: _message, ...rest } = roomPanel;
        return message ? { ...rest, message } : rest;
      })
    }));
  },
  setMarkdownCopyFallbackForRoom: (roomId, fallback) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => {
        const { markdownCopyFallback: _markdownCopyFallback, ...rest } = roomPanel;
        return fallback ? { ...rest, markdownCopyFallback: fallback } : rest;
      })
    }));
  },
  appendFileSaveRequest: (roomId, request) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => {
        const requests = roomPanel.saveRequests ?? [];
        if (requests.some((item) => item.id === request.id)) return roomPanel;
        return { ...roomPanel, saveRequests: [...requests, request] };
      })
    }));
  },
  updateFileSaveRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => {
        const requests = roomPanel.saveRequests ?? [];
        const nextRequests = requests.map((request) => request.id === requestId ? { ...request, status } : request);
        return { ...roomPanel, saveRequests: nextRequests };
      })
    }));
  },
  resetFileContextForRoom: (roomId) => {
    set((state) => ({
      filePanelByRoom: updateFilePanelForRoom(state.filePanelByRoom, roomId, (roomPanel) => {
        const {
          query: _query,
          projectFiles: _projectFiles,
          selectedFile: _selectedFile,
          selectedDiff: _selectedDiff,
          busy: _busy,
          message: _message,
          ...rest
        } = roomPanel;
        return rest;
      })
    }));
  }
});
