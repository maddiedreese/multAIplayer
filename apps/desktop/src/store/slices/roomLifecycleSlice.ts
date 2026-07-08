import type { StateCreator } from "zustand";
import { normalizeCodexThreadId } from "../../lib/codexThread";
import { omitRecordKey } from "../../lib/setUtils";
import { replaceRoomTerminalSnapshots } from "../../lib/terminalState";
import type { LocalRoomHistoryPayload } from "../../types";
import type { AppStoreState } from "../appStore";

export interface RoomLifecycleSlice {
  hydrateLocalRoomHistoryForRoom: (roomId: string, payload: LocalRoomHistoryPayload) => void;
  clearRoomScopedStateForRoom: (roomId: string) => void;
}

export const createRoomLifecycleSlice: StateCreator<AppStoreState, [], [], RoomLifecycleSlice> = (set) => ({
  hydrateLocalRoomHistoryForRoom: (roomId, payload) => {
    set((state) => {
      const latestGitWorkflowEvent = payload.gitWorkflowEvents.at(-1);
      const latestGitHubActionsEvent = payload.githubActionsEvents.at(-1);
      const currentTerminalId = state.terminalRuntimeByRoom[roomId]?.selectedTerminalId ?? null;
      const nextTerminalId = currentTerminalId && payload.terminalSnapshots.some((terminal) => terminal.id === currentTerminalId)
        ? currentTerminalId
        : payload.terminalSnapshots[0]?.id ?? null;
      const shouldHydrateTerminalRuntime = payload.terminalRequests.length > 0 || Boolean(payload.terminalSnapshots.length && nextTerminalId);
      const codexThreadId = normalizeCodexThreadId(payload.codexThreadId);
      const {
        threadId: _threadId,
        ...codexRuntimeWithoutThread
      } = state.codexRuntimeByRoom[roomId] ?? {};

      return {
        messagesByRoom: payload.messages.length
          ? { ...state.messagesByRoom, [roomId]: payload.messages }
          : state.messagesByRoom,
        terminalRuntimeByRoom: shouldHydrateTerminalRuntime
          ? {
              ...state.terminalRuntimeByRoom,
              [roomId]: {
                ...state.terminalRuntimeByRoom[roomId],
                ...(payload.terminalRequests.length ? { requests: payload.terminalRequests } : {}),
                ...(payload.terminalSnapshots.length && nextTerminalId ? { selectedTerminalId: nextTerminalId } : {})
              }
            }
          : state.terminalRuntimeByRoom,
        browserByRoom: payload.browserRequests.length
          ? {
              ...state.browserByRoom,
              [roomId]: {
                ...state.browserByRoom[roomId],
                requests: payload.browserRequests
              }
            }
          : state.browserByRoom,
        inviteByRoom: payload.inviteRequests.length
          ? {
              ...state.inviteByRoom,
              [roomId]: {
                ...state.inviteByRoom[roomId],
                requests: payload.inviteRequests
              }
            }
          : state.inviteByRoom,
        codexRuntimeByRoom: {
          ...state.codexRuntimeByRoom,
          [roomId]: {
            ...codexRuntimeWithoutThread,
            events: payload.codexEvents,
            hostHandoffs: payload.hostHandoffs,
            ...(codexThreadId ? { threadId: codexThreadId } : {})
          }
        },
        gitWorkflowByRoom: payload.gitWorkflowEvents.length
          ? {
              ...state.gitWorkflowByRoom,
              [roomId]: {
                ...state.gitWorkflowByRoom[roomId],
                events: payload.gitWorkflowEvents,
                message: latestGitWorkflowEvent?.message ?? null
              }
            }
          : state.gitWorkflowByRoom,
        githubActionsByRoom: payload.githubActionsEvents.length
          ? {
              ...state.githubActionsByRoom,
              [roomId]: {
                ...state.githubActionsByRoom[roomId],
                events: payload.githubActionsEvents,
                ...(latestGitHubActionsEvent ? {
                  runs: latestGitHubActionsEvent.runs,
                  lastChecked: latestGitHubActionsEvent.checkedAt,
                  message: `${latestGitHubActionsEvent.summary.label}: ${latestGitHubActionsEvent.message}`
                } : {})
              }
            }
          : state.githubActionsByRoom,
        localPreviewByRoom: payload.localPreviews.length
          ? {
              ...state.localPreviewByRoom,
              [roomId]: {
                ...state.localPreviewByRoom[roomId],
                previews: payload.localPreviews
              }
            }
          : state.localPreviewByRoom,
        terminals: payload.terminalSnapshots.length
          ? replaceRoomTerminalSnapshots(state.terminals, roomId, payload.terminalSnapshots)
          : state.terminals,
      };
    });
  },
  clearRoomScopedStateForRoom: (roomId) => {
    set((state) => ({
      messagesByRoom: { ...state.messagesByRoom, [roomId]: [] },
      terminalRuntimeByRoom: {
        ...state.terminalRuntimeByRoom,
        [roomId]: { requests: [] }
      },
      browserByRoom: {
        ...state.browserByRoom,
        [roomId]: {
          requests: []
        }
      },
      inviteByRoom: omitRecordKey(state.inviteByRoom, roomId),
      codexRuntimeByRoom: {
        ...state.codexRuntimeByRoom,
        [roomId]: {
          events: [],
          hostHandoffs: []
        }
      },
      gitWorkflowByRoom: {
        ...state.gitWorkflowByRoom,
        [roomId]: {
          events: []
        }
      },
      githubActionsByRoom: {
        ...state.githubActionsByRoom,
        [roomId]: { events: [] }
      },
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
