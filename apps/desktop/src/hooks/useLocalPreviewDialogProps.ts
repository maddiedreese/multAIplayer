import type { ComponentProps } from "react";
import { quickTunnelDisclaimer, quickTunnelSafetyText } from "../lib/files/localPreview";
import { LocalPreviewDialog } from "../components/LocalPreviewDialog";
import type { LocalPreviewDialogState } from "../types";

type LocalPreviewDialogProps = ComponentProps<typeof LocalPreviewDialog>;

export function useLocalPreviewDialogProps({
  localPreviewDialog,
  closeLocalPreviewDialog,
  setLocalPreviewDialogSelectedUrl,
  setLocalPreviewDialogManualUrl,
  setLocalPreviewDialogPhase,
  localPreviewBusy,
  prepareLocalPreviewConfirmation,
  confirmLocalPreviewShare
}: {
  localPreviewDialog: LocalPreviewDialogState;
  closeLocalPreviewDialog: () => void;
  setLocalPreviewDialogSelectedUrl: (selectedUrl: string) => void;
  setLocalPreviewDialogManualUrl: (manualUrl: string) => void;
  setLocalPreviewDialogPhase: (phase: LocalPreviewDialogState["phase"], error?: string | null) => void;
  localPreviewBusy: boolean;
  prepareLocalPreviewConfirmation: () => Promise<void>;
  confirmLocalPreviewShare: () => Promise<void>;
}) {
  const localPreviewDialogProps: LocalPreviewDialogProps = {
    dialog: localPreviewDialog,
    busy: localPreviewBusy,
    disclaimer: quickTunnelDisclaimer,
    safetyText: quickTunnelSafetyText,
    onClose: closeLocalPreviewDialog,
    onSelectedUrlChange: setLocalPreviewDialogSelectedUrl,
    onManualUrlChange: setLocalPreviewDialogManualUrl,
    onBackToSelect: () => setLocalPreviewDialogPhase("select"),
    onContinue: () => void prepareLocalPreviewConfirmation(),
    onStartSharing: () => void confirmLocalPreviewShare()
  };

  return {
    localPreviewDialogOpen: localPreviewDialog.open,
    localPreviewDialogProps
  };
}
