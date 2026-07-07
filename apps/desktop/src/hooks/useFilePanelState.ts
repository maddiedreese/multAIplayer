import { useAppStore } from "../store/appStore";

export function useFilePanelState() {
  const fileQueriesByRoom = useAppStore((state) => state.fileQueriesByRoom);
  const projectFilesByRoom = useAppStore((state) => state.projectFilesByRoom);
  const selectedFilesByRoom = useAppStore((state) => state.selectedFilesByRoom);
  const selectedDiffsByRoom = useAppStore((state) => state.selectedDiffsByRoom);
  const filePreviewTabsByRoom = useAppStore((state) => state.filePreviewTabsByRoom);
  const fileBusyByRoom = useAppStore((state) => state.fileBusyByRoom);
  const fileMessagesByRoom = useAppStore((state) => state.fileMessagesByRoom);
  const markdownCopyFallbacksByRoom = useAppStore((state) => state.markdownCopyFallbacksByRoom);

  return {
    fileQueriesByRoom,
    projectFilesByRoom,
    selectedFilesByRoom,
    selectedDiffsByRoom,
    filePreviewTabsByRoom,
    fileBusyByRoom,
    fileMessagesByRoom,
    markdownCopyFallbacksByRoom
  };
}
