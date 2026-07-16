import { invokeNative } from "../nativeCommandError";

import { isTauriRuntime } from "./runtime";
import type { BrowserOpenResult, BrowserProfileResult } from "./types";

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
  bounds: BrowserViewBounds,
  persistent = true
): Promise<BrowserOpenResult> {
  if (isTauriRuntime()) {
    return invokeNative<BrowserOpenResult>("open_browser_view", {
      request: { roomId, projectPath, url, bounds, persistent }
    });
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return {
    label: `preview-browser-${roomId}`,
    url,
    reused: false,
    profilePath: "Preview browser opens outside the native room profile.",
    persistent,
    downloadsBlocked: false,
    pageGuardInstalled: false
  };
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

export async function resetBrowserProfile(roomId: string, projectPath: string): Promise<BrowserProfileResult> {
  if (isTauriRuntime()) {
    return invokeNative<BrowserProfileResult>("reset_browser_profile", {
      request: { roomId, projectPath }
    });
  }

  return {
    roomId,
    profilePath: "Preview browser opens outside the native room profile.",
    reset: true
  };
}
