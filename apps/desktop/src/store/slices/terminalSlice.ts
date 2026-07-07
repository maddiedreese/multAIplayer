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
type TerminalNamesByRoom = Record<string, string>;
type TerminalCommandsByRoom = Record<string, string>;
type TerminalInputsByRoom = Record<string, string>;
type TerminalErrorsByRoom = Record<string, string | null>;

export interface TerminalSlice {
  terminalLinesByRoom: TerminalLinesByRoom;
  terminalBusyByRoom: TerminalBusyByRoom;
  terminals: Terminals;
  terminalRequestsByRoom: TerminalRequestsByRoom;
  selectedTerminalIdsByRoom: SelectedTerminalIdsByRoom;
  terminalNamesByRoom: TerminalNamesByRoom;
  terminalCommandsByRoom: TerminalCommandsByRoom;
  terminalInputsByRoom: TerminalInputsByRoom;
  terminalErrorsByRoom: TerminalErrorsByRoom;
  clearTerminalSnapshots: () => void;
  replaceTerminalSnapshotsForRoom: (roomId: string, snapshots: Terminals) => void;
  upsertTerminalSnapshot: (snapshot: TerminalSnapshot) => void;
  initializeTerminalLinesByRoom: (linesByRoom: TerminalLinesByRoom) => void;
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
  | "terminalNamesByRoom"
  | "terminalCommandsByRoom"
  | "terminalInputsByRoom"
  | "terminalErrorsByRoom"
> = {
  terminalLinesByRoom: {},
  terminalBusyByRoom: {},
  terminals: [],
  terminalRequestsByRoom: {},
  selectedTerminalIdsByRoom: {},
  terminalNamesByRoom: {},
  terminalCommandsByRoom: {},
  terminalInputsByRoom: {},
  terminalErrorsByRoom: {}
};

export const createTerminalSlice: StateCreator<AppStoreState, [], [], TerminalSlice> = (set) => ({
  ...emptyTerminalState,
  clearTerminalSnapshots: () => {
    set({ terminals: [] });
  },
  replaceTerminalSnapshotsForRoom: (roomId, snapshots) => {
    set((state) => ({
      terminals: replaceRoomTerminalSnapshots(state.terminals, roomId, snapshots)
    }));
  },
  upsertTerminalSnapshot: (snapshot) => {
    set((state) => ({
      terminals: upsertTerminal(state.terminals, snapshot)
    }));
  },
  initializeTerminalLinesByRoom: (linesByRoom) => {
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
      terminalNamesByRoom: name === "dev-server"
        ? omitRecordKey(state.terminalNamesByRoom, roomId)
        : { ...state.terminalNamesByRoom, [roomId]: name }
    }));
  },
  setTerminalCommandForRoom: (roomId, command) => {
    set((state) => ({
      terminalCommandsByRoom: command === "npm run dev:desktop"
        ? omitRecordKey(state.terminalCommandsByRoom, roomId)
        : { ...state.terminalCommandsByRoom, [roomId]: command }
    }));
  },
  setTerminalInputForRoom: (roomId, input) => {
    set((state) => ({
      terminalInputsByRoom: input
        ? { ...state.terminalInputsByRoom, [roomId]: input }
        : omitRecordKey(state.terminalInputsByRoom, roomId)
    }));
  },
  setTerminalErrorForRoom: (roomId, error) => {
    set((state) => ({
      terminalErrorsByRoom: error
        ? { ...state.terminalErrorsByRoom, [roomId]: error }
        : omitRecordKey(state.terminalErrorsByRoom, roomId)
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
