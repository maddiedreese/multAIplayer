import type { StateCreator } from "zustand";
import { maxCodexActivitiesPerRoom } from "@multaiplayer/protocol";
import { omitRecordKey } from "../../lib/setUtils";
import { legacyCodexThreadGraph, mergeCodexThreadGraph } from "../../lib/codexThreadGraph";
import type {
  CodexRoomEvent,
  CodexActivity,
  CodexThreadGraph,
  CodexThreadGraphNode,
  HostHandoffRecord,
  PendingCodexApproval,
  QueuedCodexTurn,
  RoomGoal
} from "../../types";
import type { AppStoreState } from "../appStore";

export interface CodexRuntimeRoomState {
  events?: CodexRoomEvent[];
  activities?: CodexActivity[];
  approvalVisible?: boolean;
  pendingApproval?: PendingCodexApproval;
  queuedApprovals?: QueuedCodexTurn[];
  running?: boolean;
  goal?: RoomGoal;
  secretWarningVisible?: boolean;
  threadGraph?: CodexThreadGraph;
  /** Legacy mirror; threadGraph.activeThreadId is authoritative. */
  threadId?: string;
  hostHandoffs?: HostHandoffRecord[];
  continuation?: HostHandoffRecord;
}

export type CodexRuntimeByRoom = Record<string, CodexRuntimeRoomState>;

export interface CodexRuntimeMaps {
  codexEventsByRoom: Record<string, CodexRoomEvent[]>;
  codexActivitiesByRoom: Record<string, CodexActivity[]>;
  approvalVisibleByRoom: Record<string, boolean>;
  pendingCodexApprovalsByRoom: Record<string, PendingCodexApproval>;
  queuedCodexApprovalsByRoom: Record<string, QueuedCodexTurn[]>;
  codexRunningByRoom: Record<string, boolean>;
  roomGoalsByRoom: Record<string, RoomGoal>;
  secretWarningsVisibleByRoom: Record<string, boolean>;
  codexThreadIdsByRoom: Record<string, string>;
  codexThreadGraphsByRoom: Record<string, CodexThreadGraph>;
}

export interface CodexHostHandoffMaps {
  hostHandoffsByRoom: Record<string, HostHandoffRecord[]>;
  codexContinuationByRoom: Record<string, HostHandoffRecord>;
}

export function projectCodexRuntimeMaps(codexRuntimeByRoom: CodexRuntimeByRoom): CodexRuntimeMaps {
  const codexEventsByRoom: Record<string, CodexRoomEvent[]> = {};
  const codexActivitiesByRoom: Record<string, CodexActivity[]> = {};
  const approvalVisibleByRoom: Record<string, boolean> = {};
  const pendingCodexApprovalsByRoom: Record<string, PendingCodexApproval> = {};
  const queuedCodexApprovalsByRoom: Record<string, QueuedCodexTurn[]> = {};
  const codexRunningByRoom: Record<string, boolean> = {};
  const roomGoalsByRoom: Record<string, RoomGoal> = {};
  const secretWarningsVisibleByRoom: Record<string, boolean> = {};
  const codexThreadIdsByRoom: Record<string, string> = {};
  const codexThreadGraphsByRoom: Record<string, CodexThreadGraph> = {};

  Object.entries(codexRuntimeByRoom).forEach(([roomId, runtime]) => {
    if (runtime.events) codexEventsByRoom[roomId] = runtime.events;
    if (runtime.activities) codexActivitiesByRoom[roomId] = runtime.activities;
    if (runtime.approvalVisible) approvalVisibleByRoom[roomId] = true;
    if (runtime.pendingApproval) pendingCodexApprovalsByRoom[roomId] = runtime.pendingApproval;
    if (runtime.queuedApprovals?.length) queuedCodexApprovalsByRoom[roomId] = runtime.queuedApprovals;
    if (runtime.running) codexRunningByRoom[roomId] = true;
    if (runtime.goal) roomGoalsByRoom[roomId] = runtime.goal;
    if (runtime.secretWarningVisible) secretWarningsVisibleByRoom[roomId] = true;
    if (runtime.threadGraph) {
      codexThreadGraphsByRoom[roomId] = runtime.threadGraph;
      if (runtime.threadGraph.activeThreadId) codexThreadIdsByRoom[roomId] = runtime.threadGraph.activeThreadId;
    } else if (runtime.threadId) codexThreadIdsByRoom[roomId] = runtime.threadId;
  });

  return {
    codexEventsByRoom,
    codexActivitiesByRoom,
    approvalVisibleByRoom,
    pendingCodexApprovalsByRoom,
    queuedCodexApprovalsByRoom,
    codexRunningByRoom,
    roomGoalsByRoom,
    secretWarningsVisibleByRoom,
    codexThreadIdsByRoom,
    codexThreadGraphsByRoom
  };
}

export function projectCodexHostHandoffMaps(codexRuntimeByRoom: CodexRuntimeByRoom): CodexHostHandoffMaps {
  const hostHandoffsByRoom: Record<string, HostHandoffRecord[]> = {};
  const codexContinuationByRoom: Record<string, HostHandoffRecord> = {};

  Object.entries(codexRuntimeByRoom).forEach(([roomId, runtime]) => {
    if (runtime.hostHandoffs) hostHandoffsByRoom[roomId] = runtime.hostHandoffs;
    if (runtime.continuation) codexContinuationByRoom[roomId] = runtime.continuation;
  });

  return {
    hostHandoffsByRoom,
    codexContinuationByRoom
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
  upsertCodexActivity: (roomId: string, activity: CodexActivity) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  setPendingCodexApprovalForRoom: (roomId: string, approval: PendingCodexApproval | null) => void;
  enqueueCodexApprovalForRoom: (roomId: string, turn: QueuedCodexTurn) => void;
  removeQueuedCodexApprovalForRoom: (roomId: string, turnId: string) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  setCodexRunningForRoom: (roomId: string, running: boolean) => void;
  setRoomGoalForRoom: (roomId: string, goal: RoomGoal | null) => void;
  setCodexThreadIdForRoom: (roomId: string, threadId: string | null) => void;
  mergeCodexThreadsForRoom: (roomId: string, nodes: CodexThreadGraphNode[]) => void;
  addCodexForkForRoom: (roomId: string, node: CodexThreadGraphNode) => void;
  setActiveCodexThreadForRoom: (roomId: string, threadId: string) => void;
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
      const nextHandoffs =
        existingIndex >= 0
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
        roomEvents.some(
          (existing) =>
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
  upsertCodexActivity: (roomId, activity) => {
    set((state) => {
      const activities = state.codexRuntimeByRoom[roomId]?.activities ?? [];
      const index = activities.findIndex((existing) => existing.activityId === activity.activityId);
      const next =
        index < 0
          ? [...activities, activity]
          : activities.map((existing, current) =>
              current === index && activity.updatedAt >= existing.updatedAt
                ? { ...existing, ...activity, startedAt: existing.startedAt }
                : existing
            );
      return {
        codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (runtime) => ({
          ...runtime,
          activities: next.slice(-maxCodexActivitiesPerRoom)
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
        const { pendingApproval: _pendingApproval, queuedApprovals, ...rest } = roomRuntime;
        const nextQueue =
          approval && queuedApprovals?.length
            ? queuedApprovals.filter((queued) => queued.turnId !== approval.turnId)
            : queuedApprovals;
        return {
          ...rest,
          ...(nextQueue?.length ? { queuedApprovals: nextQueue } : {}),
          ...(approval ? { pendingApproval: approval } : {})
        };
      })
    }));
  },
  enqueueCodexApprovalForRoom: (roomId, turn) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const queuedApprovals = roomRuntime.queuedApprovals ?? [];
        if (
          roomRuntime.pendingApproval?.turnId === turn.turnId ||
          queuedApprovals.some((queued) => queued.turnId === turn.turnId)
        ) {
          return roomRuntime;
        }
        return {
          ...roomRuntime,
          queuedApprovals: [...queuedApprovals, turn].slice(0, 5)
        };
      })
    }));
  },
  removeQueuedCodexApprovalForRoom: (roomId, turnId) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const queuedApprovals = (roomRuntime.queuedApprovals ?? []).filter((approval) => approval.turnId !== turnId);
        const { queuedApprovals: _queuedApprovals, ...rest } = roomRuntime;
        return queuedApprovals.length ? { ...rest, queuedApprovals } : rest;
      })
    }));
  },
  resetCodexApprovalForRoom: (roomId) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (roomRuntime) => {
        const {
          pendingApproval: _pendingApproval,
          approvalVisible: _approvalVisible,
          queuedApprovals: _queuedApprovals,
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
        const { threadGraph: _threadGraph, threadId: _threadId, ...rest } = roomRuntime;
        if (!threadId) return rest;
        const graph = roomRuntime.threadGraph ?? legacyCodexThreadGraph(null);
        const existing = graph.nodesById[threadId];
        return {
          ...rest,
          threadId,
          threadGraph: {
            activeThreadId: threadId,
            nodesById: {
              ...graph.nodesById,
              [threadId]: existing ?? {
                id: threadId,
                title: "Codex thread",
                status: "unknown",
                createdAt: 0,
                updatedAt: 0
              }
            }
          }
        };
      })
    }));
  },
  mergeCodexThreadsForRoom: (roomId, nodes) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (runtime) => ({
        ...runtime,
        threadGraph: mergeCodexThreadGraph(
          runtime.threadGraph ?? legacyCodexThreadGraph(runtime.threadId ?? null),
          nodes
        )
      }))
    }));
  },
  addCodexForkForRoom: (roomId, node) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (runtime) => {
        const graph = runtime.threadGraph ?? legacyCodexThreadGraph(runtime.threadId ?? null);
        if (!graph.activeThreadId || node.parentThreadId !== graph.activeThreadId) return runtime;
        return {
          ...runtime,
          threadId: node.id,
          threadGraph: { activeThreadId: node.id, nodesById: { ...graph.nodesById, [node.id]: node } }
        };
      })
    }));
  },
  setActiveCodexThreadForRoom: (roomId, threadId) => {
    set((state) => ({
      codexRuntimeByRoom: updateCodexRuntimeForRoom(state.codexRuntimeByRoom, roomId, (runtime) => {
        const graph = runtime.threadGraph;
        if (!graph?.nodesById[threadId]) return runtime;
        return { ...runtime, threadId, threadGraph: { ...graph, activeThreadId: threadId } };
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
