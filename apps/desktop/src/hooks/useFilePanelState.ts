import { useMemo } from "react";
import { useAppStore } from "../store/appStore";

export function useFilePanelState() {
  const filePanelByRoom = useAppStore((state) => state.filePanelByRoom);

  const {
    fileQueriesByRoom,
    projectFilesByRoom,
    selectedFilesByRoom,
    selectedDiffsByRoom,
    filePreviewTabsByRoom,
    fileBusyByRoom,
    fileMessagesByRoom,
    markdownCopyFallbacksByRoom
  } = useMemo(() => ({
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
    )
  }), [filePanelByRoom]);

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
