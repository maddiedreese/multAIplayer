import { useAppStore } from "../store/appStore";

export function useRoomSettingsState() {
  const hostBusyByRoom = useAppStore((state) => state.hostBusyByRoom);
  const setHostBusyByRoom = useAppStore((state) => state.setHostBusyByRoom);
  const hostMessagesByRoom = useAppStore((state) => state.hostMessagesByRoom);
  const setHostMessagesByRoom = useAppStore((state) => state.setHostMessagesByRoom);
  const settingsBusyByRoom = useAppStore((state) => state.settingsBusyByRoom);
  const setSettingsBusyByRoom = useAppStore((state) => state.setSettingsBusyByRoom);
  const settingsMessagesByRoom = useAppStore((state) => state.settingsMessagesByRoom);
  const setSettingsMessagesByRoom = useAppStore((state) => state.setSettingsMessagesByRoom);
  const customCodexModelsByRoom = useAppStore((state) => state.customCodexModelsByRoom);
  const setCustomCodexModelsByRoom = useAppStore((state) => state.setCustomCodexModelsByRoom);
  const projectPathDraftsByRoom = useAppStore((state) => state.projectPathDraftsByRoom);
  const setProjectPathDraftsByRoom = useAppStore((state) => state.setProjectPathDraftsByRoom);

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
