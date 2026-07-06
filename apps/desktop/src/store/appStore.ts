import { create } from "zustand";
import type { SetStateAction } from "react";
import type { GitStatusSummary } from "../lib/localBackend";
import type { GitWorkflowDraft } from "../lib/gitWorkflowDraft";

type GitStatusByRoom = Record<string, GitStatusSummary | null>;
type GitWorkflowBusyByRoom = Record<string, boolean>;
type GitWorkflowMessagesByRoom = Record<string, string | null>;
type GitWorkflowDraftsByRoom = Record<string, Partial<GitWorkflowDraft>>;

function resolveSetStateAction<T>(current: T, action: SetStateAction<T>): T {
  return typeof action === "function" ? (action as (current: T) => T)(current) : action;
}

interface AppStoreState {
  gitStatusByRoom: GitStatusByRoom;
  gitWorkflowBusyByRoom: GitWorkflowBusyByRoom;
  gitWorkflowMessagesByRoom: GitWorkflowMessagesByRoom;
  gitWorkflowDraftsByRoom: GitWorkflowDraftsByRoom;
  setGitStatusByRoom: (action: SetStateAction<GitStatusByRoom>) => void;
  setGitWorkflowBusyByRoom: (action: SetStateAction<GitWorkflowBusyByRoom>) => void;
  setGitWorkflowMessagesByRoom: (action: SetStateAction<GitWorkflowMessagesByRoom>) => void;
  setGitWorkflowDraftsByRoom: (action: SetStateAction<GitWorkflowDraftsByRoom>) => void;
  resetGitWorkflowState: () => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  gitStatusByRoom: {},
  gitWorkflowBusyByRoom: {},
  gitWorkflowMessagesByRoom: {},
  gitWorkflowDraftsByRoom: {},
  setGitStatusByRoom: (action) => {
    set((state) => ({
      gitStatusByRoom: resolveSetStateAction(state.gitStatusByRoom, action)
    }));
  },
  setGitWorkflowBusyByRoom: (action) => {
    set((state) => ({
      gitWorkflowBusyByRoom: resolveSetStateAction(state.gitWorkflowBusyByRoom, action)
    }));
  },
  setGitWorkflowMessagesByRoom: (action) => {
    set((state) => ({
      gitWorkflowMessagesByRoom: resolveSetStateAction(state.gitWorkflowMessagesByRoom, action)
    }));
  },
  setGitWorkflowDraftsByRoom: (action) => {
    set((state) => ({
      gitWorkflowDraftsByRoom: resolveSetStateAction(state.gitWorkflowDraftsByRoom, action)
    }));
  },
  resetGitWorkflowState: () => {
    set({
      gitStatusByRoom: {},
      gitWorkflowBusyByRoom: {},
      gitWorkflowMessagesByRoom: {},
      gitWorkflowDraftsByRoom: {}
    });
  }
}));
