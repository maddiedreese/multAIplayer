import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./runtime";
import type { BrowserOpenResult, BrowserProfileResult } from "./types";

export async function openBrowserView(
  roomId: string,
  projectPath: string,
  url: string,
  title?: string,
  persistent = true
): Promise<BrowserOpenResult> {
  if (isTauriRuntime()) {
    return invoke<BrowserOpenResult>("open_browser_view", {
      request: { roomId, projectPath, url, title, persistent }
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
    clipboardBlocked: false,
    fileUploadsBlocked: false
  };
}

export async function resetBrowserProfile(roomId: string, projectPath: string): Promise<BrowserProfileResult> {
  if (isTauriRuntime()) {
    return invoke<BrowserProfileResult>("reset_browser_profile", {
      request: { roomId, projectPath }
    });
  }

  return {
    roomId,
    profilePath: "Preview browser opens outside the native room profile.",
    reset: true
  };
}
