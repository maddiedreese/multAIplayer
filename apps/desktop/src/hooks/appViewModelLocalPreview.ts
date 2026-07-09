import type { AppViewModelOptions } from "./appViewModelTypes";
import type { useAppViewProps } from "./useAppViewProps";

type LocalPreviewInput = Parameters<typeof useAppViewProps>[0]["localPreviewDialog"];
type LocalPreviewOptions = Pick<AppViewModelOptions, "appState" | "selectedRuntime" | "roomRuntime">;

export function createLocalPreviewInput({
  appState,
  selectedRuntime,
  roomRuntime
}: LocalPreviewOptions): LocalPreviewInput {
  const { localPreviewState } = appState;

  return {
    localPreviewDialog: localPreviewState.localPreviewDialog,
    closeLocalPreviewDialog: localPreviewState.closeLocalPreviewDialog,
    setLocalPreviewDialogSelectedUrl: localPreviewState.setLocalPreviewDialogSelectedUrl,
    setLocalPreviewDialogManualUrl: localPreviewState.setLocalPreviewDialogManualUrl,
    setLocalPreviewDialogPhase: localPreviewState.setLocalPreviewDialogPhase,
    localPreviewBusy: selectedRuntime.localPreviewBusy,
    prepareLocalPreviewConfirmation: roomRuntime.prepareLocalPreviewConfirmation,
    confirmLocalPreviewShare: roomRuntime.confirmLocalPreviewShare
  };
}
