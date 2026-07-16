import type { AppStoreState } from "../../store/appStore";
import { useAppStore } from "../../store/appStore";
import type { LocalRoomHistoryPayload } from "../../types";
import { loadHistorySettings, queueEncryptedHistorySave } from "../../lib/history/localHistory";
import { pruneLocalRoomHistory } from "../../lib/history/localRoomHistoryPayload";
import { localRoomReadStateForHistory } from "../../lib/history/roomUnread";
import { terminalsForLocalHistory } from "../../lib/terminal/terminalState";

export const historyHydrationFailureMessage =
  "Encrypted local history could not be loaded. Saving is paused to protect the existing history. Retry the load before continuing.";
export const historySaveFailureMessage =
  "Encrypted local history could not be saved. New history will be retried after the next change.";

export function localHistoryPayloadForRoom(
  state: AppStoreState,
  roomId: string,
  retentionDays: number
): LocalRoomHistoryPayload {
  const room = state.rooms.find((candidate) => candidate.id === roomId);
  if (!room) throw new Error(`Cannot snapshot unknown room ${roomId}.`);
  return pruneLocalRoomHistory(
    {
      version: 3,
      ...roomHistoryFields(state, roomId),
      readState: localRoomReadStateForHistory(room, state.messagesByRoom[roomId] ?? []),
      ...codexHistoryFields(state, roomId),
      ...gitHistoryFields(state, roomId),
      localPreviews: state.localPreviewByRoom[roomId]?.previews ?? [],
      terminalSnapshots: terminalsForLocalHistory(state.terminals.filter((terminal) => terminal.roomId === roomId))
    },
    retentionDays
  );
}

function roomHistoryFields(state: AppStoreState, roomId: string) {
  return {
    messages: state.messagesByRoom[roomId] ?? [],
    chatEdits: state.chatEditsByRoom[roomId] ?? [],
    chatDeletes: state.chatDeletesByRoom[roomId] ?? [],
    terminalRequests: state.terminalRuntimeByRoom[roomId]?.requests ?? [],
    fileSaveRequests: state.filePanelByRoom[roomId]?.saveRequests ?? [],
    browserRequests: state.browserByRoom[roomId]?.requests ?? [],
    inviteRequests: state.inviteByRoom[roomId]?.requests ?? []
  };
}

function codexHistoryFields(state: AppStoreState, roomId: string) {
  const runtime = state.codexRuntimeByRoom[roomId] ?? {};
  return {
    codexEvents: runtime.events ?? [],
    codexActivities: runtime.activities ?? [],
    hostHandoffs: runtime.hostHandoffs ?? [],
    queuedCodexTurns: runtime.queuedApprovals ?? [],
    ...(runtime.goal ? { roomGoal: runtime.goal } : {}),
    ...(runtime.threadGraph?.activeThreadId ? { codexThreadGraph: runtime.threadGraph } : {})
  };
}

function gitHistoryFields(state: AppStoreState, roomId: string) {
  const runtime = state.gitWorkflowRuntimeByRoom[roomId] ?? {};
  return {
    gitWorkflowEvents: runtime.workflow?.events ?? [],
    githubActionsEvents: runtime.actions?.events ?? []
  };
}

export function prepareCurrentEligibleHistorySnapshots(state: AppStoreState): {
  token: string;
  enqueue: () => void;
} {
  const snapshots = currentEligibleHistorySnapshots(state);
  return {
    token: JSON.stringify(snapshots),
    enqueue: () => {
      for (const [roomId, payload] of snapshots) {
        queueEncryptedHistorySave(
          roomId,
          payload,
          (error) => markHistorySaveFailure(roomId, error),
          () => clearMatchingHistoryMessage(roomId, historySaveFailureMessage)
        );
      }
    }
  };
}

export function currentEligibleHistorySnapshots(state: AppStoreState): Array<[string, LocalRoomHistoryPayload]> {
  const tokens: Array<[string, LocalRoomHistoryPayload]> = [];
  for (const room of state.rooms) {
    const presence = state.historyPresenceByRoom[room.id];
    if (
      presence?.historyHydrationStatus !== "ready" ||
      state.forgottenRoomIds.has(room.id) ||
      state.revokedRoomIds.has(room.id) ||
      state.revokedTeamIds.has(room.teamId)
    ) {
      continue;
    }
    const settings = loadHistorySettings(room.id);
    if (!settings.enabled) continue;
    const payload = localHistoryPayloadForRoom(state, room.id, settings.retentionDays);
    tokens.push([room.id, payload]);
  }
  return tokens;
}

export function markHistorySaveFailure(roomId: string, _error: unknown): void {
  useAppStore.getState().setHistoryMessageForRoom(roomId, historySaveFailureMessage);
}

export function clearMatchingHistoryMessage(roomId: string, message: string): void {
  const state = useAppStore.getState();
  if (state.historyPresenceByRoom[roomId]?.historyMessage === message) {
    state.setHistoryMessageForRoom(roomId, null);
  }
}
