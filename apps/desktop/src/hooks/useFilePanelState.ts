import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { projectFilePanelMaps } from "../store/slices/filePanelSlice";

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
  } = useMemo(() => projectFilePanelMaps(filePanelByRoom), [filePanelByRoom]);

  return {
    filePanelByRoom,
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
