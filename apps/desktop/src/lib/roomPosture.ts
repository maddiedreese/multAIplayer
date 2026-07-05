import type { RoomMode } from "@multaiplayer/protocol";

type HistorySettingsLike = {
  enabled: boolean;
  retentionDays: number;
};

const modeOrder: Array<keyof RoomMode> = ["chat", "code", "workspace", "browser"];
const modeLabels: Record<keyof RoomMode, string> = {
  chat: "Chat",
  code: "Code",
  workspace: "Workspace",
  browser: "Browser"
};

export function formatActiveRoomModes(mode: RoomMode): string {
  const active = modeOrder.filter((key) => mode[key]).map((key) => modeLabels[key]);
  return active.length ? active.join(", ") : "No modes enabled";
}

export function roomPostureSummary({
  locked,
  isActiveHost,
  canReadLocalWorkspace,
  historySettings,
  browserProfilePersistent,
  mode
}: {
  locked: boolean;
  isActiveHost: boolean;
  canReadLocalWorkspace: boolean;
  historySettings: HistorySettingsLike;
  browserProfilePersistent: boolean;
  mode: RoomMode;
}): {
  hostAccess: string;
  workspaceAccess: string;
  history: string;
  browserProfile: string;
  modes: string;
} {
  return {
    hostAccess: locked ? "Locked on this device" : isActiveHost ? "This device is host" : "Host approval required",
    workspaceAccess: canReadLocalWorkspace ? "Local project readable" : "No local workspace access",
    history: historySettings.enabled ? `Encrypted, ${historySettings.retentionDays} days` : "Disabled",
    browserProfile: browserProfilePersistent ? "Persists per room" : "Refreshes before opens",
    modes: formatActiveRoomModes(mode)
  };
}
