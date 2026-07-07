import { create } from "zustand";
import type { SetStateAction } from "react";
import type { GitHubActionRun } from "../lib/authClient";
import type { GitStatusSummary } from "../lib/localBackend";
import type { GitWorkflowDraft } from "../lib/gitWorkflowDraft";
import type { BrowserAccessRequest, BrowserStatus } from "../types";

type GitStatusByRoom = Record<string, GitStatusSummary | null>;
type GitWorkflowBusyByRoom = Record<string, boolean>;
type GitWorkflowMessagesByRoom = Record<string, string | null>;
type GitWorkflowDraftsByRoom = Record<string, Partial<GitWorkflowDraft>>;
type ActionsBusyByRoom = Record<string, boolean>;
type ActionsMessagesByRoom = Record<string, string | null>;
type ActionRunsByRoom = Record<string, GitHubActionRun[]>;
type ActionsLastCheckedByRoom = Record<string, string | null>;
type BrowserRequestsByRoom = Record<string, BrowserAccessRequest[]>;
type BrowserUrlsByRoom = Record<string, string>;
type BrowserReasonsByRoom = Record<string, string>;
type BrowserMessagesByRoom = Record<string, string | null>;
type BrowserStatusByRoom = Record<string, BrowserStatus>;
type ActiveBrowserUrlsByRoom = Record<string, string | null>;

const emptyAppStoreState = {
  gitStatusByRoom: {},
  gitWorkflowBusyByRoom: {},
  gitWorkflowMessagesByRoom: {},
  gitWorkflowDraftsByRoom: {},
  actionsBusyByRoom: {},
  actionsMessagesByRoom: {},
  actionRunsByRoom: {},
  actionsLastCheckedByRoom: {},
  browserRequestsByRoom: {},
  browserUrlsByRoom: {},
  browserReasonsByRoom: {},
  browserMessagesByRoom: {},
  browserStatusByRoom: {},
  activeBrowserUrlsByRoom: {}
};

function resolveSetStateAction<T>(current: T, action: SetStateAction<T>): T {
  return typeof action === "function" ? (action as (current: T) => T)(current) : action;
}

interface AppStoreState {
  gitStatusByRoom: GitStatusByRoom;
  gitWorkflowBusyByRoom: GitWorkflowBusyByRoom;
  gitWorkflowMessagesByRoom: GitWorkflowMessagesByRoom;
  gitWorkflowDraftsByRoom: GitWorkflowDraftsByRoom;
  actionsBusyByRoom: ActionsBusyByRoom;
  actionsMessagesByRoom: ActionsMessagesByRoom;
  actionRunsByRoom: ActionRunsByRoom;
  actionsLastCheckedByRoom: ActionsLastCheckedByRoom;
  browserRequestsByRoom: BrowserRequestsByRoom;
  browserUrlsByRoom: BrowserUrlsByRoom;
  browserReasonsByRoom: BrowserReasonsByRoom;
  browserMessagesByRoom: BrowserMessagesByRoom;
  browserStatusByRoom: BrowserStatusByRoom;
  activeBrowserUrlsByRoom: ActiveBrowserUrlsByRoom;
  setGitStatusByRoom: (action: SetStateAction<GitStatusByRoom>) => void;
  setGitWorkflowBusyByRoom: (action: SetStateAction<GitWorkflowBusyByRoom>) => void;
  setGitWorkflowMessagesByRoom: (action: SetStateAction<GitWorkflowMessagesByRoom>) => void;
  setGitWorkflowDraftsByRoom: (action: SetStateAction<GitWorkflowDraftsByRoom>) => void;
  setActionsBusyByRoom: (action: SetStateAction<ActionsBusyByRoom>) => void;
  setActionsMessagesByRoom: (action: SetStateAction<ActionsMessagesByRoom>) => void;
  setActionRunsByRoom: (action: SetStateAction<ActionRunsByRoom>) => void;
  setActionsLastCheckedByRoom: (action: SetStateAction<ActionsLastCheckedByRoom>) => void;
  setBrowserRequestsByRoom: (action: SetStateAction<BrowserRequestsByRoom>) => void;
  setBrowserUrlsByRoom: (action: SetStateAction<BrowserUrlsByRoom>) => void;
  setBrowserReasonsByRoom: (action: SetStateAction<BrowserReasonsByRoom>) => void;
  setBrowserMessagesByRoom: (action: SetStateAction<BrowserMessagesByRoom>) => void;
  setBrowserStatusByRoom: (action: SetStateAction<BrowserStatusByRoom>) => void;
  setActiveBrowserUrlsByRoom: (action: SetStateAction<ActiveBrowserUrlsByRoom>) => void;
  resetAppStore: () => void;
  resetGitWorkflowState: () => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  ...emptyAppStoreState,
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
  setActionsBusyByRoom: (action) => {
    set((state) => ({
      actionsBusyByRoom: resolveSetStateAction(state.actionsBusyByRoom, action)
    }));
  },
  setActionsMessagesByRoom: (action) => {
    set((state) => ({
      actionsMessagesByRoom: resolveSetStateAction(state.actionsMessagesByRoom, action)
    }));
  },
  setActionRunsByRoom: (action) => {
    set((state) => ({
      actionRunsByRoom: resolveSetStateAction(state.actionRunsByRoom, action)
    }));
  },
  setActionsLastCheckedByRoom: (action) => {
    set((state) => ({
      actionsLastCheckedByRoom: resolveSetStateAction(state.actionsLastCheckedByRoom, action)
    }));
  },
  setBrowserRequestsByRoom: (action) => {
    set((state) => ({
      browserRequestsByRoom: resolveSetStateAction(state.browserRequestsByRoom, action)
    }));
  },
  setBrowserUrlsByRoom: (action) => {
    set((state) => ({
      browserUrlsByRoom: resolveSetStateAction(state.browserUrlsByRoom, action)
    }));
  },
  setBrowserReasonsByRoom: (action) => {
    set((state) => ({
      browserReasonsByRoom: resolveSetStateAction(state.browserReasonsByRoom, action)
    }));
  },
  setBrowserMessagesByRoom: (action) => {
    set((state) => ({
      browserMessagesByRoom: resolveSetStateAction(state.browserMessagesByRoom, action)
    }));
  },
  setBrowserStatusByRoom: (action) => {
    set((state) => ({
      browserStatusByRoom: resolveSetStateAction(state.browserStatusByRoom, action)
    }));
  },
  setActiveBrowserUrlsByRoom: (action) => {
    set((state) => ({
      activeBrowserUrlsByRoom: resolveSetStateAction(state.activeBrowserUrlsByRoom, action)
    }));
  },
  resetAppStore: () => set(emptyAppStoreState),
  resetGitWorkflowState: () => set(emptyAppStoreState)
}));
