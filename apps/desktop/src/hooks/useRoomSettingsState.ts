import { useMemo } from "react";
import { useAppStore } from "../store/appStore";

export function useRoomSettingsState() {
  const roomSettingsByRoom = useAppStore((state) => state.roomSettingsByRoom);

  const {
    hostBusyByRoom,
    hostMessagesByRoom,
    settingsBusyByRoom,
    settingsMessagesByRoom,
    customCodexModelsByRoom,
    projectPathDraftsByRoom
  } = useMemo(() => ({
    hostBusyByRoom: Object.fromEntries(
      Object.entries(roomSettingsByRoom)
        .filter(([, settings]) => settings.hostBusy)
        .map(([roomId]) => [roomId, true])
    ),
    hostMessagesByRoom: Object.fromEntries(
      Object.entries(roomSettingsByRoom)
        .filter(([, settings]) => settings.hostMessage)
        .map(([roomId, settings]) => [roomId, settings.hostMessage ?? null])
    ),
    settingsBusyByRoom: Object.fromEntries(
      Object.entries(roomSettingsByRoom)
        .filter(([, settings]) => settings.settingsBusy)
        .map(([roomId]) => [roomId, true])
    ),
    settingsMessagesByRoom: Object.fromEntries(
      Object.entries(roomSettingsByRoom)
        .filter(([, settings]) => settings.settingsMessage)
        .map(([roomId, settings]) => [roomId, settings.settingsMessage ?? null])
    ),
    customCodexModelsByRoom: Object.fromEntries(
      Object.entries(roomSettingsByRoom)
        .filter(([, settings]) => settings.customCodexModel)
        .map(([roomId, settings]) => [roomId, settings.customCodexModel ?? ""])
    ),
    projectPathDraftsByRoom: Object.fromEntries(
      Object.entries(roomSettingsByRoom)
        .filter(([, settings]) => settings.projectPathDraft)
        .map(([roomId, settings]) => [roomId, settings.projectPathDraft ?? ""])
    )
  }), [roomSettingsByRoom]);

  return {
    roomSettingsByRoom,
    hostBusyByRoom,
    hostMessagesByRoom,
    settingsBusyByRoom,
    settingsMessagesByRoom,
    customCodexModelsByRoom,
    projectPathDraftsByRoom
  };
}
