import type { RoomRecord } from "@multaiplayer/protocol";
import type { ThemeMode } from "../components/DesktopSidebar";
import { membershipRemovedRoomMessage } from "./relayAccess";

export function loadOrCreateDeviceId(): string {
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
  if (revoked) return membershipRemovedRoomMessage(room.name);
  return "This room was forgotten on this device. Rejoin from an invite or get host approval to unlock messages again.";
}

export function roomSecretStorageLabel(): string {
  return "__TAURI_INTERNALS__" in window ? "macOS Keychain" : "web preview localStorage";
}
