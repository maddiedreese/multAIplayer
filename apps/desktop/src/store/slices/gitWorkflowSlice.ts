import type { StateCreator } from "zustand";
import type { GitHubActionsEventPlaintextPayload, GitWorkflowEventPlaintextPayload } from "@multaiplayer/protocol";
import { normalizeGitHubActionRun, type GitHubActionRun } from "../../lib/identity/authClient";
import {
  defaultGitWorkflowDraft,
  updateGitWorkflowDraftRecord,
  type GitWorkflowDraft
} from "../../lib/git/gitWorkflowDraft";
import type { GitStatusSummary } from "../../lib/platform/localBackend";
import { omitRecordKey } from "../../lib/core/setUtils";
import type { AppStoreState } from "../appStore";

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
  events?: GitHubActionsEventPlaintextPayload[];
}

export type GitHubActionsByRoom = Record<string, GitHubActionsRoomState>;

export interface GitWorkflowRuntimeRoomState {
  workflow?: GitWorkflowRoomState;
  actions?: GitHubActionsRoomState;
}

export type GitWorkflowRuntimeByRoom = Record<string, GitWorkflowRuntimeRoomState>;

export interface GitHubWorkflowPanelMaps {
  gitStatusByRoom: Record<string, GitStatusSummary | null>;
  gitWorkflowBusyByRoom: Record<string, boolean>;
  gitWorkflowMessagesByRoom: Record<string, string | null>;
  gitWorkflowDraftsByRoom: Record<string, Partial<GitWorkflowDraft>>;
  actionsBusyByRoom: Record<string, boolean>;
  actionsMessagesByRoom: Record<string, string | null>;
  actionRunsByRoom: Record<string, GitHubActionRun[]>;
  actionsLastCheckedByRoom: Record<string, string | null>;
}

function isEmptyRecord(record: object): boolean {
  return Object.keys(record).length === 0;
}

function maybeWithoutEmptyWorkflowRuntime(roomRuntime: GitWorkflowRuntimeRoomState): GitWorkflowRuntimeRoomState {
  const nextRoomRuntime = { ...roomRuntime };
  if (nextRoomRuntime.workflow && isEmptyRecord(nextRoomRuntime.workflow)) delete nextRoomRuntime.workflow;
  if (nextRoomRuntime.actions && isEmptyRecord(nextRoomRuntime.actions)) delete nextRoomRuntime.actions;
  return nextRoomRuntime;
}

function updateGitWorkflowRuntimeForRoom(
  current: GitWorkflowRuntimeByRoom,
  roomId: string,
  update: (roomRuntime: GitWorkflowRuntimeRoomState) => GitWorkflowRuntimeRoomState
): GitWorkflowRuntimeByRoom {
  const nextRoomRuntime = maybeWithoutEmptyWorkflowRuntime(update(current[roomId] ?? {}));
  if (isEmptyRecord(nextRoomRuntime)) {
    return roomId in current ? omitRecordKey(current, roomId) : current;
  }
  return { ...current, [roomId]: nextRoomRuntime };
}

export function projectGitWorkflowByRoom(gitWorkflowRuntimeByRoom: GitWorkflowRuntimeByRoom): GitWorkflowByRoom {
  return Object.fromEntries(
    Object.entries(gitWorkflowRuntimeByRoom)
      .filter(([, runtime]) => runtime.workflow)
      .map(([roomId, runtime]) => [roomId, runtime.workflow ?? {}])
  );
}

export function projectGitHubActionsByRoom(gitWorkflowRuntimeByRoom: GitWorkflowRuntimeByRoom): GitHubActionsByRoom {
  return Object.fromEntries(
    Object.entries(gitWorkflowRuntimeByRoom)
      .filter(([, runtime]) => runtime.actions)
      .map(([roomId, runtime]) => [roomId, runtime.actions ?? {}])
  );
}

export function projectGitHubWorkflowPanelMaps(
  gitWorkflowRuntimeByRoom: GitWorkflowRuntimeByRoom
): GitHubWorkflowPanelMaps {
  const gitWorkflowByRoom = projectGitWorkflowByRoom(gitWorkflowRuntimeByRoom);
  const githubActionsByRoom = projectGitHubActionsByRoom(gitWorkflowRuntimeByRoom);

  return {
    gitStatusByRoom: Object.fromEntries(
      Object.entries(gitWorkflowByRoom)
        .filter(([, workflow]) => "status" in workflow)
        .map(([roomId, workflow]) => [roomId, workflow.status ?? null])
    ),
    gitWorkflowBusyByRoom: Object.fromEntries(
      Object.entries(gitWorkflowByRoom)
        .filter(([, workflow]) => workflow.busy)
        .map(([roomId]) => [roomId, true])
    ),
    gitWorkflowMessagesByRoom: Object.fromEntries(
      Object.entries(gitWorkflowByRoom)
        .filter(([, workflow]) => "message" in workflow)
        .map(([roomId, workflow]) => [roomId, workflow.message ?? null])
    ),
    gitWorkflowDraftsByRoom: Object.fromEntries(
      Object.entries(gitWorkflowByRoom)
        .filter(([, workflow]) => workflow.draft)
        .map(([roomId, workflow]) => [roomId, workflow.draft ?? {}])
    ),
    actionsBusyByRoom: Object.fromEntries(
      Object.entries(githubActionsByRoom)
        .filter(([, actions]) => actions.busy)
        .map(([roomId]) => [roomId, true])
    ),
    actionsMessagesByRoom: Object.fromEntries(
      Object.entries(githubActionsByRoom)
        .filter(([, actions]) => actions.message)
        .map(([roomId, actions]) => [roomId, actions.message ?? null])
    ),
    actionRunsByRoom: Object.fromEntries(
      Object.entries(githubActionsByRoom)
        .filter(([, actions]) => actions.runs)
        .map(([roomId, actions]) => [roomId, actions.runs ?? []])
    ),
    actionsLastCheckedByRoom: Object.fromEntries(
      Object.entries(githubActionsByRoom)
        .filter(([, actions]) => actions.lastChecked)
        .map(([roomId, actions]) => [roomId, actions.lastChecked ?? null])
    )
  };
}

export interface GitWorkflowSlice {
  gitWorkflowRuntimeByRoom: GitWorkflowRuntimeByRoom;
  setActionsMessageForRoom: (roomId: string, message: string | null) => void;
  recordGitHubActionsRefreshForRoom: (
    roomId: string,
    refresh: {
      runs: GitHubActionRun[];
      checkedAt: string;
      message: string;
    }
  ) => void;
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

export const emptyGitWorkflowState: Pick<GitWorkflowSlice, "gitWorkflowRuntimeByRoom"> = {
  gitWorkflowRuntimeByRoom: {}
};

export const createGitWorkflowSlice: StateCreator<AppStoreState, [], [], GitWorkflowSlice> = (set) => ({
  ...emptyGitWorkflowState,
  setActionsMessageForRoom: (roomId, message) => {
    set((state) => ({
      gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(state.gitWorkflowRuntimeByRoom, roomId, (runtime) => {
        const { message: _message, ...rest } = runtime.actions ?? {};
        return { ...runtime, actions: message ? { ...rest, message } : rest };
      })
    }));
  },
  recordGitHubActionsRefreshForRoom: (roomId, refresh) => {
    set((state) => ({
      gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(state.gitWorkflowRuntimeByRoom, roomId, (runtime) => ({
        ...runtime,
        actions: {
          ...runtime.actions,
          runs: refresh.runs,
          lastChecked: refresh.checkedAt,
          message: refresh.message
        }
      }))
    }));
  },
  applyGitHubActionsEventForRoom: (roomId, event) => {
    set((state) => {
      const roomEvents = state.gitWorkflowRuntimeByRoom[roomId]?.actions?.events ?? [];
      const alreadyRecorded = roomEvents.some(
        (existing) =>
          existing.checkedAt === event.checkedAt &&
          existing.owner === event.owner &&
          existing.repo === event.repo &&
          existing.branch === event.branch
      );
      return {
        gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(
          state.gitWorkflowRuntimeByRoom,
          roomId,
          (runtime) => ({
            ...runtime,
            actions: {
              ...runtime.actions,
              events: alreadyRecorded ? roomEvents : [...roomEvents, event].slice(-50),
              runs: event.runs.map(normalizeGitHubActionRun),
              lastChecked: event.checkedAt,
              message: `${event.summary.label}: ${event.message}`
            }
          })
        )
      };
    });
  },
  setActionsLastCheckedForRoom: (roomId, checkedAt) => {
    set((state) => ({
      gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(state.gitWorkflowRuntimeByRoom, roomId, (runtime) => {
        const { lastChecked: _lastChecked, ...rest } = runtime.actions ?? {};
        return { ...runtime, actions: checkedAt ? { ...rest, lastChecked: checkedAt } : rest };
      })
    }));
  },
  resetGitHubActionsStateForRoom: (roomId) => {
    set((state) => ({
      gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(state.gitWorkflowRuntimeByRoom, roomId, (runtime) => ({
        ...runtime,
        actions: { runs: [] }
      }))
    }));
  },
  setGitWorkflowBusyForRoom: (roomId, busy) => {
    set((state) => ({
      gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(state.gitWorkflowRuntimeByRoom, roomId, (runtime) => {
        const nextRoomWorkflow = { ...runtime.workflow };
        if (busy) {
          nextRoomWorkflow.busy = true;
        } else {
          delete nextRoomWorkflow.busy;
        }
        return { ...runtime, workflow: nextRoomWorkflow };
      })
    }));
  },
  setActionsBusyForRoom: (roomId, busy) => {
    set((state) => ({
      gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(state.gitWorkflowRuntimeByRoom, roomId, (runtime) => {
        const { busy: _busy, ...rest } = runtime.actions ?? {};
        return { ...runtime, actions: busy ? { ...rest, busy: true } : rest };
      })
    }));
  },
  appendGitWorkflowEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.gitWorkflowRuntimeByRoom[roomId]?.workflow?.events ?? [];
      if (
        roomEvents.some(
          (existing) =>
            existing.createdAt === event.createdAt &&
            existing.status === event.status &&
            existing.message === event.message
        )
      ) {
        return state;
      }
      return {
        gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(
          state.gitWorkflowRuntimeByRoom,
          roomId,
          (runtime) => ({
            ...runtime,
            workflow: {
              ...runtime.workflow,
              events: [...roomEvents, event].slice(-100)
            }
          })
        )
      };
    });
  },
  appendGitHubActionsEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.gitWorkflowRuntimeByRoom[roomId]?.actions?.events ?? [];
      if (
        roomEvents.some(
          (existing) =>
            existing.checkedAt === event.checkedAt &&
            existing.owner === event.owner &&
            existing.repo === event.repo &&
            existing.branch === event.branch
        )
      ) {
        return state;
      }
      return {
        gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(
          state.gitWorkflowRuntimeByRoom,
          roomId,
          (runtime) => ({
            ...runtime,
            actions: {
              ...runtime.actions,
              events: [...roomEvents, event].slice(-50)
            }
          })
        )
      };
    });
  },
  setGitWorkflowMessageForRoom: (roomId, message) => {
    set((state) => ({
      gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(state.gitWorkflowRuntimeByRoom, roomId, (runtime) => ({
        ...runtime,
        workflow: {
          ...runtime.workflow,
          message
        }
      }))
    }));
  },
  setGitStatusForRoom: (roomId, status) => {
    set((state) => ({
      gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(state.gitWorkflowRuntimeByRoom, roomId, (runtime) => ({
        ...runtime,
        workflow: {
          ...runtime.workflow,
          status
        }
      }))
    }));
  },
  editGitWorkflowDraftForRoom: (roomId, patch) => {
    set((state) => {
      const draftByRoom = state.gitWorkflowRuntimeByRoom[roomId]?.workflow?.draft
        ? { [roomId]: state.gitWorkflowRuntimeByRoom[roomId].workflow.draft }
        : {};
      const nextDraft = updateGitWorkflowDraftRecord(draftByRoom, roomId, patch)[roomId];
      return {
        gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(
          state.gitWorkflowRuntimeByRoom,
          roomId,
          (runtime) => ({
            ...runtime,
            workflow: {
              ...runtime.workflow,
              ...(nextDraft ? { draft: nextDraft } : {})
            }
          })
        )
      };
    });
  },
  applyInferredGitHubRemoteForRoom: (roomId, remote) => {
    let applied = false;
    set((state) => {
      const draftByRoom = state.gitWorkflowRuntimeByRoom[roomId]?.workflow?.draft
        ? { [roomId]: state.gitWorkflowRuntimeByRoom[roomId].workflow.draft }
        : {};
      const currentDraft = updateGitWorkflowDraftRecord(draftByRoom, roomId, {})[roomId] ?? defaultGitWorkflowDraft;
      const isDefaultTarget =
        currentDraft.prOwner === defaultGitWorkflowDraft.prOwner &&
        currentDraft.prRepo === defaultGitWorkflowDraft.prRepo;
      const alreadyMatches = currentDraft.prOwner === remote.owner && currentDraft.prRepo === remote.repo;
      if (!isDefaultTarget || alreadyMatches) {
        return state;
      }
      applied = true;
      const nextDraft =
        updateGitWorkflowDraftRecord(draftByRoom, roomId, {
          prOwner: remote.owner,
          prRepo: remote.repo
        })[roomId] ?? currentDraft;
      return {
        gitWorkflowRuntimeByRoom: updateGitWorkflowRuntimeForRoom(
          state.gitWorkflowRuntimeByRoom,
          roomId,
          (runtime) => ({
            ...runtime,
            workflow: {
              ...runtime.workflow,
              draft: nextDraft
            }
          })
        )
      };
    });
    return applied;
  }
});
