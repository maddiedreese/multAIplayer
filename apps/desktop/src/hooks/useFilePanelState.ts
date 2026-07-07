import { useAppStore } from "../store/appStore";

export function useFilePanelState() {
  const fileQueriesByRoom = useAppStore((state) => state.fileQueriesByRoom);
  const setFileQueriesByRoom = useAppStore((state) => state.setFileQueriesByRoom);
  const projectFilesByRoom = useAppStore((state) => state.projectFilesByRoom);
  const setProjectFilesByRoom = useAppStore((state) => state.setProjectFilesByRoom);
  const selectedFilesByRoom = useAppStore((state) => state.selectedFilesByRoom);
  const setSelectedFilesByRoom = useAppStore((state) => state.setSelectedFilesByRoom);
  const selectedDiffsByRoom = useAppStore((state) => state.selectedDiffsByRoom);
  const setSelectedDiffsByRoom = useAppStore((state) => state.setSelectedDiffsByRoom);
  const filePreviewTabsByRoom = useAppStore((state) => state.filePreviewTabsByRoom);
  const setFilePreviewTabsByRoom = useAppStore((state) => state.setFilePreviewTabsByRoom);
  const fileBusyByRoom = useAppStore((state) => state.fileBusyByRoom);
  const setFileBusyByRoom = useAppStore((state) => state.setFileBusyByRoom);
  const fileMessagesByRoom = useAppStore((state) => state.fileMessagesByRoom);
  const setFileMessagesByRoom = useAppStore((state) => state.setFileMessagesByRoom);
  const markdownCopyFallbacksByRoom = useAppStore((state) => state.markdownCopyFallbacksByRoom);
  const setMarkdownCopyFallbacksByRoom = useAppStore((state) => state.setMarkdownCopyFallbacksByRoom);

  return {
    fileQueriesByRoom,
    setFileQueriesByRoom,
    projectFilesByRoom,
    setProjectFilesByRoom,
    selectedFilesByRoom,
    setSelectedFilesByRoom,
    selectedDiffsByRoom,
    setSelectedDiffsByRoom,
    filePreviewTabsByRoom,
    setFilePreviewTabsByRoom,
    fileBusyByRoom,
    setFileBusyByRoom,
    fileMessagesByRoom,
    setFileMessagesByRoom,
    markdownCopyFallbacksByRoom,
    setMarkdownCopyFallbacksByRoom
  };
}
