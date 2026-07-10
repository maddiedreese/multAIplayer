import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultApprovalDelegationPolicy,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed,
  legacyCodexCatalogSelectionPolicy,
  type RoomRecord
} from "@multaiplayer/protocol";
import { normalizeBrowserAllowedOrigins } from "./browserPolicy";

export function ensureRoomDefaults(room: RoomRecord): RoomRecord {
  return {
    ...room,
    name: normalizeRoomDisplayName(room.name),
    codexModel: room.codexModel || defaultCodexModel,
    codexModelPolicy: room.codexModelPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexReasoningEffort: room.codexReasoningEffort ?? defaultCodexReasoningEffort,
    codexReasoningEffortPolicy: room.codexReasoningEffortPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexSpeed: room.codexSpeed ?? defaultCodexSpeed,
    codexServiceTierPolicy: room.codexServiceTierPolicy ?? legacyCodexCatalogSelectionPolicy,
    codexSandboxLevel: room.codexSandboxLevel ?? defaultCodexSandboxLevel,
    approvalDelegationPolicy: room.approvalDelegationPolicy ?? defaultApprovalDelegationPolicy,
    trustedApproverUserIds: Array.isArray(room.trustedApproverUserIds) ? room.trustedApproverUserIds : [],
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
