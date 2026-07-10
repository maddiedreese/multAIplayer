import { LocalPreviewDialog } from "./LocalPreviewDialog";
import { useLocalPreviewDialogProps } from "../hooks/useLocalPreviewDialogProps";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";

export interface LocalPreviewDialogActions {
  prepareLocalPreviewConfirmation: () => Promise<void>;
  confirmLocalPreviewShare: () => Promise<void>;
}

export function LocalPreviewDialogContainer(actions: LocalPreviewDialogActions) {
  const state = useAppStore(useShallow((state) => {
    const selectedRoomId = state.selectedRoomId;
    return {
      dialog: state.localPreviewDialog,
      busy: selectedRoomId ? state.localPreviewByRoom[selectedRoomId]?.busy ?? false : false
    };
  }));
  const {
    closeLocalPreviewDialog: close,
    setLocalPreviewDialogSelectedUrl: setSelectedUrl,
    setLocalPreviewDialogManualUrl: setManualUrl,
    setLocalPreviewDialogPhase: setPhase
  } = useAppStore.getState();
  const { localPreviewDialogOpen, localPreviewDialogProps } = useLocalPreviewDialogProps({
    localPreviewDialog: state.dialog,
    closeLocalPreviewDialog: close,
    setLocalPreviewDialogSelectedUrl: setSelectedUrl,
    setLocalPreviewDialogManualUrl: setManualUrl,
    setLocalPreviewDialogPhase: setPhase,
    localPreviewBusy: state.busy,
    ...actions
  });

  return localPreviewDialogOpen ? <LocalPreviewDialog {...localPreviewDialogProps} /> : null;
}
