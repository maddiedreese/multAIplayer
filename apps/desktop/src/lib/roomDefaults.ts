import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultApprovalDelegationPolicy,
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
import { normalizeBrowserAllowedOrigins } from "./browserPolicy";

export function ensureRoomDefaults(
  room: RoomRecord & Partial<RoomConfig>,
  previous?: ClientRoomRecord
): ClientRoomRecord {
  const hasMlsConfig = typeof room.projectPath === "string" && room.projectPath.length > 0;
  const config = hasMlsConfig ? room : previous;
  return {
    ...(previous ?? {}),
    ...room,
    projectPath: config?.projectPath ?? "",
    codexModel: config?.codexModel || defaultCodexModel,
    codexModelPolicy: config?.codexModelPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexReasoningEffort: config?.codexReasoningEffort ?? defaultCodexReasoningEffort,
    codexReasoningEffortPolicy: config?.codexReasoningEffortPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexRawReasoningEnabled: config?.codexRawReasoningEnabled ?? defaultCodexRawReasoningEnabled,
    codexSpeed: config?.codexSpeed ?? defaultCodexSpeed,
    codexServiceTierPolicy: config?.codexServiceTierPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexSandboxLevel: config?.codexSandboxLevel ?? defaultCodexSandboxLevel,
    configRevision: config?.configRevision ?? 0,
    configEpoch: config?.configEpoch ?? 0,
    configPending: hasMlsConfig ? (room.configPending ?? false) : (previous?.configPending ?? true),
    approvalDelegationPolicy: room.approvalDelegationPolicy ?? defaultApprovalDelegationPolicy,
    trustedApproverUserIds: Array.isArray(room.trustedApproverUserIds) ? room.trustedApproverUserIds : [],
    browserAllowedOrigins:
      normalizeBrowserAllowedOrigins(room.browserAllowedOrigins ?? defaultBrowserAllowedOrigins) ??
      defaultBrowserAllowedOrigins,
    browserProfilePersistent:
      typeof room.browserProfilePersistent === "boolean"
        ? room.browserProfilePersistent
        : defaultBrowserProfilePersistent
  };
}
