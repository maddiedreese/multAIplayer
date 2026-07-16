import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexRawReasoningEnabled,
  defaultCodexSandboxLevel,
  defaultCodexSpeed,
  legacyCodexCatalogSelectionPolicy,
  type ClientRoomRecord,
  type RoomConfig,
  type RoomRecord
} from "@multaiplayer/protocol";
import { normalizeBrowserAllowedOrigins } from "../browser/browserPolicy";

export function ensureRoomDefaults(
  room: RoomRecord & Partial<RoomConfig>,
  previous?: ClientRoomRecord
): ClientRoomRecord {
  const hasMlsConfig = typeof room.projectPath === "string" && room.projectPath.length > 0;
  const config = hasMlsConfig ? room : previous;
  return {
    ...(previous ?? {}),
    ...room,
    ...roomMlsConfig(config),
    configPending: hasMlsConfig ? (room.configPending ?? false) : (previous?.configPending ?? true),
    browserAllowedOrigins:
      normalizeBrowserAllowedOrigins(room.browserAllowedOrigins ?? defaultBrowserAllowedOrigins) ??
      defaultBrowserAllowedOrigins,
    browserProfilePersistent:
      typeof room.browserProfilePersistent === "boolean"
        ? room.browserProfilePersistent
        : defaultBrowserProfilePersistent
  };
}

function roomMlsConfig(config: Partial<RoomConfig> | undefined): Omit<RoomConfig, "configPending"> {
  return {
    projectPath: config?.projectPath ?? "",
    ...codexCatalogConfig(config),
    codexRawReasoningEnabled: config?.codexRawReasoningEnabled ?? defaultCodexRawReasoningEnabled,
    codexSandboxLevel: config?.codexSandboxLevel ?? defaultCodexSandboxLevel,
    configRevision: config?.configRevision ?? 0,
    configEpoch: config?.configEpoch ?? 0
  };
}

function codexCatalogConfig(config: Partial<RoomConfig> | undefined) {
  return {
    codexModel: config?.codexModel || defaultCodexModel,
    codexModelPolicy: config?.codexModelPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexReasoningEffort: config?.codexReasoningEffort ?? defaultCodexReasoningEffort,
    codexReasoningEffortPolicy: config?.codexReasoningEffortPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexSpeed: config?.codexSpeed ?? defaultCodexSpeed,
    codexServiceTierPolicy: config?.codexServiceTierPolicy ?? legacyCodexCatalogSelectionPolicy
  };
}
