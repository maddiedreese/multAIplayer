import type { StateCreator } from "zustand";
import type { InspectorTab } from "../../components/RoomInspectorPanel";
import { omitRecordKey } from "../../lib/setUtils";
import type { ChatMessage, RoomPresence } from "../../types";
import type { AppStoreState } from "../appStore";

export type HistorySearchMessagesByRoom = Record<string, ChatMessage[]>;
export type HistoryMessagesByRoom = Record<string, string | null>;
export type TeamHistoryMessagesByTeam = Record<string, string | null>;
export type InspectorTabByRoom = Record<string, InspectorTab>;
export type PresenceByRoom = Record<string, Record<string, RoomPresence>>;

export interface HistoryPresenceRoomState {
  searchMessages?: ChatMessage[];
  historyMessage?: string;
  inspectorTab?: InspectorTab;
  presence?: Record<string, RoomPresence>;
}

export interface TeamHistoryState {
  message?: string;
}

export type HistoryPresenceByRoom = Record<string, HistoryPresenceRoomState>;
export type TeamHistoryByTeam = Record<string, TeamHistoryState>;

function normalizeInspectorTab(tab: InspectorTab | "diff" | undefined): InspectorTab {
  return tab === "diff" || !tab ? "files" : tab;
}

function updateHistoryPresenceForRoom(
  current: HistoryPresenceByRoom,
  roomId: string,
  update: (roomState: HistoryPresenceRoomState) => HistoryPresenceRoomState
): HistoryPresenceByRoom {
  const nextRoomState = update(current[roomId] ?? {});
  return {
    ...current,
    [roomId]: nextRoomState
  };
}

function removeEmptyHistoryPresenceRooms(current: HistoryPresenceByRoom): HistoryPresenceByRoom {
  return Object.fromEntries(
    Object.entries(current).filter(([, roomState]) => Object.keys(roomState).length > 0)
  );
}

export function projectHistorySearchMessagesByRoom(
  historyPresenceByRoom: HistoryPresenceByRoom
): HistorySearchMessagesByRoom {
  return Object.fromEntries(
    Object.entries(historyPresenceByRoom)
      .filter(([, roomState]) => roomState.searchMessages)
      .map(([roomId, roomState]) => [roomId, roomState.searchMessages ?? []])
  );
}

export function historySearchEntriesToMessagesByRoom(
  entries: ReadonlyArray<readonly [string, readonly ChatMessage[]]>
): HistorySearchMessagesByRoom {
  return Object.fromEntries(
    entries
      .filter(([, roomMessages]) => roomMessages.length > 0)
      .map(([roomId, roomMessages]) => [roomId, [...roomMessages]])
  );
}

export function projectHistoryMessagesByRoom(historyPresenceByRoom: HistoryPresenceByRoom): HistoryMessagesByRoom {
  return Object.fromEntries(
    Object.entries(historyPresenceByRoom)
      .filter(([, roomState]) => roomState.historyMessage)
      .map(([roomId, roomState]) => [roomId, roomState.historyMessage ?? null])
  );
}

export function projectInspectorTabsByRoom(historyPresenceByRoom: HistoryPresenceByRoom): InspectorTabByRoom {
  return Object.fromEntries(
    Object.entries(historyPresenceByRoom)
      .filter(([, roomState]) => roomState.inspectorTab)
      .map(([roomId, roomState]) => [roomId, normalizeInspectorTab(roomState.inspectorTab as InspectorTab | "diff" | undefined)])
  );
}

export function projectPresenceByRoom(historyPresenceByRoom: HistoryPresenceByRoom): PresenceByRoom {
  return Object.fromEntries(
    Object.entries(historyPresenceByRoom)
      .filter(([, roomState]) => roomState.presence)
      .map(([roomId, roomState]) => [roomId, roomState.presence ?? {}])
  );
}

export function projectTeamHistoryMessagesByTeam(teamHistoryByTeam: TeamHistoryByTeam): TeamHistoryMessagesByTeam {
  return Object.fromEntries(
    Object.entries(teamHistoryByTeam)
      .filter(([, teamState]) => teamState.message)
      .map(([teamId, teamState]) => [teamId, teamState.message ?? null])
  );
}

export interface HistoryPresenceSlice {
  historyPresenceByRoom: HistoryPresenceByRoom;
  teamHistoryByTeam: TeamHistoryByTeam;
  setHistorySearchResultsByRoom: (messagesByRoom: HistorySearchMessagesByRoom) => void;
  clearHistorySearchResults: () => void;
  setHistoryMessageForRoom: (roomId: string, message: string | null) => void;
  setTeamHistoryMessageForTeam: (teamId: string, message: string | null) => void;
  setInspectorTabForRoom: (roomId: string, tab: InspectorTab) => void;
  clearPresenceByRoom: () => void;
  clearPresenceForRoom: (roomId: string) => void;
  setRoomPresenceForDevice: (roomId: string, deviceId: string, presence: RoomPresence | null) => void;
}

export const emptyHistoryPresenceState: Pick<
  HistoryPresenceSlice,
  | "historyPresenceByRoom"
  | "teamHistoryByTeam"
> = {
  historyPresenceByRoom: {},
  teamHistoryByTeam: {}
};

export const createHistoryPresenceSlice: StateCreator<AppStoreState, [], [], HistoryPresenceSlice> = (set) => ({
  ...emptyHistoryPresenceState,
  setHistorySearchResultsByRoom: (messagesByRoom) => {
    set((state) => ({
      historyPresenceByRoom: removeEmptyHistoryPresenceRooms({
        ...Object.fromEntries(
          Object.entries(state.historyPresenceByRoom).map(([roomId, roomState]) => {
            const { searchMessages: _searchMessages, ...rest } = roomState;
            return [roomId, rest];
          })
        ),
        ...Object.fromEntries(
          Object.entries(messagesByRoom).map(([roomId, searchMessages]) => [
            roomId,
            {
              ...state.historyPresenceByRoom[roomId],
              searchMessages
            }
          ])
        )
      })
    }));
  },
  clearHistorySearchResults: () => {
    set((state) => ({
      historyPresenceByRoom: removeEmptyHistoryPresenceRooms(
        Object.fromEntries(
          Object.entries(state.historyPresenceByRoom).map(([roomId, roomState]) => {
            const { searchMessages: _searchMessages, ...rest } = roomState;
            return [roomId, rest];
          })
        )
      )
    }));
  },
  setHistoryMessageForRoom: (roomId, message) => {
    set((state) => ({
      historyPresenceByRoom: removeEmptyHistoryPresenceRooms(updateHistoryPresenceForRoom(
        state.historyPresenceByRoom,
        roomId,
        (roomState) => {
          const { historyMessage: _historyMessage, ...rest } = roomState;
          return message ? { ...rest, historyMessage: message } : rest;
        }
      ))
    }));
  },
  setTeamHistoryMessageForTeam: (teamId, message) => {
    const key = teamId || "__no-team";
    set((state) => ({
      teamHistoryByTeam: message
        ? {
            ...state.teamHistoryByTeam,
            [key]: { message }
          }
        : omitRecordKey(state.teamHistoryByTeam, key)
    }));
  },
  setInspectorTabForRoom: (roomId, tab) => {
    set((state) => ({
      historyPresenceByRoom: updateHistoryPresenceForRoom(state.historyPresenceByRoom, roomId, (roomState) => ({
        ...roomState,
        inspectorTab: tab
      }))
    }));
  },
  clearPresenceByRoom: () => {
    set((state) => ({
      historyPresenceByRoom: removeEmptyHistoryPresenceRooms(
        Object.fromEntries(
          Object.entries(state.historyPresenceByRoom).map(([roomId, roomState]) => {
            const { presence: _presence, ...rest } = roomState;
            return [roomId, rest];
          })
        )
      )
    }));
  },
  clearPresenceForRoom: (roomId) => {
    set((state) => ({
      historyPresenceByRoom: removeEmptyHistoryPresenceRooms(updateHistoryPresenceForRoom(
        state.historyPresenceByRoom,
        roomId,
        (roomState) => {
          const { presence: _presence, ...rest } = roomState;
          return rest;
        }
      ))
    }));
  },
  setRoomPresenceForDevice: (roomId, deviceId, presence) => {
    set((state) => {
      const roomPresence = state.historyPresenceByRoom[roomId]?.presence ?? {};
      const nextRoomPresence = presence
        ? { ...roomPresence, [deviceId]: presence }
        : omitRecordKey(roomPresence, deviceId);
      return {
        historyPresenceByRoom: updateHistoryPresenceForRoom(state.historyPresenceByRoom, roomId, (roomState) => ({
          ...roomState,
          presence: nextRoomPresence
        }))
      };
    });
  }
});
