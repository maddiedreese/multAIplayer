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
  notificationsMuted?: boolean;
}

export type RoomSettingsByRoom = Record<string, RoomSettingsRoomState>;

export interface RoomSettingsPanelMaps {
  hostBusyByRoom: Record<string, boolean>;
  hostMessagesByRoom: Record<string, string | null>;
  settingsBusyByRoom: Record<string, boolean>;
  settingsMessagesByRoom: Record<string, string | null>;
  customCodexModelsByRoom: Record<string, string>;
  projectPathDraftsByRoom: Record<string, string>;
  notificationMutedRoomIds: Set<string>;
}

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

export function projectRoomSettingsPanelMaps(roomSettingsByRoom: RoomSettingsByRoom): RoomSettingsPanelMaps {
  return {
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
    ),
    notificationMutedRoomIds: new Set(
      Object.entries(roomSettingsByRoom)
        .filter(([, settings]) => settings.notificationsMuted)
        .map(([roomId]) => roomId)
    )
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
  setRoomNotificationsMuted: (roomId: string, muted: boolean) => void;
}

export const emptyRoomSettingsState: Pick<RoomSettingsSlice, "roomSettingsByRoom"> = {
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
  },
  setRoomNotificationsMuted: (roomId, muted) => {
    set((state) => ({
      roomSettingsByRoom: updateRoomSettingsForRoom(state.roomSettingsByRoom, roomId, (roomSettings) => {
        const { notificationsMuted, ...rest } = roomSettings;
        return muted ? { ...roomSettings, notificationsMuted: true } : rest;
      })
    }));
  }
});
