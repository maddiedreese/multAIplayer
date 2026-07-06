import type { FilePreviewTab } from "../lib/filePreview";

export function useWorkspaceFilesPanelActions({
  selectedRoomId,
  copyProjectMarkdown,
  setFileQueryForRoom,
  openProjectFile,
  copyDiffSummaryMarkdown,
  attachSelectedFileToMessage,
  setFilePreviewTabForRoom,
  setSelectedFileForRoom,
  setSelectedDiffForRoom,
  setSensitiveAttachmentReviewKey
}: {
  selectedRoomId: string;
  copyProjectMarkdown: () => void;
  setFileQueryForRoom: (roomId: string, query: string) => void;
  openProjectFile: (path: string, preferredPreview?: FilePreviewTab) => void;
  copyDiffSummaryMarkdown: () => void;
  attachSelectedFileToMessage: () => void;
  setFilePreviewTabForRoom: (roomId: string, tab: FilePreviewTab) => void;
  setSelectedFileForRoom: (roomId: string, file: null) => void;
  setSelectedDiffForRoom: (roomId: string, diff: null) => void;
  setSensitiveAttachmentReviewKey: (key: string | null) => void;
}) {
  function onCloseFileViewer() {
    setSelectedFileForRoom(selectedRoomId, null);
    setSelectedDiffForRoom(selectedRoomId, null);
    setSensitiveAttachmentReviewKey(null);
  }

  return {
    onCopyProjectMarkdown: copyProjectMarkdown,
    onFileQueryChange: (query: string) => setFileQueryForRoom(selectedRoomId, query),
    onOpenProjectFile: openProjectFile,
    onCopyDiffSummaryMarkdown: copyDiffSummaryMarkdown,
    onAttachSelectedFileToMessage: attachSelectedFileToMessage,
    onFilePreviewTabChange: (tab: FilePreviewTab) => setFilePreviewTabForRoom(selectedRoomId, tab),
    onCloseFileViewer
  };
}
