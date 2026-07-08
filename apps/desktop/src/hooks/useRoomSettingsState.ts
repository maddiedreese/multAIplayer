import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { projectRoomSettingsPanelMaps } from "../store/slices/roomSettingsSlice";

export function useRoomSettingsState() {
  const roomSettingsByRoom = useAppStore((state) => state.roomSettingsByRoom);

  const {
    hostBusyByRoom,
    hostMessagesByRoom,
    settingsBusyByRoom,
    settingsMessagesByRoom,
    customCodexModelsByRoom,
    projectPathDraftsByRoom
  } = useMemo(() => projectRoomSettingsPanelMaps(roomSettingsByRoom), [roomSettingsByRoom]);

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
