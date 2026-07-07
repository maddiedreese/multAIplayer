import { useAppStore } from "../store/appStore";

export function useLocalPreviewState() {
  const localPreviewsByRoom = useAppStore((state) => state.localPreviewsByRoom);
  const localPreviewDialog = useAppStore((state) => state.localPreviewDialog);
  const setLocalPreviewDialog = useAppStore((state) => state.setLocalPreviewDialog);
  const localPreviewBusyByRoom = useAppStore((state) => state.localPreviewBusyByRoom);

  return {
    localPreviewsByRoom,
    localPreviewDialog,
    setLocalPreviewDialog,
    localPreviewBusyByRoom
  };
}
