import { useAppStore } from "../store/appStore";

export function useLocalPreviewState() {
  const localPreviewsByRoom = useAppStore((state) => state.localPreviewsByRoom);
  const localPreviewDialog = useAppStore((state) => state.localPreviewDialog);
  const openLocalPreviewDialogForRoom = useAppStore((state) => state.openLocalPreviewDialogForRoom);
  const closeLocalPreviewDialog = useAppStore((state) => state.closeLocalPreviewDialog);
  const setLocalPreviewDialogCandidates = useAppStore((state) => state.setLocalPreviewDialogCandidates);
  const setLocalPreviewDialogSelectedUrl = useAppStore((state) => state.setLocalPreviewDialogSelectedUrl);
  const setLocalPreviewDialogManualUrl = useAppStore((state) => state.setLocalPreviewDialogManualUrl);
  const setLocalPreviewDialogPhase = useAppStore((state) => state.setLocalPreviewDialogPhase);
  const setLocalPreviewDialogConfirmation = useAppStore((state) => state.setLocalPreviewDialogConfirmation);
  const setLocalPreviewDialogError = useAppStore((state) => state.setLocalPreviewDialogError);
  const localPreviewBusyByRoom = useAppStore((state) => state.localPreviewBusyByRoom);

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
