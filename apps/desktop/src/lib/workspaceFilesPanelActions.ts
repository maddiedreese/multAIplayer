import type { FilePreviewTab } from "./filePreview";
import type { WorkspaceFileSaveRequest } from "../types";
import { useAppStore } from "../store/appStore";

export function createWorkspaceFilesPanelActions({
  copyProjectMarkdown,
  openProjectFile,
  copyDiffSummaryMarkdown,
  attachSelectedFileToMessage,
  saveSelectedFileContent,
  approveFileSaveRequest,
  denyFileSaveRequest
}: {
  copyProjectMarkdown: () => void;
  openProjectFile: (path: string, preferredPreview?: FilePreviewTab) => void;
  copyDiffSummaryMarkdown: () => void;
  attachSelectedFileToMessage: () => void;
  saveSelectedFileContent: (content: string) => void;
  approveFileSaveRequest: (request: WorkspaceFileSaveRequest) => void;
  denyFileSaveRequest: (requestId: string) => void;
}) {
  function onCloseFileViewer() {
    const store = useAppStore.getState();
    const selectedRoomId = store.selectedRoomId;
    store.setSelectedFileForRoom(selectedRoomId, null);
    store.setSelectedDiffForRoom(selectedRoomId, null);
    store.setSensitiveAttachmentReviewKey(null);
  }

  return {
    onCopyProjectMarkdown: copyProjectMarkdown,
    onFileQueryChange: (query: string) => {
      const state = useAppStore.getState();
      state.setFileQueryForRoom(state.selectedRoomId, query);
    },
    onOpenProjectFile: openProjectFile,
    onCopyDiffSummaryMarkdown: copyDiffSummaryMarkdown,
    onAttachSelectedFileToMessage: attachSelectedFileToMessage,
    onSaveSelectedFileContent: saveSelectedFileContent,
    onApproveFileSaveRequest: approveFileSaveRequest,
    onDenyFileSaveRequest: denyFileSaveRequest,
    onFilePreviewTabChange: (tab: FilePreviewTab) => {
      const state = useAppStore.getState();
      state.setFilePreviewTabForRoom(state.selectedRoomId, tab);
    },
    onCloseFileViewer
  };
}
