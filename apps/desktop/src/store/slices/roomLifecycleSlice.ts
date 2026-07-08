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
      const currentTerminalId = state.selectedTerminalIdsByRoom[roomId] ?? null;
      const nextTerminalId = currentTerminalId && payload.terminalSnapshots.some((terminal) => terminal.id === currentTerminalId)
        ? currentTerminalId
        : payload.terminalSnapshots[0]?.id ?? null;
      const codexThreadId = normalizeCodexThreadId(payload.codexThreadId);
      const {
        threadId: _threadId,
        ...codexRuntimeWithoutThread
      } = state.codexRuntimeByRoom[roomId] ?? {};

      return {
        messagesByRoom: payload.messages.length
          ? { ...state.messagesByRoom, [roomId]: payload.messages }
          : state.messagesByRoom,
        terminalRequestsByRoom: payload.terminalRequests.length
          ? { ...state.terminalRequestsByRoom, [roomId]: payload.terminalRequests }
          : state.terminalRequestsByRoom,
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
        githubActionsEventsByRoom: payload.githubActionsEvents.length
          ? { ...state.githubActionsEventsByRoom, [roomId]: payload.githubActionsEvents }
          : state.githubActionsEventsByRoom,
        githubActionsByRoom: latestGitHubActionsEvent
          ? {
              ...state.githubActionsByRoom,
              [roomId]: {
                runs: latestGitHubActionsEvent.runs,
                lastChecked: latestGitHubActionsEvent.checkedAt,
                message: `${latestGitHubActionsEvent.summary.label}: ${latestGitHubActionsEvent.message}`
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
        selectedTerminalIdsByRoom: payload.terminalSnapshots.length && nextTerminalId
          ? { ...state.selectedTerminalIdsByRoom, [roomId]: nextTerminalId }
          : state.selectedTerminalIdsByRoom,
      };
    });
  },
  clearRoomScopedStateForRoom: (roomId) => {
    set((state) => ({
      messagesByRoom: { ...state.messagesByRoom, [roomId]: [] },
      terminalRequestsByRoom: { ...state.terminalRequestsByRoom, [roomId]: [] },
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
      githubActionsEventsByRoom: { ...state.githubActionsEventsByRoom, [roomId]: [] },
      githubActionsByRoom: omitRecordKey(state.githubActionsByRoom, roomId),
      roomSettingsByRoom: omitRecordKey(state.roomSettingsByRoom, roomId),
      roomChatByRoom: omitRecordKey(state.roomChatByRoom, roomId),
      sensitiveAttachmentReviewKey: state.sensitiveAttachmentReviewKey?.startsWith(`${roomId}:`)
        ? null
        : state.sensitiveAttachmentReviewKey,
      filePanelByRoom: omitRecordKey(state.filePanelByRoom, roomId),
      historySearchMessagesByRoom: omitRecordKey(state.historySearchMessagesByRoom, roomId),
      historyMessagesByRoom: omitRecordKey(state.historyMessagesByRoom, roomId),
      inspectorTabsByRoom: omitRecordKey(state.inspectorTabsByRoom, roomId),
      presenceByRoom: omitRecordKey(state.presenceByRoom, roomId),
      localPreviewByRoom: omitRecordKey(state.localPreviewByRoom, roomId),
      terminalLinesByRoom: omitRecordKey(state.terminalLinesByRoom, roomId),
      terminalBusyByRoom: omitRecordKey(state.terminalBusyByRoom, roomId),
      selectedTerminalIdsByRoom: omitRecordKey(state.selectedTerminalIdsByRoom, roomId),
      terminalUiByRoom: omitRecordKey(state.terminalUiByRoom, roomId),
      terminals: state.terminals.filter((terminal) => terminal.roomId !== roomId)
    }));
  }
});
