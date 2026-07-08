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

export interface TerminalRoomState {
  lines?: string[];
  busy?: boolean;
  requests?: TerminalCommandRequest[];
  selectedTerminalId?: string;
  ui?: TerminalRoomUiState;
}

export type TerminalRuntimeByRoom = Record<string, TerminalRoomState>;

function updateTerminalRuntimeForRoom(
  current: TerminalRuntimeByRoom,
  roomId: string,
  update: (roomTerminal: TerminalRoomState) => TerminalRoomState
): TerminalRuntimeByRoom {
  const nextRoomTerminal = update(current[roomId] ?? {});
  if (Object.keys(nextRoomTerminal).length === 0) return omitRecordKey(current, roomId);
  return { ...current, [roomId]: nextRoomTerminal };
}

function updateTerminalUiForRoomState(
  roomTerminal: TerminalRoomState,
  update: (roomUi: TerminalRoomUiState) => TerminalRoomUiState
): TerminalRoomState {
  const nextUi = update(roomTerminal.ui ?? {});
  const { ui: _ui, ...rest } = roomTerminal;
  return Object.keys(nextUi).length > 0 ? { ...rest, ui: nextUi } : rest;
}

export function projectTerminalRuntimeLinesByRoom(terminalRuntimeByRoom: TerminalRuntimeByRoom): TerminalLinesByRoom {
  return Object.fromEntries(
    Object.entries(terminalRuntimeByRoom)
      .filter(([, terminal]) => terminal.lines)
      .map(([roomId, terminal]) => [roomId, terminal.lines ?? []])
  );
}

export function projectTerminalRuntimeBusyByRoom(terminalRuntimeByRoom: TerminalRuntimeByRoom): TerminalBusyByRoom {
  return Object.fromEntries(
    Object.entries(terminalRuntimeByRoom)
      .filter(([, terminal]) => terminal.busy)
      .map(([roomId]) => [roomId, true])
  );
}

export function projectTerminalRuntimeRequestsByRoom(terminalRuntimeByRoom: TerminalRuntimeByRoom): TerminalRequestsByRoom {
  return Object.fromEntries(
    Object.entries(terminalRuntimeByRoom)
      .filter(([, terminal]) => terminal.requests)
      .map(([roomId, terminal]) => [roomId, terminal.requests ?? []])
  );
}

export function projectSelectedTerminalRuntimeIdsByRoom(terminalRuntimeByRoom: TerminalRuntimeByRoom): SelectedTerminalIdsByRoom {
  return Object.fromEntries(
    Object.entries(terminalRuntimeByRoom)
      .filter(([, terminal]) => terminal.selectedTerminalId)
      .map(([roomId, terminal]) => [roomId, terminal.selectedTerminalId ?? null])
  );
}

export function projectTerminalRuntimeUiByRoom(terminalRuntimeByRoom: TerminalRuntimeByRoom): TerminalUiByRoom {
  return Object.fromEntries(
    Object.entries(terminalRuntimeByRoom)
      .filter(([, terminal]) => terminal.ui)
      .map(([roomId, terminal]) => [roomId, terminal.ui ?? {}])
  );
}

export interface TerminalSlice {
  terminalRuntimeByRoom: TerminalRuntimeByRoom;
  terminals: Terminals;
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
  | "terminalRuntimeByRoom"
  | "terminals"
> = {
  terminalRuntimeByRoom: {},
  terminals: []
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
      Object.values(state.terminalRuntimeByRoom).every((terminal) => !terminal.lines)
        ? {
            terminalRuntimeByRoom: Object.fromEntries(
              Object.entries(linesByRoom).map(([roomId, lines]) => [
                roomId,
                {
                  ...state.terminalRuntimeByRoom[roomId],
                  lines
                }
              ])
            )
          }
        : state
    ));
  },
  setTerminalBusyForRoom: (roomId, busy) => {
    set((state) => ({
      terminalRuntimeByRoom: updateTerminalRuntimeForRoom(state.terminalRuntimeByRoom, roomId, (roomTerminal) => {
        const { busy: _busy, ...rest } = roomTerminal;
        return busy ? { ...rest, busy: true } : rest;
      })
    }));
  },
  appendTerminalRequest: (roomId, request) => {
    set((state) => {
      const roomRequests = state.terminalRuntimeByRoom[roomId]?.requests ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return state;
      return {
        terminalRuntimeByRoom: updateTerminalRuntimeForRoom(state.terminalRuntimeByRoom, roomId, (roomTerminal) => ({
          ...roomTerminal,
          requests: [...roomRequests, request]
        }))
      };
    });
  },
  updateTerminalRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      terminalRuntimeByRoom: updateTerminalRuntimeForRoom(state.terminalRuntimeByRoom, roomId, (roomTerminal) => ({
        ...roomTerminal,
        requests: (roomTerminal.requests ?? []).map((request) =>
          request.id === requestId ? { ...request, status } : request
        )
      }))
    }));
  },
  setSelectedTerminalIdForRoom: (roomId, terminalId) => {
    set((state) => ({
      terminalRuntimeByRoom: updateTerminalRuntimeForRoom(state.terminalRuntimeByRoom, roomId, (roomTerminal) => {
        const { selectedTerminalId: _selectedTerminalId, ...rest } = roomTerminal;
        return terminalId ? { ...rest, selectedTerminalId: terminalId } : rest;
      })
    }));
  },
  setTerminalNameForRoom: (roomId, name) => {
    set((state) => ({
      terminalRuntimeByRoom: updateTerminalRuntimeForRoom(state.terminalRuntimeByRoom, roomId, (roomTerminal) => updateTerminalUiForRoomState(roomTerminal, (roomUi) => {
        const { name: _name, ...rest } = roomUi;
        return name === "dev-server" ? rest : { ...rest, name };
      }))
    }));
  },
  setTerminalCommandForRoom: (roomId, command) => {
    set((state) => ({
      terminalRuntimeByRoom: updateTerminalRuntimeForRoom(state.terminalRuntimeByRoom, roomId, (roomTerminal) => updateTerminalUiForRoomState(roomTerminal, (roomUi) => {
        const { command: _command, ...rest } = roomUi;
        return command === "npm run dev:desktop" ? rest : { ...rest, command };
      }))
    }));
  },
  setTerminalInputForRoom: (roomId, input) => {
    set((state) => ({
      terminalRuntimeByRoom: updateTerminalRuntimeForRoom(state.terminalRuntimeByRoom, roomId, (roomTerminal) => updateTerminalUiForRoomState(roomTerminal, (roomUi) => {
        const { input: _input, ...rest } = roomUi;
        return input ? { ...rest, input } : rest;
      }))
    }));
  },
  setTerminalErrorForRoom: (roomId, error) => {
    set((state) => ({
      terminalRuntimeByRoom: updateTerminalRuntimeForRoom(state.terminalRuntimeByRoom, roomId, (roomTerminal) => updateTerminalUiForRoomState(roomTerminal, (roomUi) => {
        const { error: _error, ...rest } = roomUi;
        return error ? { ...rest, error } : rest;
      }))
    }));
  },
  appendTerminalLinesForRoom: (roomId, lines, maxTerminalActivityLines) => {
    if (lines.length === 0) return;
    set((state) => ({
      terminalRuntimeByRoom: updateTerminalRuntimeForRoom(state.terminalRuntimeByRoom, roomId, (roomTerminal) => ({
        ...roomTerminal,
        lines: [...(roomTerminal.lines ?? []), ...lines].slice(-maxTerminalActivityLines)
      }))
    }));
  }
});
