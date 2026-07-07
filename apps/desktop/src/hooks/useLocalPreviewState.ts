import { useAppStore } from "../store/appStore";

export function useLocalPreviewState() {
  const localPreviewsByRoom = useAppStore((state) => state.localPreviewsByRoom);
  const setLocalPreviewsByRoom = useAppStore((state) => state.setLocalPreviewsByRoom);
  const localPreviewDialog = useAppStore((state) => state.localPreviewDialog);
  const setLocalPreviewDialog = useAppStore((state) => state.setLocalPreviewDialog);
  const localPreviewBusyByRoom = useAppStore((state) => state.localPreviewBusyByRoom);
  const setLocalPreviewBusyByRoom = useAppStore((state) => state.setLocalPreviewBusyByRoom);

  return {
    localPreviewsByRoom,
    setLocalPreviewsByRoom,
    localPreviewDialog,
    setLocalPreviewDialog,
    localPreviewBusyByRoom,
    setLocalPreviewBusyByRoom
  };
}
