import { useAppStore } from "../store/appStore";

export function useRoomSettingsState() {
  const hostBusyByRoom = useAppStore((state) => state.hostBusyByRoom);
  const hostMessagesByRoom = useAppStore((state) => state.hostMessagesByRoom);
  const settingsBusyByRoom = useAppStore((state) => state.settingsBusyByRoom);
  const settingsMessagesByRoom = useAppStore((state) => state.settingsMessagesByRoom);
  const customCodexModelsByRoom = useAppStore((state) => state.customCodexModelsByRoom);
  const projectPathDraftsByRoom = useAppStore((state) => state.projectPathDraftsByRoom);

  return {
    hostBusyByRoom,
    hostMessagesByRoom,
    settingsBusyByRoom,
    settingsMessagesByRoom,
    customCodexModelsByRoom,
    projectPathDraftsByRoom
  };
}
