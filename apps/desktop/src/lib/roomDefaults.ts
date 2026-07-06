import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  type RoomRecord
} from "@multaiplayer/protocol";
import { normalizeBrowserAllowedOrigins } from "./browserPolicy";

export function ensureRoomDefaults(room: RoomRecord): RoomRecord {
  return {
    ...room,
    name: normalizeRoomDisplayName(room.name),
    codexModel: room.codexModel || defaultCodexModel,
    browserAllowedOrigins: normalizeBrowserAllowedOrigins(room.browserAllowedOrigins ?? defaultBrowserAllowedOrigins) ?? defaultBrowserAllowedOrigins,
    browserProfilePersistent: typeof room.browserProfilePersistent === "boolean"
      ? room.browserProfilePersistent
      : defaultBrowserProfilePersistent
  };
}

function normalizeRoomDisplayName(name: string): string {
  if (name === "Relay + E2EE") return "Relay ops";
  if (name === "Desktop client") return "Desktop app";
  return name;
}
