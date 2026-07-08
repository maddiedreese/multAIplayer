import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { projectBrowserPanelMaps } from "../store/slices/browserSlice";

export function useBrowserPanelState() {
  const browserByRoom = useAppStore((state) => state.browserByRoom);

  const browserMaps = useMemo(() => projectBrowserPanelMaps(browserByRoom), [browserByRoom]);

  return {
    browserByRoom,
    ...browserMaps
  };
}
