import type { RoomRecord } from "@multaiplayer/protocol";
import type { ThemeMode } from "../components/DesktopSidebar";
import { membershipRemovedRoomMessage } from "./relayAccess";

export function loadOrCreateDeviceId(): string {
  if (typeof localStorage === "undefined") return "device-nonbrowser-runtime";
  const key = "multaiplayer:device-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = `device_${crypto.randomUUID()}`;
  localStorage.setItem(key, created);
  return created;
}

export function loadThemeMode(): ThemeMode {
  const stored = localStorage.getItem("multaiplayer:theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function roomLockMessage(room: RoomRecord, revoked: boolean): string {
  if (room.archivedAt) return "This room is archived. Restore it before sending messages or running host-side actions.";
  if (revoked) return membershipRemovedRoomMessage(room.name);
  return "This room was forgotten on this device. Rejoin from an invite or get host approval to unlock messages again.";
}

export function mlsStateStorageLabel(): string {
  return isTauriRuntime() ? "encrypted native MLS store" : "unavailable outside the native app";
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
