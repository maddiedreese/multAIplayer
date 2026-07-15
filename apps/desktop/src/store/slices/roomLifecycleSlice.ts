import type { StateCreator } from "zustand";
import { normalizeCodexThreadGraph } from "../../lib/codex/codexThreadGraph";
import { omitRecordKey } from "../../lib/core/setUtils";
import { normalizeGitHubActionRun } from "../../lib/identity/authClient";
import { replaceRoomTerminalSnapshots } from "../../lib/terminal/terminalState";
import type { LocalRoomHistoryPayload } from "../../types";
import type { AppStoreState } from "../appStore";

export interface RoomLifecycleSlice {
  hydrateLocalRoomHistoryForRoom: (roomId: string, payload: LocalRoomHistoryPayload) => void;
  clearRoomScopedStateForRoom: (roomId: string) => void;
}

export const createRoomLifecycleSlice: StateCreator<AppStoreState, [], [], RoomLifecycleSlice> = (set) => ({
  hydrateLocalRoomHistoryForRoom: (roomId, payload) => {
    set((state) => hydratedRoomHistoryState(state, roomId, payload));
  },
  clearRoomScopedStateForRoom: (roomId) => {
    set((state) => ({
      messagesByRoom: omitRecordKey(state.messagesByRoom, roomId),
      chatEditsByRoom: omitRecordKey(state.chatEditsByRoom, roomId),
      chatDeletesByRoom: omitRecordKey(state.chatDeletesByRoom, roomId),
      terminalRuntimeByRoom: omitRecordKey(state.terminalRuntimeByRoom, roomId),
      browserByRoom: omitRecordKey(state.browserByRoom, roomId),
      inviteByRoom: omitRecordKey(state.inviteByRoom, roomId),
      codexRuntimeByRoom: omitRecordKey(state.codexRuntimeByRoom, roomId),
      gitWorkflowRuntimeByRoom: omitRecordKey(state.gitWorkflowRuntimeByRoom, roomId),
      roomSettingsByRoom: omitRecordKey(state.roomSettingsByRoom, roomId),
      roomChatByRoom: omitRecordKey(state.roomChatByRoom, roomId),
      sensitiveAttachmentReviewKey: state.sensitiveAttachmentReviewKey?.startsWith(`${roomId}:`)
        ? null
        : state.sensitiveAttachmentReviewKey,
      filePanelByRoom: omitRecordKey(state.filePanelByRoom, roomId),
      historyPresenceByRoom: omitRecordKey(state.historyPresenceByRoom, roomId),
      localPreviewByRoom: omitRecordKey(state.localPreviewByRoom, roomId),
      terminals: state.terminals.filter((terminal) => terminal.roomId !== roomId)
    }));
  }
});

function hydratedRoomHistoryState(state: AppStoreState, roomId: string, payload: LocalRoomHistoryPayload) {
  return {
    messagesByRoom: hydrateList(state.messagesByRoom, roomId, payload.messages),
    chatEditsByRoom: hydrateList(state.chatEditsByRoom, roomId, payload.chatEdits ?? []),
    chatDeletesByRoom: hydrateList(state.chatDeletesByRoom, roomId, payload.chatDeletes ?? []),
    terminalRuntimeByRoom: hydrateTerminalRuntime(state, roomId, payload),
    browserByRoom: hydrateNestedList(state.browserByRoom, roomId, "requests", payload.browserRequests),
    filePanelByRoom: hydrateNestedList(state.filePanelByRoom, roomId, "saveRequests", payload.fileSaveRequests ?? []),
    inviteByRoom: hydrateNestedList(state.inviteByRoom, roomId, "requests", payload.inviteRequests),
    codexRuntimeByRoom: hydrateCodexRuntime(state, roomId, payload),
    gitWorkflowRuntimeByRoom: hydrateGitWorkflowRuntime(state, roomId, payload),
    localPreviewByRoom: hydrateNestedList(state.localPreviewByRoom, roomId, "previews", payload.localPreviews),
    terminals: payload.terminalSnapshots.length
      ? replaceRoomTerminalSnapshots(state.terminals, roomId, payload.terminalSnapshots)
      : state.terminals
  };
}

function hydrateList<T>(current: Record<string, T[]>, roomId: string, items: T[]) {
  return items.length ? { ...current, [roomId]: items } : current;
}

function hydrateNestedList<T extends object, K extends string, V>(
  current: Record<string, T>,
  roomId: string,
  key: K,
  items: V[]
): Record<string, T> {
  return items.length ? { ...current, [roomId]: { ...current[roomId], [key]: items } as unknown as T } : current;
}

function hydrateTerminalRuntime(state: AppStoreState, roomId: string, payload: LocalRoomHistoryPayload) {
  const currentTerminalId = state.terminalRuntimeByRoom[roomId]?.selectedTerminalId ?? null;
  const nextTerminalId =
    currentTerminalId && payload.terminalSnapshots.some((terminal) => terminal.id === currentTerminalId)
      ? currentTerminalId
      : (payload.terminalSnapshots[0]?.id ?? null);
  if (!payload.terminalRequests.length && !(payload.terminalSnapshots.length && nextTerminalId)) {
    return state.terminalRuntimeByRoom;
  }
  return {
    ...state.terminalRuntimeByRoom,
    [roomId]: {
      ...state.terminalRuntimeByRoom[roomId],
      ...(payload.terminalRequests.length ? { requests: payload.terminalRequests } : {}),
      ...(payload.terminalSnapshots.length && nextTerminalId ? { selectedTerminalId: nextTerminalId } : {})
    }
  };
}

function hydrateCodexRuntime(state: AppStoreState, roomId: string, payload: LocalRoomHistoryPayload) {
  const queuedCodexTurns = payload.queuedCodexTurns ?? [];
  const codexThreadGraph = normalizeCodexThreadGraph(payload.codexThreadGraph);
  const { threadGraph: _threadGraph, ...runtime } = state.codexRuntimeByRoom[roomId] ?? {};
  return {
    ...state.codexRuntimeByRoom,
    [roomId]: {
      ...runtime,
      events: payload.codexEvents,
      activities: payload.codexActivities ?? [],
      hostHandoffs: payload.hostHandoffs,
      ...(queuedCodexTurns.length ? { queuedApprovals: queuedCodexTurns } : {}),
      ...(payload.roomGoal ? { goal: payload.roomGoal } : {}),
      ...(codexThreadGraph.activeThreadId ? { threadGraph: codexThreadGraph } : {})
    }
  };
}

function hydrateGitWorkflowRuntime(state: AppStoreState, roomId: string, payload: LocalRoomHistoryPayload) {
  if (!payload.gitWorkflowEvents.length && !payload.githubActionsEvents.length) return state.gitWorkflowRuntimeByRoom;
  const latestWorkflow = payload.gitWorkflowEvents.at(-1);
  const latestActions = payload.githubActionsEvents.at(-1);
  return {
    ...state.gitWorkflowRuntimeByRoom,
    [roomId]: {
      ...state.gitWorkflowRuntimeByRoom[roomId],
      ...(payload.gitWorkflowEvents.length
        ? {
            workflow: {
              ...state.gitWorkflowRuntimeByRoom[roomId]?.workflow,
              events: payload.gitWorkflowEvents,
              message: latestWorkflow?.message ?? null
            }
          }
        : {}),
      ...(payload.githubActionsEvents.length
        ? {
            actions: {
              ...state.gitWorkflowRuntimeByRoom[roomId]?.actions,
              events: payload.githubActionsEvents,
              ...(latestActions
                ? {
                    runs: latestActions.runs.map(normalizeGitHubActionRun),
                    lastChecked: latestActions.checkedAt,
                    message: `${latestActions.summary.label}: ${latestActions.message}`
                  }
                : {})
            }
          }
        : {})
    }
  };
}
