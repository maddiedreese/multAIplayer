import type { StateCreator } from "zustand";
import type {
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload
} from "@multaiplayer/protocol";
import type { GitHubActionRun } from "../../lib/authClient";
import { updateGitWorkflowDraftRecord, type GitWorkflowDraft } from "../../lib/gitWorkflowDraft";
import type { GitStatusSummary } from "../../lib/localBackend";
import { omitRecordKey } from "../../lib/setUtils";
import type { AppStoreState } from "../appStore";

type GitStatusByRoom = Record<string, GitStatusSummary | null>;
type GitWorkflowBusyByRoom = Record<string, boolean>;
type GitWorkflowMessagesByRoom = Record<string, string | null>;
type GitWorkflowDraftsByRoom = Record<string, Partial<GitWorkflowDraft>>;
type ActionsBusyByRoom = Record<string, boolean>;
type ActionsMessagesByRoom = Record<string, string | null>;
type ActionRunsByRoom = Record<string, GitHubActionRun[]>;
type ActionsLastCheckedByRoom = Record<string, string | null>;
type GitWorkflowEventsByRoom = Record<string, GitWorkflowEventPlaintextPayload[]>;
type GitHubActionsEventsByRoom = Record<string, GitHubActionsEventPlaintextPayload[]>;
type RoomBusyByRoom = Record<string, boolean>;

function updateRoomBusyMap(current: RoomBusyByRoom, roomId: string, busy: boolean): RoomBusyByRoom {
  return busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId);
}

export interface GitWorkflowSlice {
  gitStatusByRoom: GitStatusByRoom;
  gitWorkflowBusyByRoom: GitWorkflowBusyByRoom;
  gitWorkflowMessagesByRoom: GitWorkflowMessagesByRoom;
  gitWorkflowDraftsByRoom: GitWorkflowDraftsByRoom;
  actionsBusyByRoom: ActionsBusyByRoom;
  actionsMessagesByRoom: ActionsMessagesByRoom;
  actionRunsByRoom: ActionRunsByRoom;
  actionsLastCheckedByRoom: ActionsLastCheckedByRoom;
  gitWorkflowEventsByRoom: GitWorkflowEventsByRoom;
  githubActionsEventsByRoom: GitHubActionsEventsByRoom;
  setActionsMessageForRoom: (roomId: string, message: string | null) => void;
  setActionRunsForRoom: (roomId: string, runs: GitHubActionRun[]) => void;
  setActionsLastCheckedForRoom: (roomId: string, checkedAt: string | null) => void;
  resetGitHubActionsStateForRoom: (roomId: string) => void;
  setGitWorkflowBusyForRoom: (roomId: string, busy: boolean) => void;
  setActionsBusyForRoom: (roomId: string, busy: boolean) => void;
  appendGitWorkflowEvent: (roomId: string, event: GitWorkflowEventPlaintextPayload) => void;
  appendGitHubActionsEvent: (roomId: string, event: GitHubActionsEventPlaintextPayload) => void;
  setGitWorkflowMessageForRoom: (roomId: string, message: string | null) => void;
  setGitStatusForRoom: (roomId: string, status: GitStatusSummary | null) => void;
  updateGitWorkflowDraftForRoom: (roomId: string, patch: Partial<GitWorkflowDraft>) => void;
}

export const emptyGitWorkflowState: Pick<
  GitWorkflowSlice,
  | "gitStatusByRoom"
  | "gitWorkflowBusyByRoom"
  | "gitWorkflowMessagesByRoom"
  | "gitWorkflowDraftsByRoom"
  | "actionsBusyByRoom"
  | "actionsMessagesByRoom"
  | "actionRunsByRoom"
  | "actionsLastCheckedByRoom"
  | "gitWorkflowEventsByRoom"
  | "githubActionsEventsByRoom"
> = {
  gitStatusByRoom: {},
  gitWorkflowBusyByRoom: {},
  gitWorkflowMessagesByRoom: {},
  gitWorkflowDraftsByRoom: {},
  actionsBusyByRoom: {},
  actionsMessagesByRoom: {},
  actionRunsByRoom: {},
  actionsLastCheckedByRoom: {},
  gitWorkflowEventsByRoom: {},
  githubActionsEventsByRoom: {}
};

export const createGitWorkflowSlice: StateCreator<AppStoreState, [], [], GitWorkflowSlice> = (set) => ({
  ...emptyGitWorkflowState,
  setActionsMessageForRoom: (roomId, message) => {
    set((state) => ({
      actionsMessagesByRoom: message
        ? { ...state.actionsMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.actionsMessagesByRoom, roomId)
    }));
  },
  setActionRunsForRoom: (roomId, runs) => {
    set((state) => ({
      actionRunsByRoom: {
        ...state.actionRunsByRoom,
        [roomId]: runs
      }
    }));
  },
  setActionsLastCheckedForRoom: (roomId, checkedAt) => {
    set((state) => ({
      actionsLastCheckedByRoom: checkedAt
        ? { ...state.actionsLastCheckedByRoom, [roomId]: checkedAt }
        : omitRecordKey(state.actionsLastCheckedByRoom, roomId)
    }));
  },
  resetGitHubActionsStateForRoom: (roomId) => {
    set((state) => ({
      actionRunsByRoom: {
        ...state.actionRunsByRoom,
        [roomId]: []
      },
      actionsLastCheckedByRoom: omitRecordKey(state.actionsLastCheckedByRoom, roomId),
      actionsMessagesByRoom: omitRecordKey(state.actionsMessagesByRoom, roomId),
      actionsBusyByRoom: omitRecordKey(state.actionsBusyByRoom, roomId)
    }));
  },
  setGitWorkflowBusyForRoom: (roomId, busy) => {
    set((state) => ({
      gitWorkflowBusyByRoom: updateRoomBusyMap(state.gitWorkflowBusyByRoom, roomId, busy)
    }));
  },
  setActionsBusyForRoom: (roomId, busy) => {
    set((state) => ({
      actionsBusyByRoom: updateRoomBusyMap(state.actionsBusyByRoom, roomId, busy)
    }));
  },
  appendGitWorkflowEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.gitWorkflowEventsByRoom[roomId] ?? [];
      if (
        roomEvents.some((existing) =>
          existing.createdAt === event.createdAt &&
          existing.status === event.status &&
          existing.message === event.message
        )
      ) {
        return state;
      }
      return {
        gitWorkflowEventsByRoom: {
          ...state.gitWorkflowEventsByRoom,
          [roomId]: [...roomEvents, event].slice(-100)
        }
      };
    });
  },
  appendGitHubActionsEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.githubActionsEventsByRoom[roomId] ?? [];
      if (
        roomEvents.some((existing) =>
          existing.checkedAt === event.checkedAt &&
          existing.owner === event.owner &&
          existing.repo === event.repo &&
          existing.branch === event.branch
        )
      ) {
        return state;
      }
      return {
        githubActionsEventsByRoom: {
          ...state.githubActionsEventsByRoom,
          [roomId]: [...roomEvents, event].slice(-50)
        }
      };
    });
  },
  setGitWorkflowMessageForRoom: (roomId, message) => {
    set((state) => ({
      gitWorkflowMessagesByRoom: {
        ...state.gitWorkflowMessagesByRoom,
        [roomId]: message
      }
    }));
  },
  setGitStatusForRoom: (roomId, status) => {
    set((state) => ({
      gitStatusByRoom: {
        ...state.gitStatusByRoom,
        [roomId]: status
      }
    }));
  },
  updateGitWorkflowDraftForRoom: (roomId, patch) => {
    set((state) => ({
      gitWorkflowDraftsByRoom: updateGitWorkflowDraftRecord(state.gitWorkflowDraftsByRoom, roomId, patch)
    }));
  }
});
