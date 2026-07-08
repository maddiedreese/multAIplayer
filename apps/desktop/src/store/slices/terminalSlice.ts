import type { StateCreator } from "zustand";
import type { TerminalSnapshot } from "../../lib/localBackend";
import { omitRecordKey } from "../../lib/setUtils";
import { replaceRoomTerminalSnapshots, upsertTerminal } from "../../lib/terminalState";
import type { TerminalCommandRequest } from "../../types";
import type { AppStoreState } from "../appStore";

type TerminalLinesByRoom = Record<string, string[]>;
type TerminalBusyByRoom = Record<string, boolean>;
type Terminals = TerminalSnapshot[];
type TerminalRequestsByRoom = Record<string, TerminalCommandRequest[]>;
type SelectedTerminalIdsByRoom = Record<string, string | null>;

export interface TerminalRoomUiState {
  name?: string;
  command?: string;
  input?: string;
  error?: string;
}

export type TerminalUiByRoom = Record<string, TerminalRoomUiState>;

function updateTerminalUiForRoom(
  current: TerminalUiByRoom,
  roomId: string,
  update: (roomUi: TerminalRoomUiState) => TerminalRoomUiState
): TerminalUiByRoom {
  const nextRoomUi = update(current[roomId] ?? {});
  if (Object.keys(nextRoomUi).length === 0) return omitRecordKey(current, roomId);
  return { ...current, [roomId]: nextRoomUi };
}

export interface TerminalSlice {
  terminalLinesByRoom: TerminalLinesByRoom;
  terminalBusyByRoom: TerminalBusyByRoom;
  terminals: Terminals;
  terminalRequestsByRoom: TerminalRequestsByRoom;
  selectedTerminalIdsByRoom: SelectedTerminalIdsByRoom;
  terminalUiByRoom: TerminalUiByRoom;
  clearTerminalSnapshots: () => void;
  clearTerminalSnapshotsForRoom: (roomId: string) => void;
  syncTerminalSnapshotsForRoom: (roomId: string, snapshots: Terminals) => void;
  upsertTerminalSnapshot: (snapshot: TerminalSnapshot) => void;
  seedInitialTerminalLines: (linesByRoom: TerminalLinesByRoom) => void;
  setTerminalBusyForRoom: (roomId: string, busy: boolean) => void;
  appendTerminalRequest: (roomId: string, request: TerminalCommandRequest) => void;
  updateTerminalRequestStatus: (roomId: string, requestId: string, status: TerminalCommandRequest["status"]) => void;
  setSelectedTerminalIdForRoom: (roomId: string, terminalId: string | null) => void;
  setTerminalNameForRoom: (roomId: string, name: string) => void;
  setTerminalCommandForRoom: (roomId: string, command: string) => void;
  setTerminalInputForRoom: (roomId: string, input: string) => void;
  setTerminalErrorForRoom: (roomId: string, error: string | null) => void;
  appendTerminalLinesForRoom: (roomId: string, lines: string[], maxTerminalActivityLines: number) => void;
}

export const emptyTerminalState: Pick<
  TerminalSlice,
  | "terminalLinesByRoom"
  | "terminalBusyByRoom"
  | "terminals"
  | "terminalRequestsByRoom"
  | "selectedTerminalIdsByRoom"
  | "terminalUiByRoom"
> = {
  terminalLinesByRoom: {},
  terminalBusyByRoom: {},
  terminals: [],
  terminalRequestsByRoom: {},
  selectedTerminalIdsByRoom: {},
  terminalUiByRoom: {}
};

export const createTerminalSlice: StateCreator<AppStoreState, [], [], TerminalSlice> = (set) => ({
  ...emptyTerminalState,
  clearTerminalSnapshots: () => {
    set({ terminals: [] });
  },
  clearTerminalSnapshotsForRoom: (roomId) => {
    set((state) => ({
      terminals: replaceRoomTerminalSnapshots(state.terminals, roomId, [])
    }));
  },
  syncTerminalSnapshotsForRoom: (roomId, snapshots) => {
    set((state) => ({
      terminals: replaceRoomTerminalSnapshots(state.terminals, roomId, snapshots)
    }));
  },
  upsertTerminalSnapshot: (snapshot) => {
    set((state) => ({
      terminals: upsertTerminal(state.terminals, snapshot)
    }));
  },
  seedInitialTerminalLines: (linesByRoom) => {
    if (Object.keys(linesByRoom).length === 0) return;
    set((state) => (
      Object.keys(state.terminalLinesByRoom).length === 0
        ? { terminalLinesByRoom: linesByRoom }
        : state
    ));
  },
  setTerminalBusyForRoom: (roomId, busy) => {
    set((state) => ({
      terminalBusyByRoom: busy
        ? { ...state.terminalBusyByRoom, [roomId]: true }
        : omitRecordKey(state.terminalBusyByRoom, roomId)
    }));
  },
  appendTerminalRequest: (roomId, request) => {
    set((state) => {
      const roomRequests = state.terminalRequestsByRoom[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return state;
      return {
        terminalRequestsByRoom: {
          ...state.terminalRequestsByRoom,
          [roomId]: [...roomRequests, request]
        }
      };
    });
  },
  updateTerminalRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      terminalRequestsByRoom: {
        ...state.terminalRequestsByRoom,
        [roomId]: (state.terminalRequestsByRoom[roomId] ?? []).map((request) =>
          request.id === requestId ? { ...request, status } : request
        )
      }
    }));
  },
  setSelectedTerminalIdForRoom: (roomId, terminalId) => {
    set((state) => ({
      selectedTerminalIdsByRoom: terminalId
        ? { ...state.selectedTerminalIdsByRoom, [roomId]: terminalId }
        : omitRecordKey(state.selectedTerminalIdsByRoom, roomId)
    }));
  },
  setTerminalNameForRoom: (roomId, name) => {
    set((state) => ({
      terminalUiByRoom: updateTerminalUiForRoom(state.terminalUiByRoom, roomId, (roomUi) => {
        const { name: _name, ...rest } = roomUi;
        return name === "dev-server" ? rest : { ...rest, name };
      })
    }));
  },
  setTerminalCommandForRoom: (roomId, command) => {
    set((state) => ({
      terminalUiByRoom: updateTerminalUiForRoom(state.terminalUiByRoom, roomId, (roomUi) => {
        const { command: _command, ...rest } = roomUi;
        return command === "npm run dev:desktop" ? rest : { ...rest, command };
      })
    }));
  },
  setTerminalInputForRoom: (roomId, input) => {
    set((state) => ({
      terminalUiByRoom: updateTerminalUiForRoom(state.terminalUiByRoom, roomId, (roomUi) => {
        const { input: _input, ...rest } = roomUi;
        return input ? { ...rest, input } : rest;
      })
    }));
  },
  setTerminalErrorForRoom: (roomId, error) => {
    set((state) => ({
      terminalUiByRoom: updateTerminalUiForRoom(state.terminalUiByRoom, roomId, (roomUi) => {
        const { error: _error, ...rest } = roomUi;
        return error ? { ...rest, error } : rest;
      })
    }));
  },
  appendTerminalLinesForRoom: (roomId, lines, maxTerminalActivityLines) => {
    if (lines.length === 0) return;
    set((state) => ({
      terminalLinesByRoom: {
        ...state.terminalLinesByRoom,
        [roomId]: [...(state.terminalLinesByRoom[roomId] ?? []), ...lines].slice(-maxTerminalActivityLines)
      }
    }));
  }
});
