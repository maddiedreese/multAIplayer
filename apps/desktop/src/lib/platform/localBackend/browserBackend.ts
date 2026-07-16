import { invokeNative } from "../nativeCommandError";

import { isTauriRuntime } from "./runtime";

export interface BrowserViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function openBrowserView(
  roomId: string,
  projectPath: string,
  url: string,
  bounds: BrowserViewBounds
): Promise<void> {
  if (isTauriRuntime()) {
    await invokeNative<void>("open_browser_view", {
      request: { roomId, projectPath, url, bounds }
    });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export async function positionBrowserView(
  roomId: string,
  projectPath: string,
  bounds: BrowserViewBounds
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeNative<void>("position_browser_view", {
    request: { roomId, projectPath, bounds }
  });
}

export async function closeBrowserView(roomId: string, projectPath: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeNative<void>("close_browser_view", {
    request: { roomId, projectPath }
  });
}
