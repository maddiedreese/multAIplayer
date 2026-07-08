import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { projectLocalPreviewPanelMaps } from "../store/slices/localPreviewSlice";

export function useLocalPreviewState() {
  const localPreviewByRoom = useAppStore((state) => state.localPreviewByRoom);
  const localPreviewDialog = useAppStore((state) => state.localPreviewDialog);
  const openLocalPreviewDialogForRoom = useAppStore((state) => state.openLocalPreviewDialogForRoom);
  const closeLocalPreviewDialog = useAppStore((state) => state.closeLocalPreviewDialog);
  const setLocalPreviewDialogCandidates = useAppStore((state) => state.setLocalPreviewDialogCandidates);
  const setLocalPreviewDialogSelectedUrl = useAppStore((state) => state.setLocalPreviewDialogSelectedUrl);
  const setLocalPreviewDialogManualUrl = useAppStore((state) => state.setLocalPreviewDialogManualUrl);
  const setLocalPreviewDialogPhase = useAppStore((state) => state.setLocalPreviewDialogPhase);
  const setLocalPreviewDialogConfirmation = useAppStore((state) => state.setLocalPreviewDialogConfirmation);
  const setLocalPreviewDialogError = useAppStore((state) => state.setLocalPreviewDialogError);
  const { localPreviewsByRoom, localPreviewBusyByRoom } = useMemo(
    () => projectLocalPreviewPanelMaps(localPreviewByRoom),
    [localPreviewByRoom]
  );

  return {
    localPreviewsByRoom,
    localPreviewDialog,
    openLocalPreviewDialogForRoom,
    closeLocalPreviewDialog,
    setLocalPreviewDialogCandidates,
    setLocalPreviewDialogSelectedUrl,
    setLocalPreviewDialogManualUrl,
    setLocalPreviewDialogPhase,
    setLocalPreviewDialogConfirmation,
    setLocalPreviewDialogError,
    localPreviewBusyByRoom
  };
}
