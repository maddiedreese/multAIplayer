import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type { AppStoreState } from "../appStore";

export interface RoomSettingsRoomState {
  hostBusy?: boolean;
  hostMessage?: string;
  settingsBusy?: boolean;
  settingsMessage?: string;
  customCodexModel?: string;
  projectPathDraft?: string;
}

export type RoomSettingsByRoom = Record<string, RoomSettingsRoomState>;

function compactRoomSettings(record: RoomSettingsRoomState): RoomSettingsRoomState | undefined {
  return Object.keys(record).length ? record : undefined;
}

function updateRoomSettingsForRoom(
  current: RoomSettingsByRoom,
  roomId: string,
  update: (roomSettings: RoomSettingsRoomState) => RoomSettingsRoomState
): RoomSettingsByRoom {
  const nextRoomSettings = compactRoomSettings(update(current[roomId] ?? {}));
  if (!nextRoomSettings) return omitRecordKey(current, roomId);
  return {
    ...current,
    [roomId]: nextRoomSettings
  };
}

export interface RoomSettingsSlice {
  roomSettingsByRoom: RoomSettingsByRoom;
  setHostBusyForRoom: (roomId: string, busy: boolean) => void;
  setSettingsBusyForRoom: (roomId: string, busy: boolean) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setSettingsMessageForRoom: (roomId: string, message: string | null) => void;
  setCustomCodexModelForRoom: (roomId: string, model: string, currentModel: string) => void;
  setProjectPathDraftForRoom: (roomId: string, projectPath: string, currentProjectPath: string) => void;
}

export const emptyRoomSettingsState: Pick<
  RoomSettingsSlice,
  "roomSettingsByRoom"
> = {
  roomSettingsByRoom: {}
};

export const createRoomSettingsSlice: StateCreator<AppStoreState, [], [], RoomSettingsSlice> = (set) => ({
  ...emptyRoomSettingsState,
  setHostBusyForRoom: (roomId, busy) => {
    set((state) => ({
      roomSettingsByRoom: updateRoomSettingsForRoom(state.roomSettingsByRoom, roomId, (roomSettings) => {
        const { hostBusy, ...rest } = roomSettings;
        return busy ? { ...roomSettings, hostBusy: true } : rest;
      })
    }));
  },
  setSettingsBusyForRoom: (roomId, busy) => {
    set((state) => ({
      roomSettingsByRoom: updateRoomSettingsForRoom(state.roomSettingsByRoom, roomId, (roomSettings) => {
        const { settingsBusy, ...rest } = roomSettings;
        return busy ? { ...roomSettings, settingsBusy: true } : rest;
      })
    }));
  },
  setHostMessageForRoom: (roomId, message) => {
    set((state) => ({
      roomSettingsByRoom: updateRoomSettingsForRoom(state.roomSettingsByRoom, roomId, (roomSettings) => {
        const { hostMessage, ...rest } = roomSettings;
        return message ? { ...roomSettings, hostMessage: message } : rest;
      })
    }));
  },
  setSettingsMessageForRoom: (roomId, message) => {
    set((state) => ({
      roomSettingsByRoom: updateRoomSettingsForRoom(state.roomSettingsByRoom, roomId, (roomSettings) => {
        const { settingsMessage, ...rest } = roomSettings;
        return message ? { ...roomSettings, settingsMessage: message } : rest;
      })
    }));
  },
  setCustomCodexModelForRoom: (roomId, model, currentModel) => {
    set((state) => ({
      roomSettingsByRoom: updateRoomSettingsForRoom(state.roomSettingsByRoom, roomId, (roomSettings) => {
        const { customCodexModel, ...rest } = roomSettings;
        return model === currentModel ? rest : { ...roomSettings, customCodexModel: model };
      })
    }));
  },
  setProjectPathDraftForRoom: (roomId, projectPath, currentProjectPath) => {
    set((state) => ({
      roomSettingsByRoom: updateRoomSettingsForRoom(state.roomSettingsByRoom, roomId, (roomSettings) => {
        const { projectPathDraft, ...rest } = roomSettings;
        return projectPath === currentProjectPath ? rest : { ...roomSettings, projectPathDraft: projectPath };
      })
    }));
  }
});
