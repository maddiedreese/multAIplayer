import {
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultCodexModelPolicy,
  defaultCodexReasoningEffort,
  defaultCodexReasoningEffortPolicy,
  defaultCodexRawReasoningEnabled,
  defaultCodexSandboxLevel,
  defaultCodexSpeed,
  defaultCodexServiceTierPolicy,
  type ClientRoomRecord,
  type RoomConfig,
  type RoomRecord
} from "@multaiplayer/protocol";

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
    codexModelPolicy: config?.codexModelPolicy ?? defaultCodexModelPolicy,
    codexReasoningEffort: config?.codexReasoningEffort ?? defaultCodexReasoningEffort,
    codexReasoningEffortPolicy: config?.codexReasoningEffortPolicy ?? defaultCodexReasoningEffortPolicy,
    codexSpeed: config?.codexSpeed ?? defaultCodexSpeed,
    codexServiceTierPolicy: config?.codexServiceTierPolicy ?? defaultCodexServiceTierPolicy
  };
}
