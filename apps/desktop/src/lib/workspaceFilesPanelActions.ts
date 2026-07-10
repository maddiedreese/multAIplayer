import type { FilePreviewTab } from "./filePreview";
import type { WorkspaceFileSaveRequest } from "../types";
import { useAppStore } from "../store/appStore";

export function createWorkspaceFilesPanelActions({
  selectedRoomId,
  copyProjectMarkdown,
  openProjectFile,
  copyDiffSummaryMarkdown,
  attachSelectedFileToMessage,
  saveSelectedFileContent,
  approveFileSaveRequest,
  denyFileSaveRequest
}: {
  selectedRoomId: string;
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
    store.setSelectedFileForRoom(selectedRoomId, null);
    store.setSelectedDiffForRoom(selectedRoomId, null);
    store.setSensitiveAttachmentReviewKey(null);
  }

  return {
    onCopyProjectMarkdown: copyProjectMarkdown,
    onFileQueryChange: (query: string) => useAppStore.getState().setFileQueryForRoom(selectedRoomId, query),
    onOpenProjectFile: openProjectFile,
    onCopyDiffSummaryMarkdown: copyDiffSummaryMarkdown,
    onAttachSelectedFileToMessage: attachSelectedFileToMessage,
    onSaveSelectedFileContent: saveSelectedFileContent,
    onApproveFileSaveRequest: approveFileSaveRequest,
    onDenyFileSaveRequest: denyFileSaveRequest,
    onFilePreviewTabChange: (tab: FilePreviewTab) =>
      useAppStore.getState().setFilePreviewTabForRoom(selectedRoomId, tab),
    onCloseFileViewer
  };
}
