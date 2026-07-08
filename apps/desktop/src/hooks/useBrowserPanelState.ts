import { useMemo } from "react";
import { useAppStore } from "../store/appStore";

export function useBrowserPanelState() {
  const browserByRoom = useAppStore((state) => state.browserByRoom);

  const browserMaps = useMemo(() => ({
    browserRequestsByRoom: Object.fromEntries(
      Object.entries(browserByRoom)
        .filter(([, roomBrowser]) => roomBrowser.requests)
        .map(([roomId, roomBrowser]) => [roomId, roomBrowser.requests ?? []])
    ),
    browserUrlsByRoom: Object.fromEntries(
      Object.entries(browserByRoom)
        .filter(([, roomBrowser]) => roomBrowser.url)
        .map(([roomId, roomBrowser]) => [roomId, roomBrowser.url ?? ""])
    ),
    browserReasonsByRoom: Object.fromEntries(
      Object.entries(browserByRoom)
        .filter(([, roomBrowser]) => roomBrowser.reason)
        .map(([roomId, roomBrowser]) => [roomId, roomBrowser.reason ?? ""])
    ),
    browserMessagesByRoom: Object.fromEntries(
      Object.entries(browserByRoom)
        .filter(([, roomBrowser]) => roomBrowser.message)
        .map(([roomId, roomBrowser]) => [roomId, roomBrowser.message ?? null])
    ),
    browserStatusByRoom: Object.fromEntries(
      Object.entries(browserByRoom)
        .filter(([, roomBrowser]) => roomBrowser.status)
        .map(([roomId, roomBrowser]) => [roomId, roomBrowser.status])
    ),
    activeBrowserUrlsByRoom: Object.fromEntries(
      Object.entries(browserByRoom)
        .filter(([, roomBrowser]) => roomBrowser.activeUrl)
        .map(([roomId, roomBrowser]) => [roomId, roomBrowser.activeUrl ?? null])
    )
  }), [browserByRoom]);

  return {
    ...browserMaps
  };
}
