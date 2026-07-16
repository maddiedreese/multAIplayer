import type { StateCreator } from "zustand";
import { normalizeCodexThreadGraph } from "../../lib/codex/codexThreadGraph";
import { omitRecordKey } from "../../lib/core/setUtils";
import { normalizeGitHubActionRun } from "../../lib/identity/authClient";
import { replaceRoomTerminalSnapshots } from "../../lib/terminal/terminalState";
import { markRoomRead } from "../../lib/history/roomUnread";
import { emptyLocalPreviewDialog } from "./localPreviewSlice";
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
      localPreviewDialog:
        state.localPreviewDialog.roomId === roomId ? emptyLocalPreviewDialog : state.localPreviewDialog,
      rooms: markRoomRead(state.rooms, roomId),
      terminals: state.terminals.filter((terminal) => terminal.roomId !== roomId)
    }));
  }
});

function hydratedRoomHistoryState(state: AppStoreState, roomId: string, payload: LocalRoomHistoryPayload) {
  const terminalSnapshots = mergeByKey(
    payload.terminalSnapshots,
    state.terminals.filter((terminal) => terminal.roomId === roomId),
    (terminal) => terminal.id
  );
  return {
    messagesByRoom: hydrateList(state.messagesByRoom, roomId, payload.messages, (item) => item.id),
    chatEditsByRoom: hydrateList(state.chatEditsByRoom, roomId, payload.chatEdits ?? [], (item) => item.id),
    chatDeletesByRoom: hydrateList(state.chatDeletesByRoom, roomId, payload.chatDeletes ?? [], (item) => item.id),
    terminalRuntimeByRoom: hydrateTerminalRuntime(state, roomId, payload, terminalSnapshots),
    browserByRoom: hydrateNestedList(
      state.browserByRoom,
      roomId,
      "requests",
      payload.browserRequests,
      (item) => item.id,
      preferMonotonicRequest
    ),
    filePanelByRoom: hydrateNestedList(
      state.filePanelByRoom,
      roomId,
      "saveRequests",
      payload.fileSaveRequests ?? [],
      (item) => item.id,
      preferMonotonicRequest
    ),
    inviteByRoom: hydrateNestedList(
      state.inviteByRoom,
      roomId,
      "requests",
      payload.inviteRequests,
      (item) => item.id,
      preferMonotonicRequest
    ),
    codexRuntimeByRoom: hydrateCodexRuntime(state, roomId, payload),
    gitWorkflowRuntimeByRoom: hydrateGitWorkflowRuntime(state, roomId, payload),
    localPreviewByRoom: hydrateNestedList(
      state.localPreviewByRoom,
      roomId,
      "previews",
      payload.localPreviews,
      (item) => item.id,
      (stored, live) => (Date.parse(live.updatedAt) >= Date.parse(stored.updatedAt) ? live : stored)
    ),
    terminals: terminalSnapshots.length
      ? replaceRoomTerminalSnapshots(state.terminals, roomId, terminalSnapshots)
      : state.terminals
  };
}

function hydrateList<T>(current: Record<string, T[]>, roomId: string, items: T[], key: (item: T) => string) {
  const merged = mergeByKey(items, current[roomId] ?? [], key);
  return merged.length ? { ...current, [roomId]: merged } : current;
}

function hydrateNestedList<T extends object, K extends string, V>(
  current: Record<string, T>,
  roomId: string,
  key: K,
  items: V[],
  itemKey: (item: V) => string,
  choose?: (stored: V, live: V) => V
): Record<string, T> {
  const currentItems = ((current[roomId] as Record<string, V[]> | undefined)?.[key] ?? []) as V[];
  const merged = mergeByKey(items, currentItems, itemKey, choose);
  return merged.length ? { ...current, [roomId]: { ...current[roomId], [key]: merged } as unknown as T } : current;
}

function hydrateTerminalRuntime(
  state: AppStoreState,
  roomId: string,
  payload: LocalRoomHistoryPayload,
  terminalSnapshots: LocalRoomHistoryPayload["terminalSnapshots"]
) {
  const requests = mergeByKey(
    payload.terminalRequests,
    state.terminalRuntimeByRoom[roomId]?.requests ?? [],
    (request) => request.id,
    preferMonotonicRequest
  );
  const currentTerminalId = state.terminalRuntimeByRoom[roomId]?.selectedTerminalId ?? null;
  const nextTerminalId =
    currentTerminalId && terminalSnapshots.some((terminal) => terminal.id === currentTerminalId)
      ? currentTerminalId
      : (terminalSnapshots[0]?.id ?? null);
  if (!requests.length && !(terminalSnapshots.length && nextTerminalId)) {
    return state.terminalRuntimeByRoom;
  }
  return {
    ...state.terminalRuntimeByRoom,
    [roomId]: {
      ...state.terminalRuntimeByRoom[roomId],
      ...(requests.length ? { requests } : {}),
      ...(terminalSnapshots.length && nextTerminalId ? { selectedTerminalId: nextTerminalId } : {})
    }
  };
}

function hydrateCodexRuntime(state: AppStoreState, roomId: string, payload: LocalRoomHistoryPayload) {
  const current = state.codexRuntimeByRoom[roomId] ?? {};
  const queuedCodexTurns = mergeByKey(
    payload.queuedCodexTurns ?? [],
    current.queuedApprovals ?? [],
    (turn) => turn.turnId
  );
  const storedThreadGraph = normalizeCodexThreadGraph(payload.codexThreadGraph);
  const codexThreadGraph = mergeThreadGraphs(storedThreadGraph, current.threadGraph);
  const events = mergeByKey(payload.codexEvents, current.events ?? [], codexEventKey);
  const activities = mergeByKey(
    payload.codexActivities ?? [],
    current.activities ?? [],
    (activity) => activity.activityId,
    (stored, live) => (Date.parse(live.updatedAt) >= Date.parse(stored.updatedAt) ? live : stored)
  );
  const hostHandoffs = mergeByKey(
    payload.hostHandoffs,
    current.hostHandoffs ?? [],
    (handoff) => handoff.id,
    preferMonotonicHandoff
  );
  const goal = newerGoal(payload.roomGoal, current.goal);
  const { threadGraph: _threadGraph, ...runtime } = current;
  return {
    ...state.codexRuntimeByRoom,
    [roomId]: {
      ...runtime,
      events,
      activities,
      hostHandoffs,
      ...(queuedCodexTurns.length ? { queuedApprovals: queuedCodexTurns } : {}),
      ...(goal ? { goal } : {}),
      ...(codexThreadGraph.activeThreadId ? { threadGraph: codexThreadGraph } : {})
    }
  };
}

function hydrateGitWorkflowRuntime(state: AppStoreState, roomId: string, payload: LocalRoomHistoryPayload) {
  const current = state.gitWorkflowRuntimeByRoom[roomId];
  const gitWorkflowEvents = mergeByKey(payload.gitWorkflowEvents, current?.workflow?.events ?? [], gitWorkflowEventKey);
  const githubActionsEvents = mergeByKey(
    payload.githubActionsEvents,
    current?.actions?.events ?? [],
    githubActionsEventKey
  );
  if (!gitWorkflowEvents.length && !githubActionsEvents.length) return state.gitWorkflowRuntimeByRoom;
  const latestWorkflow = gitWorkflowEvents.at(-1);
  const latestActions = githubActionsEvents.at(-1);
  return {
    ...state.gitWorkflowRuntimeByRoom,
    [roomId]: {
      ...state.gitWorkflowRuntimeByRoom[roomId],
      ...(gitWorkflowEvents.length
        ? {
            workflow: {
              ...state.gitWorkflowRuntimeByRoom[roomId]?.workflow,
              events: gitWorkflowEvents,
              message: latestWorkflow?.message ?? null
            }
          }
        : {}),
      ...(githubActionsEvents.length
        ? {
            actions: {
              ...state.gitWorkflowRuntimeByRoom[roomId]?.actions,
              events: githubActionsEvents,
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

function mergeByKey<T>(
  stored: T[],
  live: T[],
  key: (item: T) => string,
  choose: (stored: T, live: T) => T = (_stored, liveItem) => liveItem
): T[] {
  const merged = new Map<string, T>();
  for (const item of stored) merged.set(key(item), item);
  for (const item of live) {
    const itemKey = key(item);
    const existing = merged.get(itemKey);
    merged.set(itemKey, existing ? choose(existing, item) : item);
  }
  return [...merged.values()];
}

function codexEventKey(event: LocalRoomHistoryPayload["codexEvents"][number]): string {
  return `${event.turnId}:${event.createdAt}:${event.status}:${event.message}`;
}

function gitWorkflowEventKey(event: LocalRoomHistoryPayload["gitWorkflowEvents"][number]): string {
  return `${event.createdAt}:${event.status}:${event.message}`;
}

function githubActionsEventKey(event: LocalRoomHistoryPayload["githubActionsEvents"][number]): string {
  return `${event.checkedAt}:${event.owner}:${event.repo}:${event.branch}`;
}

function preferMonotonicRequest<T extends { status: "pending" | "approved" | "denied" }>(stored: T, live: T): T {
  if (stored.status !== "pending" && live.status === "pending") return stored;
  if (stored.status !== "pending" && live.status !== "pending") return stored;
  return live;
}

const handoffStatusRank = { available: 0, requested: 1, accepted: 2 } as const;

function preferMonotonicHandoff(
  stored: LocalRoomHistoryPayload["hostHandoffs"][number],
  live: LocalRoomHistoryPayload["hostHandoffs"][number]
) {
  const newer = handoffStatusRank[live.status] >= handoffStatusRank[stored.status] ? live : stored;
  return stored.patchAppliedLocally || live.patchAppliedLocally ? { ...newer, patchAppliedLocally: true } : newer;
}

function mergeThreadGraphs(
  stored: ReturnType<typeof normalizeCodexThreadGraph>,
  live: ReturnType<typeof normalizeCodexThreadGraph> | undefined
) {
  if (!live) return stored;
  const nodesById = { ...stored.nodesById };
  for (const [id, node] of Object.entries(live.nodesById)) {
    const existing = nodesById[id];
    if (!existing || node.updatedAt >= existing.updatedAt) nodesById[id] = node;
  }
  const activeThreadId =
    live.activeThreadId && nodesById[live.activeThreadId]
      ? live.activeThreadId
      : stored.activeThreadId && nodesById[stored.activeThreadId]
        ? stored.activeThreadId
        : null;
  return normalizeCodexThreadGraph({ activeThreadId, nodesById });
}

function newerGoal(
  stored: LocalRoomHistoryPayload["roomGoal"],
  live: LocalRoomHistoryPayload["roomGoal"]
): LocalRoomHistoryPayload["roomGoal"] {
  if (!stored) return live;
  if (!live) return stored;
  return Date.parse(live.updatedAt) >= Date.parse(stored.updatedAt) ? live : stored;
}
