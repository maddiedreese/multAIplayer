import type { StateCreator } from "zustand";
import type {
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload
} from "@multaiplayer/protocol";
import type { GitHubActionRun } from "../../lib/authClient";
import { defaultGitWorkflowDraft, updateGitWorkflowDraftRecord, type GitWorkflowDraft } from "../../lib/gitWorkflowDraft";
import type { GitStatusSummary } from "../../lib/localBackend";
import { omitRecordKey } from "../../lib/setUtils";
import type { AppStoreState } from "../appStore";

type GitHubActionsEventsByRoom = Record<string, GitHubActionsEventPlaintextPayload[]>;

export interface GitWorkflowRoomState {
  status?: GitStatusSummary | null;
  busy?: boolean;
  message?: string | null;
  draft?: Partial<GitWorkflowDraft>;
  events?: GitWorkflowEventPlaintextPayload[];
}

export type GitWorkflowByRoom = Record<string, GitWorkflowRoomState>;

export interface GitHubActionsRoomState {
  busy?: boolean;
  message?: string;
  runs?: GitHubActionRun[];
  lastChecked?: string;
}

export type GitHubActionsByRoom = Record<string, GitHubActionsRoomState>;

function updateGitWorkflowForRoom(
  current: GitWorkflowByRoom,
  roomId: string,
  update: (roomWorkflow: GitWorkflowRoomState) => GitWorkflowRoomState
): GitWorkflowByRoom {
  const nextRoomWorkflow = update(current[roomId] ?? {});
  if (Object.keys(nextRoomWorkflow).length === 0) {
    return roomId in current ? omitRecordKey(current, roomId) : current;
  }
  return { ...current, [roomId]: nextRoomWorkflow };
}

function updateGitHubActionsForRoom(
  current: GitHubActionsByRoom,
  roomId: string,
  update: (roomActions: GitHubActionsRoomState) => GitHubActionsRoomState
): GitHubActionsByRoom {
  const nextRoomActions = update(current[roomId] ?? {});
  if (Object.keys(nextRoomActions).length === 0) return omitRecordKey(current, roomId);
  return { ...current, [roomId]: nextRoomActions };
}

export interface GitWorkflowSlice {
  gitWorkflowByRoom: GitWorkflowByRoom;
  githubActionsByRoom: GitHubActionsByRoom;
  githubActionsEventsByRoom: GitHubActionsEventsByRoom;
  setActionsMessageForRoom: (roomId: string, message: string | null) => void;
  recordGitHubActionsRefreshForRoom: (roomId: string, refresh: {
    runs: GitHubActionRun[];
    checkedAt: string;
    message: string;
  }) => void;
  applyGitHubActionsEventForRoom: (roomId: string, event: GitHubActionsEventPlaintextPayload) => void;
  setActionsLastCheckedForRoom: (roomId: string, checkedAt: string | null) => void;
  resetGitHubActionsStateForRoom: (roomId: string) => void;
  setGitWorkflowBusyForRoom: (roomId: string, busy: boolean) => void;
  setActionsBusyForRoom: (roomId: string, busy: boolean) => void;
  appendGitWorkflowEvent: (roomId: string, event: GitWorkflowEventPlaintextPayload) => void;
  appendGitHubActionsEvent: (roomId: string, event: GitHubActionsEventPlaintextPayload) => void;
  setGitWorkflowMessageForRoom: (roomId: string, message: string | null) => void;
  setGitStatusForRoom: (roomId: string, status: GitStatusSummary | null) => void;
  editGitWorkflowDraftForRoom: (roomId: string, patch: Partial<GitWorkflowDraft>) => void;
  applyInferredGitHubRemoteForRoom: (roomId: string, remote: { owner: string; repo: string }) => boolean;
}

export const emptyGitWorkflowState: Pick<
  GitWorkflowSlice,
  | "gitWorkflowByRoom"
  | "githubActionsByRoom"
  | "githubActionsEventsByRoom"
> = {
  gitWorkflowByRoom: {},
  githubActionsByRoom: {},
  githubActionsEventsByRoom: {}
};

export const createGitWorkflowSlice: StateCreator<AppStoreState, [], [], GitWorkflowSlice> = (set) => ({
  ...emptyGitWorkflowState,
  setActionsMessageForRoom: (roomId, message) => {
    set((state) => ({
      githubActionsByRoom: updateGitHubActionsForRoom(state.githubActionsByRoom, roomId, (roomActions) => {
        const { message: _message, ...rest } = roomActions;
        return message ? { ...rest, message } : rest;
      })
    }));
  },
  recordGitHubActionsRefreshForRoom: (roomId, refresh) => {
    set((state) => ({
      githubActionsByRoom: updateGitHubActionsForRoom(state.githubActionsByRoom, roomId, (roomActions) => ({
        ...roomActions,
        runs: refresh.runs,
        lastChecked: refresh.checkedAt,
        message: refresh.message
      }))
    }));
  },
  applyGitHubActionsEventForRoom: (roomId, event) => {
    set((state) => {
      const roomEvents = state.githubActionsEventsByRoom[roomId] ?? [];
      const alreadyRecorded = roomEvents.some((existing) =>
        existing.checkedAt === event.checkedAt &&
        existing.owner === event.owner &&
        existing.repo === event.repo &&
        existing.branch === event.branch
      );
      return {
        githubActionsEventsByRoom: alreadyRecorded
          ? state.githubActionsEventsByRoom
          : {
              ...state.githubActionsEventsByRoom,
              [roomId]: [...roomEvents, event].slice(-50)
            },
        githubActionsByRoom: updateGitHubActionsForRoom(state.githubActionsByRoom, roomId, (roomActions) => ({
          ...roomActions,
          runs: event.runs,
          lastChecked: event.checkedAt,
          message: `${event.summary.label}: ${event.message}`
        }))
      };
    });
  },
  setActionsLastCheckedForRoom: (roomId, checkedAt) => {
    set((state) => ({
      githubActionsByRoom: updateGitHubActionsForRoom(state.githubActionsByRoom, roomId, (roomActions) => {
        const { lastChecked: _lastChecked, ...rest } = roomActions;
        return checkedAt ? { ...rest, lastChecked: checkedAt } : rest;
      })
    }));
  },
  resetGitHubActionsStateForRoom: (roomId) => {
    set((state) => ({
      githubActionsByRoom: {
        ...omitRecordKey(state.githubActionsByRoom, roomId),
        [roomId]: { runs: [] }
      }
    }));
  },
  setGitWorkflowBusyForRoom: (roomId, busy) => {
    set((state) => ({
      gitWorkflowByRoom: updateGitWorkflowForRoom(state.gitWorkflowByRoom, roomId, (roomWorkflow) => {
        const nextRoomWorkflow = { ...roomWorkflow };
        if (busy) {
          nextRoomWorkflow.busy = true;
        } else {
          delete nextRoomWorkflow.busy;
        }
        return nextRoomWorkflow;
      })
    }));
  },
  setActionsBusyForRoom: (roomId, busy) => {
    set((state) => ({
      githubActionsByRoom: updateGitHubActionsForRoom(state.githubActionsByRoom, roomId, (roomActions) => {
        const { busy: _busy, ...rest } = roomActions;
        return busy ? { ...rest, busy: true } : rest;
      })
    }));
  },
  appendGitWorkflowEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.gitWorkflowByRoom[roomId]?.events ?? [];
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
        gitWorkflowByRoom: updateGitWorkflowForRoom(state.gitWorkflowByRoom, roomId, (roomWorkflow) => ({
          ...roomWorkflow,
          events: [...roomEvents, event].slice(-100)
        }))
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
      gitWorkflowByRoom: updateGitWorkflowForRoom(state.gitWorkflowByRoom, roomId, (roomWorkflow) => ({
        ...roomWorkflow,
        message
      }))
    }));
  },
  setGitStatusForRoom: (roomId, status) => {
    set((state) => ({
      gitWorkflowByRoom: updateGitWorkflowForRoom(state.gitWorkflowByRoom, roomId, (roomWorkflow) => ({
        ...roomWorkflow,
        status
      }))
    }));
  },
  editGitWorkflowDraftForRoom: (roomId, patch) => {
    set((state) => {
      const draftByRoom = state.gitWorkflowByRoom[roomId]?.draft
        ? { [roomId]: state.gitWorkflowByRoom[roomId].draft }
        : {};
      const nextDraft = updateGitWorkflowDraftRecord(draftByRoom, roomId, patch)[roomId];
      return {
        gitWorkflowByRoom: updateGitWorkflowForRoom(state.gitWorkflowByRoom, roomId, (roomWorkflow) => ({
          ...roomWorkflow,
          draft: nextDraft
        }))
      };
    });
  },
  applyInferredGitHubRemoteForRoom: (roomId, remote) => {
    let applied = false;
    set((state) => {
      const draftByRoom = state.gitWorkflowByRoom[roomId]?.draft
        ? { [roomId]: state.gitWorkflowByRoom[roomId].draft }
        : {};
      const currentDraft = updateGitWorkflowDraftRecord(draftByRoom, roomId, {})[roomId];
      const isDefaultTarget =
        currentDraft.prOwner === defaultGitWorkflowDraft.prOwner &&
        currentDraft.prRepo === defaultGitWorkflowDraft.prRepo;
      const alreadyMatches = currentDraft.prOwner === remote.owner && currentDraft.prRepo === remote.repo;
      if (!isDefaultTarget || alreadyMatches) {
        return state;
      }
      applied = true;
      const nextDraft = updateGitWorkflowDraftRecord(draftByRoom, roomId, {
        prOwner: remote.owner,
        prRepo: remote.repo
      })[roomId];
      return {
        gitWorkflowByRoom: updateGitWorkflowForRoom(state.gitWorkflowByRoom, roomId, (roomWorkflow) => ({
          ...roomWorkflow,
          draft: nextDraft
        }))
      };
    });
    return applied;
  }
});
