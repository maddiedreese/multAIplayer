type HistorySettingsLike = {
  enabled: boolean;
  retentionDays: number;
};

export function roomPostureSummary({
  locked,
  isActiveHost,
  canReadLocalWorkspace,
  historySettings,
  browserProfilePersistent
}: {
  locked: boolean;
  isActiveHost: boolean;
  canReadLocalWorkspace: boolean;
  historySettings: HistorySettingsLike;
  browserProfilePersistent: boolean;
}): {
  hostAccess: string;
  workspaceAccess: string;
  history: string;
  browserProfile: string;
} {
  return {
    hostAccess: locked ? "Locked on this device" : isActiveHost ? "This device is host" : "Host approval required",
    workspaceAccess: canReadLocalWorkspace ? "Shared with room" : "Locked on this device",
    history: historySettings.enabled ? `Encrypted, ${historySettings.retentionDays} days` : "Disabled",
    browserProfile: browserProfilePersistent ? "Persists per room" : "Refreshes before opens"
  };
}
