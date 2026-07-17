import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeNative } from "../nativeCommandError";

import { isTauriRuntime, requireNativeRuntime } from "./runtime";

export interface BrowserViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserNavigationEvent {
  roomId: string;
  projectPath: string | null;
  navigationId: string;
  tabId: string;
  url: string;
}

export interface BrowserViewState {
  navigationId: string;
  tabId: string;
  url: string;
}

export type BrowserNavigationAction = "back" | "forward" | "reload";

export async function openBrowserView(
  roomId: string,
  projectPath: string,
  navigationId: string,
  tabId: string,
  url: string,
  bounds: BrowserViewBounds
): Promise<void> {
  if (!isTauriRuntime()) return requireNativeRuntime("Embedded browser views");
  await invokeNative<void>("open_browser_view", {
    request: { roomId, projectPath, navigationId, tabId, url, bounds }
  });
}

export async function positionBrowserView(
  roomId: string,
  projectPath: string,
  navigationId: string,
  tabId: string,
  bounds: BrowserViewBounds
): Promise<void> {
  if (!isTauriRuntime()) return requireNativeRuntime("Embedded browser views");
  await invokeNative<void>("position_browser_view", {
    request: { roomId, projectPath, navigationId, tabId, bounds }
  });
}

export async function navigateBrowserView(
  roomId: string,
  projectPath: string,
  navigationId: string,
  tabId: string,
  action: BrowserNavigationAction
): Promise<void> {
  if (!isTauriRuntime()) return requireNativeRuntime("Embedded browser views");
  await invokeNative<void>("navigate_browser_view", {
    request: { roomId, projectPath, navigationId, tabId, action }
  });
}

export async function readBrowserViewState(
  roomId: string,
  projectPath: string,
  navigationId: string,
  tabId: string
): Promise<BrowserViewState> {
  if (!isTauriRuntime()) return requireNativeRuntime("Embedded browser views");
  return invokeNative<BrowserViewState>("browser_view_state", {
    request: { roomId, projectPath, navigationId, tabId }
  });
}

export function listenBrowserNavigation(listener: (event: BrowserNavigationEvent) => void): Promise<UnlistenFn> {
  return listen<BrowserNavigationEvent>("browser://navigated", (event) => listener(event.payload));
}

export async function closeBrowserView(
  roomId: string,
  projectPath: string,
  navigationId: string,
  tabId: string
): Promise<void> {
  if (!isTauriRuntime()) return requireNativeRuntime("Embedded browser views");
  await invokeNative<void>("close_browser_view", {
    request: { roomId, projectPath, navigationId, tabId }
  });
}
