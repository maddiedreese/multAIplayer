import { defaultBrowserAllowedOrigins, type RoomRecord } from "@multaiplayer/protocol";
import { detectBrowserSecretRisks } from "./secretRisks";

export function normalizeBrowserAllowedOrigins(value: string[] | string): string[] | null {
  const rawOrigins = Array.isArray(value)
    ? value
    : value.split(/\r?\n|,/);
  if (rawOrigins.length > 20) return null;

  const origins = new Set<string>();
  for (const rawOrigin of rawOrigins) {
    const raw = rawOrigin.trim();
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol)) return null;
      if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
      origins.add(parsed.origin);
    } catch {
      return null;
    }
  }
  return Array.from(origins);
}

export function isBrowserUrlAllowed(url: string, allowedOrigins: string[]): boolean {
  try {
    const origin = new URL(url).origin;
    return allowedOrigins.includes(origin);
  } catch {
    return false;
  }
}

export function shouldAutoApproveBrowserRequest(url: string, room: RoomRecord, activeHost: boolean): boolean {
  if (!activeHost || room.approvalPolicy !== "auto_browser_allowed_sites") return false;
  if (detectBrowserSecretRisks(url).length > 0) return false;
  return isBrowserUrlAllowed(url, room.browserAllowedOrigins ?? defaultBrowserAllowedOrigins);
}
