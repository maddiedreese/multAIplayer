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
  type RoomRecord
} from "@multaiplayer/protocol";
import { normalizeBrowserAllowedOrigins } from "./browserPolicy";

export function ensureRoomDefaults(room: RoomRecord): RoomRecord {
  return {
    ...room,
    codexModel: room.codexModel || defaultCodexModel,
    codexModelPolicy: room.codexModelPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexReasoningEffort: room.codexReasoningEffort ?? defaultCodexReasoningEffort,
    codexReasoningEffortPolicy: room.codexReasoningEffortPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexRawReasoningEnabled: room.codexRawReasoningEnabled ?? defaultCodexRawReasoningEnabled,
    codexSpeed: room.codexSpeed ?? defaultCodexSpeed,
    codexServiceTierPolicy: room.codexServiceTierPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexSandboxLevel: room.codexSandboxLevel ?? defaultCodexSandboxLevel,
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
