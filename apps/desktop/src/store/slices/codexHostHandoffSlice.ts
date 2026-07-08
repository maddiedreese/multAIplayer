import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type {
  CodexRoomEvent,
  HostHandoffRecord,
  PendingCodexApproval,
  RoomGoal
} from "../../types";
import type { AppStoreState } from "../appStore";

export interface CodexRuntimeRoomState {
  events?: CodexRoomEvent[];
  approvalVisible?: boolean;
  pendingApproval?: PendingCodexApproval;
  running?: boolean;
  goal?: RoomGoal;
  secretWarningVisible?: boolean;
  threadId?: string;
  hostHandoffs?: HostHandoffRecord[];
  continuation?: HostHandoffRecord;
}

export type CodexRuntimeByRoom = Record<string, CodexRuntimeRoomState>;

export interface CodexRuntimeMaps {
  codexEventsByRoom: Record<string, CodexRoomEvent[]>;
  approvalVisibleByRoom: Record<string, boolean>;
  pendingCodexApprovalsByRoom: Record<string, PendingCodexApproval>;
  codexRunningByRoom: Record<string, boolean>;
  roomGoalsByRoom: Record<string, RoomGoal>;
  secretWarningsVisibleByRoom: Record<string, boolean>;
  codexThreadIdsByRoom: Record<string, string>;
}

export function projectCodexRuntimeMaps(codexRuntimeByRoom: CodexRuntimeByRoom): CodexRuntimeMaps {
  const codexEventsByRoom: Record<string, CodexRoomEvent[]> = {};
  const approvalVisibleByRoom: Record<string, boolean> = {};
  const pendingCodexApprovalsByRoom: Record<string, PendingCodexApproval> = {};
  const codexRunningByRoom: Record<string, boolean> = {};
  const roomGoalsByRoom: Record<string, RoomGoal> = {};
  const secretWarningsVisibleByRoom: Record<string, boolean> = {};
  const codexThreadIdsByRoom: Record<string, string> = {};

  Object.entries(codexRuntimeByRoom).forEach(([roomId, runtime]) => {
    if (runtime.events) codexEventsByRoom[roomId] = runtime.events;
    if (runtime.approvalVisible) approvalVisibleByRoom[roomId] = true;
    if (runtime.pendingApproval) pendingCodexApprovalsByRoom[roomId] = runtime.pendingApproval;
    if (runtime.running) codexRunningByRoom[roomId] = true;
    if (runtime.goal) roomGoalsByRoom[roomId] = runtime.goal;
    if (runtime.secretWarningVisible) secretWarningsVisibleByRoom[roomId] = true;
    if (runtime.threadId) codexThreadIdsByRoom[roomId] = runtime.threadId;
  });

  return {
    codexEventsByRoom,
    approvalVisibleByRoom,
    pendingCodexApprovalsByRoom,
    codexRunningByRoom,
    roomGoalsByRoom,
    secretWarningsVisibleByRoom,
    codexThreadIdsByRoom
  };
}

function updateCodexRuntimeForRoom(
  current: CodexRuntimeByRoom,
  roomId: string,
  update: (roomRuntime: CodexRuntimeRoomState) => CodexRuntimeRoomState
): CodexRuntimeByRoom {
  const nextRoomRuntime = update(current[roomId] ?? {});
  if (Object.keys(nextRoomRuntime).length === 0) {
    return roomId in current ? omitRecordKey(current, roomId) : current;
  }
  return { ...current, [roomId]: nextRoomRuntime };
}

export interface CodexHostHandoffSlice {
  codexRuntimeByRoom: CodexRuntimeByRoom;
  appendHostHandoff: (roomId: string, handoff: HostHandoffRecord) => void;
  applyAcceptedHostHandoffForRoom: (roomId: string, handoff: HostHandoffRecord) => void;
  markHostHandoffAcceptedForRoom: (roomId: string, handoffId: string) => void;
  markLatestHostHandoffAcceptedForRoom: (roomId: string) => void;
  setCodexContinuationForRoom: (roomId: string, handoff: HostHandoffRecord | null) => void;
  appendCodexEvent: (roomId: string, event: CodexRoomEvent) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  setPendingCodexApprovalForRoom: (roomId: string, approval: PendingCodexApproval | null) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  setCodexRunningForRoom: (roomId: string, running: boolean) => void;
  setRoomGoalForRoom: (roomId: string, goal: RoomGoal | null) => void;
  setCodexThreadIdForRoom: (roomId: string, threadId: string | null) => void;
  setSecretWarningVisibleForRoom: (roomId: string, visible: boolean) => void;
}

export const emptyCodexHostHandoffState: Pick<CodexHostHandoffSlice, "codexRuntimeByRoom"> = {
  codexRuntimeByRoom: {}
};

export const createCodexHostHandoffSlice: StateCreator<AppStoreState, [], [], CodexHostHandoffSlice> = (set) => ({
  ...emptyCodexHostHandoffState,
  appendHostHandoff: (roomId, handoff) => {
    set((state) => {
      const roomHandoffs = state.codexRuntimeByRoom[roomId]?.hostHandoffs ?? [];
      if (roomHandoffs.some((existing) => existing.id === handoff.id)) return state;
      return {
        codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => ({
          ...roomRuntime,
          hostHandoffs: [...roomHandoffs, handoff]
        }))
      };
    });
  },
  applyAcceptedHostHandoffForRoom: (roomId, handoff) => {
    set((state) => {
      const acceptedHandoff: HostHandoffRecord = { ...handoff, status: "accepted" };
      const roomHandoffs = state.codexRuntimeByRoom[roomId]?.hostHandoffs ?? [];
      const existingIndex = roomHandoffs.findIndex((existing) => existing.id === handoff.id);
      const nextHandoffs = existingIndex >= 0
        ? roomHandoffs.map((existing) =>
            existing.id === handoff.id
              ? {
                  ...existing,
                  ...acceptedHandoff
                }
              : existing
          )
        : [...roomHandoffs, acceptedHandoff];
      return {
        codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => ({
          ...roomRuntime,
          hostHandoffs: nextHandoffs
        }))
      };
    });
  },
  markHostHandoffAcceptedForRoom: (roomId, handoffId) => {
    set((state) => {
      const roomHandoffs = state.codexRuntimeByRoom[roomId]?.hostHandoffs ?? [];
      if (!roomHandoffs.some((handoff) => handoff.id === handoffId)) return state;
      return {
        codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => ({
          ...roomRuntime,
          hostHandoffs: roomHandoffs.map((handoff) =>
            handoff.id === handoffId ? { ...handoff, status: "accepted" } : handoff
          )
        }))
      };
    });
  },
  markLatestHostHandoffAcceptedForRoom: (roomId) => {
    set((state) => {
      const roomHandoffs = state.codexRuntimeByRoom[roomId]?.hostHandoffs ?? [];
      const latestAvailable = [...roomHandoffs].reverse().find((handoff) => handoff.status === "available");
      if (!latestAvailable) return state;
      return {
        codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => ({
          ...roomRuntime,
          hostHandoffs: roomHandoffs.map((handoff) =>
            handoff.id === latestAvailable.id ? { ...handoff, status: "accepted" } : handoff
          )
        }))
      };
    });
  },
  setCodexContinuationForRoom: (roomId, handoff) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const { continuation: _continuation, ...rest } = roomRuntime;
        return handoff ? { ...rest, continuation: handoff } : rest;
      })
    }));
  },
  appendCodexEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.codexRuntimeByRoom[roomId]?.events ?? [];
      if (
        roomEvents.some((existing) =>
          existing.turnId === event.turnId &&
          existing.createdAt === event.createdAt &&
          existing.status === event.status &&
          existing.message === event.message
        )
      ) {
        return state;
      }
      return {
        codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => ({
          ...roomRuntime,
          events: [...roomEvents, event].slice(-80)
        }))
      };
    });
  },
  setApprovalVisibleForRoom: (roomId, visible) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const { approvalVisible: _approvalVisible, ...rest } = roomRuntime;
        return visible ? { ...rest, approvalVisible: true } : rest;
      })
    }));
  },
  setPendingCodexApprovalForRoom: (roomId, approval) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const { pendingApproval: _pendingApproval, ...rest } = roomRuntime;
        return approval ? { ...rest, pendingApproval: approval } : rest;
      })
    }));
  },
  resetCodexApprovalForRoom: (roomId) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const {
          pendingApproval: _pendingApproval,
          approvalVisible: _approvalVisible,
          ...rest
        } = roomRuntime;
        return rest;
      })
    }));
  },
  setCodexRunningForRoom: (roomId, running) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const { running: _running, ...rest } = roomRuntime;
        return running ? { ...rest, running: true } : rest;
      })
    }));
  },
  setRoomGoalForRoom: (roomId, goal) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const { goal: _goal, ...rest } = roomRuntime;
        return goal ? { ...rest, goal } : rest;
      })
    }));
  },
  setCodexThreadIdForRoom: (roomId, threadId) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const { threadId: _threadId, ...rest } = roomRuntime;
        return threadId ? { ...rest, threadId } : rest;
      })
    }));
  },
  setSecretWarningVisibleForRoom: (roomId, visible) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const { secretWarningVisible: _secretWarningVisible, ...rest } = roomRuntime;
        return visible ? { ...rest, secretWarningVisible: true } : rest;
      })
    }));
  }
});
