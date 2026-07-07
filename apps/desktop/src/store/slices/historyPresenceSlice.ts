import type { StateCreator } from "zustand";
import type { InspectorTab } from "../../components/RoomInspectorPanel";
import { omitRecordKey } from "../../lib/setUtils";
import type { ChatMessage, RoomPresence } from "../../types";
import type { AppStoreState } from "../appStore";

type HistorySearchMessagesByRoom = Record<string, ChatMessage[]>;
type HistoryMessagesByRoom = Record<string, string | null>;
type TeamHistoryMessagesByTeam = Record<string, string | null>;
type InspectorTabsByRoom = Record<string, InspectorTab>;
type PresenceByRoom = Record<string, Record<string, RoomPresence>>;

export interface HistoryPresenceSlice {
  historySearchMessagesByRoom: HistorySearchMessagesByRoom;
  historyMessagesByRoom: HistoryMessagesByRoom;
  teamHistoryMessagesByTeam: TeamHistoryMessagesByTeam;
  inspectorTabsByRoom: InspectorTabsByRoom;
  presenceByRoom: PresenceByRoom;
  replaceHistorySearchMessagesByRoom: (messagesByRoom: HistorySearchMessagesByRoom) => void;
  setHistoryMessageForRoom: (roomId: string, message: string | null) => void;
  setTeamHistoryMessageForTeam: (teamId: string, message: string | null) => void;
  setInspectorTabForRoom: (roomId: string, tab: InspectorTab) => void;
  clearPresenceByRoom: () => void;
  clearPresenceForRoom: (roomId: string) => void;
  setRoomPresenceForDevice: (roomId: string, deviceId: string, presence: RoomPresence | null) => void;
}

export const emptyHistoryPresenceState: Pick<
  HistoryPresenceSlice,
  | "historySearchMessagesByRoom"
  | "historyMessagesByRoom"
  | "teamHistoryMessagesByTeam"
  | "inspectorTabsByRoom"
  | "presenceByRoom"
> = {
  historySearchMessagesByRoom: {},
  historyMessagesByRoom: {},
  teamHistoryMessagesByTeam: {},
  inspectorTabsByRoom: {},
  presenceByRoom: {}
};

export const createHistoryPresenceSlice: StateCreator<AppStoreState, [], [], HistoryPresenceSlice> = (set) => ({
  ...emptyHistoryPresenceState,
  replaceHistorySearchMessagesByRoom: (messagesByRoom) => {
    set({ historySearchMessagesByRoom: messagesByRoom });
  },
  setHistoryMessageForRoom: (roomId, message) => {
    set((state) => ({
      historyMessagesByRoom: message
        ? { ...state.historyMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.historyMessagesByRoom, roomId)
    }));
  },
  setTeamHistoryMessageForTeam: (teamId, message) => {
    const key = teamId || "__no-team";
    set((state) => ({
      teamHistoryMessagesByTeam: message
        ? { ...state.teamHistoryMessagesByTeam, [key]: message }
        : omitRecordKey(state.teamHistoryMessagesByTeam, key)
    }));
  },
  setInspectorTabForRoom: (roomId, tab) => {
    set((state) => ({
      inspectorTabsByRoom: {
        ...state.inspectorTabsByRoom,
        [roomId]: tab
      }
    }));
  },
  clearPresenceByRoom: () => {
    set({ presenceByRoom: {} });
  },
  clearPresenceForRoom: (roomId) => {
    set((state) => ({
      presenceByRoom: omitRecordKey(state.presenceByRoom, roomId)
    }));
  },
  setRoomPresenceForDevice: (roomId, deviceId, presence) => {
    set((state) => {
      const roomPresence = state.presenceByRoom[roomId] ?? {};
      const nextRoomPresence = presence
        ? { ...roomPresence, [deviceId]: presence }
        : omitRecordKey(roomPresence, deviceId);
      return {
        presenceByRoom: {
          ...state.presenceByRoom,
          [roomId]: nextRoomPresence
        }
      };
    });
  }
});
