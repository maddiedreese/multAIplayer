import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type { AppStoreState } from "../appStore";

type HostBusyByRoom = Record<string, boolean>;
type HostMessagesByRoom = Record<string, string | null>;
type SettingsBusyByRoom = Record<string, boolean>;
type SettingsMessagesByRoom = Record<string, string | null>;
type CustomCodexModelsByRoom = Record<string, string>;
type ProjectPathDraftsByRoom = Record<string, string>;
type RoomBusyByRoom = Record<string, boolean>;

function updateRoomBusyMap(current: RoomBusyByRoom, roomId: string, busy: boolean): RoomBusyByRoom {
  return busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId);
}

export interface RoomSettingsSlice {
  hostBusyByRoom: HostBusyByRoom;
  hostMessagesByRoom: HostMessagesByRoom;
  settingsBusyByRoom: SettingsBusyByRoom;
  settingsMessagesByRoom: SettingsMessagesByRoom;
  customCodexModelsByRoom: CustomCodexModelsByRoom;
  projectPathDraftsByRoom: ProjectPathDraftsByRoom;
  setHostBusyForRoom: (roomId: string, busy: boolean) => void;
  setSettingsBusyForRoom: (roomId: string, busy: boolean) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setSettingsMessageForRoom: (roomId: string, message: string | null) => void;
  setCustomCodexModelForRoom: (roomId: string, model: string, currentModel: string) => void;
  setProjectPathDraftForRoom: (roomId: string, projectPath: string, currentProjectPath: string) => void;
}

export const emptyRoomSettingsState: Pick<
  RoomSettingsSlice,
  | "hostBusyByRoom"
  | "hostMessagesByRoom"
  | "settingsBusyByRoom"
  | "settingsMessagesByRoom"
  | "customCodexModelsByRoom"
  | "projectPathDraftsByRoom"
> = {
  hostBusyByRoom: {},
  hostMessagesByRoom: {},
  settingsBusyByRoom: {},
  settingsMessagesByRoom: {},
  customCodexModelsByRoom: {},
  projectPathDraftsByRoom: {}
};

export const createRoomSettingsSlice: StateCreator<AppStoreState, [], [], RoomSettingsSlice> = (set) => ({
  ...emptyRoomSettingsState,
  setHostBusyForRoom: (roomId, busy) => {
    set((state) => ({
      hostBusyByRoom: updateRoomBusyMap(state.hostBusyByRoom, roomId, busy)
    }));
  },
  setSettingsBusyForRoom: (roomId, busy) => {
    set((state) => ({
      settingsBusyByRoom: updateRoomBusyMap(state.settingsBusyByRoom, roomId, busy)
    }));
  },
  setHostMessageForRoom: (roomId, message) => {
    set((state) => ({
      hostMessagesByRoom: message
        ? { ...state.hostMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.hostMessagesByRoom, roomId)
    }));
  },
  setSettingsMessageForRoom: (roomId, message) => {
    set((state) => ({
      settingsMessagesByRoom: message
        ? { ...state.settingsMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.settingsMessagesByRoom, roomId)
    }));
  },
  setCustomCodexModelForRoom: (roomId, model, currentModel) => {
    set((state) => ({
      customCodexModelsByRoom: model === currentModel
        ? omitRecordKey(state.customCodexModelsByRoom, roomId)
        : { ...state.customCodexModelsByRoom, [roomId]: model }
    }));
  },
  setProjectPathDraftForRoom: (roomId, projectPath, currentProjectPath) => {
    set((state) => ({
      projectPathDraftsByRoom: projectPath === currentProjectPath
        ? omitRecordKey(state.projectPathDraftsByRoom, roomId)
        : { ...state.projectPathDraftsByRoom, [roomId]: projectPath }
    }));
  }
});
