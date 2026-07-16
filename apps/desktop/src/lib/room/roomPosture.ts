type HistorySettingsLike = {
  enabled: boolean;
  retentionDays: number;
};

export function roomPostureSummary({
  locked,
  isActiveHost,
  canReadLocalWorkspace,
  historySettings
}: {
  locked: boolean;
  isActiveHost: boolean;
  canReadLocalWorkspace: boolean;
  historySettings: HistorySettingsLike;
}): {
  hostAccess: string;
  workspaceAccess: string;
  history: string;
  browserSession: string;
} {
  return {
    hostAccess: locked ? "Locked on this device" : isActiveHost ? "This device is host" : "Host approval required",
    workspaceAccess: canReadLocalWorkspace ? "Shared with room" : "Locked on this device",
    history: historySettings.enabled ? `Encrypted, ${historySettings.retentionDays} days` : "Disabled",
    browserSession: "Private session per open"
  };
}
