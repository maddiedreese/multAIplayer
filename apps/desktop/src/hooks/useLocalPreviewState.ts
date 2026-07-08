import { useMemo } from "react";
import { useAppStore } from "../store/appStore";

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
  const { localPreviewsByRoom, localPreviewBusyByRoom } = useMemo(() => ({
    localPreviewsByRoom: Object.fromEntries(
      Object.entries(localPreviewByRoom)
        .filter(([, preview]) => preview.previews)
        .map(([roomId, preview]) => [roomId, preview.previews ?? []])
    ),
    localPreviewBusyByRoom: Object.fromEntries(
      Object.entries(localPreviewByRoom)
        .filter(([, preview]) => preview.busy)
        .map(([roomId]) => [roomId, true])
    )
  }), [localPreviewByRoom]);

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
