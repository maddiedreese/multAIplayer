import { useAppStore } from "../store/appStore";

export function useBrowserPanelState() {
  const browserRequestsByRoom = useAppStore((state) => state.browserRequestsByRoom);
  const setBrowserRequestsByRoom = useAppStore((state) => state.setBrowserRequestsByRoom);
  const browserUrlsByRoom = useAppStore((state) => state.browserUrlsByRoom);
  const setBrowserUrlsByRoom = useAppStore((state) => state.setBrowserUrlsByRoom);
  const browserReasonsByRoom = useAppStore((state) => state.browserReasonsByRoom);
  const setBrowserReasonsByRoom = useAppStore((state) => state.setBrowserReasonsByRoom);
  const browserMessagesByRoom = useAppStore((state) => state.browserMessagesByRoom);
  const setBrowserMessagesByRoom = useAppStore((state) => state.setBrowserMessagesByRoom);
  const browserStatusByRoom = useAppStore((state) => state.browserStatusByRoom);
  const setBrowserStatusByRoom = useAppStore((state) => state.setBrowserStatusByRoom);
  const activeBrowserUrlsByRoom = useAppStore((state) => state.activeBrowserUrlsByRoom);
  const setActiveBrowserUrlsByRoom = useAppStore((state) => state.setActiveBrowserUrlsByRoom);

  return {
    browserRequestsByRoom,
    setBrowserRequestsByRoom,
    browserUrlsByRoom,
    setBrowserUrlsByRoom,
    browserReasonsByRoom,
    setBrowserReasonsByRoom,
    browserMessagesByRoom,
    setBrowserMessagesByRoom,
    browserStatusByRoom,
    setBrowserStatusByRoom,
    activeBrowserUrlsByRoom,
    setActiveBrowserUrlsByRoom
  };
}
