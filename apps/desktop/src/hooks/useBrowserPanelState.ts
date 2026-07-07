import { useAppStore } from "../store/appStore";

export function useBrowserPanelState() {
  const browserRequestsByRoom = useAppStore((state) => state.browserRequestsByRoom);
  const browserUrlsByRoom = useAppStore((state) => state.browserUrlsByRoom);
  const browserReasonsByRoom = useAppStore((state) => state.browserReasonsByRoom);
  const browserMessagesByRoom = useAppStore((state) => state.browserMessagesByRoom);
  const browserStatusByRoom = useAppStore((state) => state.browserStatusByRoom);
  const activeBrowserUrlsByRoom = useAppStore((state) => state.activeBrowserUrlsByRoom);

  return {
    browserRequestsByRoom,
    browserUrlsByRoom,
    browserReasonsByRoom,
    browserMessagesByRoom,
    browserStatusByRoom,
    activeBrowserUrlsByRoom
  };
}
