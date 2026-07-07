import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type {
  CodexRoomEvent,
  HostHandoffRecord,
  PendingCodexApproval,
  RoomGoal
} from "../../types";
import type { AppStoreState } from "../appStore";

type CodexEventsByRoom = Record<string, CodexRoomEvent[]>;
type ApprovalVisibleByRoom = Record<string, boolean>;
type PendingCodexApprovalsByRoom = Record<string, PendingCodexApproval>;
type CodexRunningByRoom = Record<string, boolean>;
type RoomGoalsByRoom = Record<string, RoomGoal>;
type SecretWarningsVisibleByRoom = Record<string, boolean>;
type CodexThreadIdsByRoom = Record<string, string>;
type HostHandoffsByRoom = Record<string, HostHandoffRecord[]>;
type CodexContinuationByRoom = Record<string, HostHandoffRecord>;

export interface CodexHostHandoffSlice {
  codexEventsByRoom: CodexEventsByRoom;
  approvalVisibleByRoom: ApprovalVisibleByRoom;
  pendingCodexApprovalsByRoom: PendingCodexApprovalsByRoom;
  codexRunningByRoom: CodexRunningByRoom;
  roomGoalsByRoom: RoomGoalsByRoom;
  secretWarningsVisibleByRoom: SecretWarningsVisibleByRoom;
  codexThreadIdsByRoom: CodexThreadIdsByRoom;
  hostHandoffsByRoom: HostHandoffsByRoom;
  codexContinuationByRoom: CodexContinuationByRoom;
  appendHostHandoff: (roomId: string, handoff: HostHandoffRecord) => void;
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

export const emptyCodexHostHandoffState: Pick<
  CodexHostHandoffSlice,
  | "codexEventsByRoom"
  | "approvalVisibleByRoom"
  | "pendingCodexApprovalsByRoom"
  | "codexRunningByRoom"
  | "roomGoalsByRoom"
  | "secretWarningsVisibleByRoom"
  | "codexThreadIdsByRoom"
  | "hostHandoffsByRoom"
  | "codexContinuationByRoom"
> = {
  codexEventsByRoom: {},
  approvalVisibleByRoom: {},
  pendingCodexApprovalsByRoom: {},
  codexRunningByRoom: {},
  roomGoalsByRoom: {},
  secretWarningsVisibleByRoom: {},
  codexThreadIdsByRoom: {},
  hostHandoffsByRoom: {},
  codexContinuationByRoom: {}
};

export const createCodexHostHandoffSlice: StateCreator<AppStoreState, [], [], CodexHostHandoffSlice> = (set) => ({
  ...emptyCodexHostHandoffState,
  appendHostHandoff: (roomId, handoff) => {
    set((state) => {
      const roomHandoffs = state.hostHandoffsByRoom[roomId] ?? [];
      if (roomHandoffs.some((existing) => existing.id === handoff.id)) return state;
      return {
        hostHandoffsByRoom: {
          ...state.hostHandoffsByRoom,
          [roomId]: [...roomHandoffs, handoff]
        }
      };
    });
  },
  markHostHandoffAcceptedForRoom: (roomId, handoffId) => {
    set((state) => {
      const roomHandoffs = state.hostHandoffsByRoom[roomId] ?? [];
      if (!roomHandoffs.some((handoff) => handoff.id === handoffId)) return state;
      return {
        hostHandoffsByRoom: {
          ...state.hostHandoffsByRoom,
          [roomId]: roomHandoffs.map((handoff) =>
            handoff.id === handoffId ? { ...handoff, status: "accepted" } : handoff
          )
        }
      };
    });
  },
  markLatestHostHandoffAcceptedForRoom: (roomId) => {
    set((state) => {
      const roomHandoffs = state.hostHandoffsByRoom[roomId] ?? [];
      const latestAvailable = [...roomHandoffs].reverse().find((handoff) => handoff.status === "available");
      if (!latestAvailable) return state;
      return {
        hostHandoffsByRoom: {
          ...state.hostHandoffsByRoom,
          [roomId]: roomHandoffs.map((handoff) =>
            handoff.id === latestAvailable.id ? { ...handoff, status: "accepted" } : handoff
          )
        }
      };
    });
  },
  setCodexContinuationForRoom: (roomId, handoff) => {
    set((state) => ({
      codexContinuationByRoom: handoff
        ? { ...state.codexContinuationByRoom, [roomId]: handoff }
        : omitRecordKey(state.codexContinuationByRoom, roomId)
    }));
  },
  appendCodexEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.codexEventsByRoom[roomId] ?? [];
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
        codexEventsByRoom: {
          ...state.codexEventsByRoom,
          [roomId]: [...roomEvents, event].slice(-80)
        }
      };
    });
  },
  setApprovalVisibleForRoom: (roomId, visible) => {
    set((state) => ({
      approvalVisibleByRoom: visible
        ? { ...state.approvalVisibleByRoom, [roomId]: true }
        : omitRecordKey(state.approvalVisibleByRoom, roomId)
    }));
  },
  setPendingCodexApprovalForRoom: (roomId, approval) => {
    set((state) => ({
      pendingCodexApprovalsByRoom: approval
        ? { ...state.pendingCodexApprovalsByRoom, [roomId]: approval }
        : omitRecordKey(state.pendingCodexApprovalsByRoom, roomId)
    }));
  },
  resetCodexApprovalForRoom: (roomId) => {
    set((state) => ({
      pendingCodexApprovalsByRoom: omitRecordKey(state.pendingCodexApprovalsByRoom, roomId),
      approvalVisibleByRoom: omitRecordKey(state.approvalVisibleByRoom, roomId)
    }));
  },
  setCodexRunningForRoom: (roomId, running) => {
    set((state) => ({
      codexRunningByRoom: running
        ? { ...state.codexRunningByRoom, [roomId]: true }
        : omitRecordKey(state.codexRunningByRoom, roomId)
    }));
  },
  setRoomGoalForRoom: (roomId, goal) => {
    set((state) => ({
      roomGoalsByRoom: goal
        ? { ...state.roomGoalsByRoom, [roomId]: goal }
        : omitRecordKey(state.roomGoalsByRoom, roomId)
    }));
  },
  setCodexThreadIdForRoom: (roomId, threadId) => {
    set((state) => ({
      codexThreadIdsByRoom: threadId
        ? { ...state.codexThreadIdsByRoom, [roomId]: threadId }
        : omitRecordKey(state.codexThreadIdsByRoom, roomId)
    }));
  },
  setSecretWarningVisibleForRoom: (roomId, visible) => {
    set((state) => ({
      secretWarningsVisibleByRoom: visible
        ? { ...state.secretWarningsVisibleByRoom, [roomId]: true }
        : omitRecordKey(state.secretWarningsVisibleByRoom, roomId)
    }));
  }
});
