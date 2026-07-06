import { useState } from "react";

export function useRoomSettingsState() {
  const [hostBusyByRoom, setHostBusyByRoom] = useState<Record<string, boolean>>({});
  const [hostMessagesByRoom, setHostMessagesByRoom] = useState<Record<string, string | null>>({});
  const [settingsBusyByRoom, setSettingsBusyByRoom] = useState<Record<string, boolean>>({});
  const [settingsMessagesByRoom, setSettingsMessagesByRoom] = useState<Record<string, string | null>>({});
  const [customCodexModelsByRoom, setCustomCodexModelsByRoom] = useState<Record<string, string>>({});
  const [projectPathDraftsByRoom, setProjectPathDraftsByRoom] = useState<Record<string, string>>({});

  return {
    hostBusyByRoom,
    setHostBusyByRoom,
    hostMessagesByRoom,
    setHostMessagesByRoom,
    settingsBusyByRoom,
    setSettingsBusyByRoom,
    settingsMessagesByRoom,
    setSettingsMessagesByRoom,
    customCodexModelsByRoom,
    setCustomCodexModelsByRoom,
    projectPathDraftsByRoom,
    setProjectPathDraftsByRoom
  };
}
