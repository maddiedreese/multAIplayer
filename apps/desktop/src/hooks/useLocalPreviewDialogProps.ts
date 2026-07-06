import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { quickTunnelDisclaimer, quickTunnelSafetyText } from "../lib/localPreview";
import { LocalPreviewDialog } from "../components/LocalPreviewDialog";
import type { LocalPreviewDialogState } from "../types";

type LocalPreviewDialogProps = ComponentProps<typeof LocalPreviewDialog>;

export function useLocalPreviewDialogProps({
  localPreviewDialog,
  setLocalPreviewDialog,
  localPreviewBusy,
  prepareLocalPreviewConfirmation,
  confirmLocalPreviewShare
}: {
  localPreviewDialog: LocalPreviewDialogState;
  setLocalPreviewDialog: Dispatch<SetStateAction<LocalPreviewDialogState>>;
  localPreviewBusy: boolean;
  prepareLocalPreviewConfirmation: () => Promise<void>;
  confirmLocalPreviewShare: () => Promise<void>;
}) {
  const localPreviewDialogProps: LocalPreviewDialogProps = {
    dialog: localPreviewDialog,
    busy: localPreviewBusy,
    disclaimer: quickTunnelDisclaimer,
    safetyText: quickTunnelSafetyText,
    onClose: () => setLocalPreviewDialog((current) => ({ ...current, open: false })),
    onSelectedUrlChange: (selectedUrl) => setLocalPreviewDialog((current) => ({ ...current, selectedUrl })),
    onManualUrlChange: (manualUrl) => setLocalPreviewDialog((current) => ({ ...current, manualUrl })),
    onBackToSelect: () => setLocalPreviewDialog((current) => ({ ...current, phase: "select" })),
    onContinue: () => void prepareLocalPreviewConfirmation(),
    onStartSharing: () => void confirmLocalPreviewShare()
  };

  return {
    localPreviewDialogOpen: localPreviewDialog.open,
    localPreviewDialogProps
  };
}
