import { LocalPreviewDialog } from "./LocalPreviewDialog";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";
import { quickTunnelDisclaimer, quickTunnelSafetyText } from "../lib/files/localPreview";

export interface LocalPreviewDialogActions {
  prepareLocalPreviewConfirmation: () => Promise<void>;
  confirmLocalPreviewShare: () => Promise<void>;
}

export function LocalPreviewDialogContainer(actions: LocalPreviewDialogActions) {
  const state = useAppStore(
    useShallow((state) => {
      const selectedRoomId = state.selectedRoomId;
      return {
        dialog: state.localPreviewDialog,
        busy: selectedRoomId ? (state.localPreviewByRoom[selectedRoomId]?.busy ?? false) : false
      };
    })
  );
  const {
    closeLocalPreviewDialog: close,
    setLocalPreviewDialogSelectedUrl: setSelectedUrl,
    setLocalPreviewDialogManualUrl: setManualUrl,
    setLocalPreviewDialogPhase: setPhase
  } = useAppStore.getState();
  if (!state.dialog.open) return null;
  return (
    <LocalPreviewDialog
      dialog={state.dialog}
      busy={state.busy}
      disclaimer={quickTunnelDisclaimer}
      safetyText={quickTunnelSafetyText}
      onClose={close}
      onSelectedUrlChange={setSelectedUrl}
      onManualUrlChange={setManualUrl}
      onBackToSelect={() => setPhase("select")}
      onContinue={() => void actions.prepareLocalPreviewConfirmation()}
      onStartSharing={() => void actions.confirmLocalPreviewShare()}
    />
  );
}
