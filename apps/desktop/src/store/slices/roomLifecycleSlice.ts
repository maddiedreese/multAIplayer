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
        inviteRequestsByRoom: payload.inviteRequests.length
          ? { ...state.inviteRequestsByRoom, [roomId]: payload.inviteRequests }
          : state.inviteRequestsByRoom,
        codexEventsByRoom: payload.codexEvents.length
          ? { ...state.codexEventsByRoom, [roomId]: payload.codexEvents }
          : state.codexEventsByRoom,
        gitWorkflowEventsByRoom: payload.gitWorkflowEvents.length
          ? { ...state.gitWorkflowEventsByRoom, [roomId]: payload.gitWorkflowEvents }
          : state.gitWorkflowEventsByRoom,
        gitWorkflowMessagesByRoom: latestGitWorkflowEvent
          ? { ...state.gitWorkflowMessagesByRoom, [roomId]: latestGitWorkflowEvent.message }
          : state.gitWorkflowMessagesByRoom,
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
        localPreviewsByRoom: payload.localPreviews.length
          ? { ...state.localPreviewsByRoom, [roomId]: payload.localPreviews }
          : state.localPreviewsByRoom,
        terminals: payload.terminalSnapshots.length
          ? replaceRoomTerminalSnapshots(state.terminals, roomId, payload.terminalSnapshots)
          : state.terminals,
        selectedTerminalIdsByRoom: payload.terminalSnapshots.length && nextTerminalId
          ? { ...state.selectedTerminalIdsByRoom, [roomId]: nextTerminalId }
          : state.selectedTerminalIdsByRoom,
        hostHandoffsByRoom: payload.hostHandoffs.length
          ? { ...state.hostHandoffsByRoom, [roomId]: payload.hostHandoffs }
          : state.hostHandoffsByRoom,
        codexThreadIdsByRoom: codexThreadId
          ? { ...state.codexThreadIdsByRoom, [roomId]: codexThreadId }
          : state.codexThreadIdsByRoom
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
      inviteRequestsByRoom: { ...state.inviteRequestsByRoom, [roomId]: [] },
      codexEventsByRoom: { ...state.codexEventsByRoom, [roomId]: [] },
      gitWorkflowEventsByRoom: { ...state.gitWorkflowEventsByRoom, [roomId]: [] },
      githubActionsEventsByRoom: { ...state.githubActionsEventsByRoom, [roomId]: [] },
      hostHandoffsByRoom: { ...state.hostHandoffsByRoom, [roomId]: [] },
      codexThreadIdsByRoom: omitRecordKey(state.codexThreadIdsByRoom, roomId),
      githubActionsByRoom: omitRecordKey(state.githubActionsByRoom, roomId),
      gitWorkflowBusyByRoom: omitRecordKey(state.gitWorkflowBusyByRoom, roomId),
      hostBusyByRoom: omitRecordKey(state.hostBusyByRoom, roomId),
      hostMessagesByRoom: omitRecordKey(state.hostMessagesByRoom, roomId),
      chatMessagesByRoom: omitRecordKey(state.chatMessagesByRoom, roomId),
      filePanelByRoom: omitRecordKey(state.filePanelByRoom, roomId),
      secretWarningsVisibleByRoom: omitRecordKey(state.secretWarningsVisibleByRoom, roomId),
      historyMessagesByRoom: omitRecordKey(state.historyMessagesByRoom, roomId),
      settingsBusyByRoom: omitRecordKey(state.settingsBusyByRoom, roomId),
      settingsMessagesByRoom: omitRecordKey(state.settingsMessagesByRoom, roomId),
      customCodexModelsByRoom: omitRecordKey(state.customCodexModelsByRoom, roomId),
      projectPathDraftsByRoom: omitRecordKey(state.projectPathDraftsByRoom, roomId),
      keyRotationBusyByRoom: omitRecordKey(state.keyRotationBusyByRoom, roomId),
      approvalVisibleByRoom: omitRecordKey(state.approvalVisibleByRoom, roomId),
      pendingCodexApprovalsByRoom: omitRecordKey(state.pendingCodexApprovalsByRoom, roomId),
      codexRunningByRoom: omitRecordKey(state.codexRunningByRoom, roomId),
      roomGoalsByRoom: omitRecordKey(state.roomGoalsByRoom, roomId),
      gitStatusByRoom: omitRecordKey(state.gitStatusByRoom, roomId),
      pendingAttachmentsByRoom: omitRecordKey(state.pendingAttachmentsByRoom, roomId),
      terminalLinesByRoom: omitRecordKey(state.terminalLinesByRoom, roomId),
      terminalBusyByRoom: omitRecordKey(state.terminalBusyByRoom, roomId),
      selectedTerminalIdsByRoom: omitRecordKey(state.selectedTerminalIdsByRoom, roomId),
      terminalUiByRoom: omitRecordKey(state.terminalUiByRoom, roomId),
      terminals: state.terminals.filter((terminal) => terminal.roomId !== roomId),
      inviteLinksByRoom: omitRecordKey(state.inviteLinksByRoom, roomId),
      inviteApprovalGatesByRoom: omitRecordKey(state.inviteApprovalGatesByRoom, roomId),
      inviteMessagesByRoom: omitRecordKey(state.inviteMessagesByRoom, roomId),
      draftsByRoom: omitRecordKey(state.draftsByRoom, roomId)
    }));
  }
});
