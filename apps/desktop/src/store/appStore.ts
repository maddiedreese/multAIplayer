import { create } from "zustand";
import { normalizeCodexThreadId } from "../lib/codexThread";
import { replaceRoomTerminalSnapshots } from "../lib/terminalState";
import { createBrowserSlice, emptyBrowserState, type BrowserSlice } from "./slices/browserSlice";
import {
  createCodexHostHandoffSlice,
  emptyCodexHostHandoffState,
  type CodexHostHandoffSlice
} from "./slices/codexHostHandoffSlice";
import { createFilePanelSlice, emptyFilePanelState, type FilePanelSlice } from "./slices/filePanelSlice";
import {
  createGitWorkflowSlice,
  emptyGitWorkflowState,
  type GitWorkflowSlice
} from "./slices/gitWorkflowSlice";
import {
  createHistoryPresenceSlice,
  emptyHistoryPresenceState,
  type HistoryPresenceSlice
} from "./slices/historyPresenceSlice";
import {
  createInviteSlice,
  emptyInviteState,
  type InviteSlice
} from "./slices/inviteSlice";
import {
  createLocalPreviewSlice,
  emptyLocalPreviewState,
  type LocalPreviewSlice
} from "./slices/localPreviewSlice";
import {
  createRoomSettingsSlice,
  emptyRoomSettingsState,
  type RoomSettingsSlice
} from "./slices/roomSettingsSlice";
import { createRoomChatSlice, emptyRoomChatState, type RoomChatSlice } from "./slices/roomChatSlice";
import { createTerminalSlice, emptyTerminalState, type TerminalSlice } from "./slices/terminalSlice";
import {
  createWorkspaceDataSlice,
  emptyWorkspaceDataState,
  type WorkspaceDataSlice
} from "./slices/workspaceDataSlice";
import type { LocalRoomHistoryPayload } from "../types";
import { omitRecordKey } from "../lib/setUtils";

const emptyAppStoreState = {
  ...emptyGitWorkflowState,
  ...emptyBrowserState,
  ...emptyFilePanelState,
  ...emptyHistoryPresenceState,
  ...emptyRoomSettingsState,
  ...emptyLocalPreviewState,
  ...emptyInviteState,
  ...emptyRoomChatState,
  ...emptyCodexHostHandoffState,
  ...emptyTerminalState,
  ...emptyWorkspaceDataState
};

export interface AppStoreState
  extends BrowserSlice,
    CodexHostHandoffSlice,
    FilePanelSlice,
    GitWorkflowSlice,
    HistoryPresenceSlice,
    InviteSlice,
    LocalPreviewSlice,
    RoomSettingsSlice,
    RoomChatSlice,
    TerminalSlice,
    WorkspaceDataSlice {
  hydrateLocalRoomHistoryForRoom: (roomId: string, payload: LocalRoomHistoryPayload) => void;
  clearRoomScopedStateForRoom: (roomId: string) => void;
  resetAppStore: () => void;
  resetGitWorkflowState: () => void;
}

export const useAppStore = create<AppStoreState>((set, get, api) => ({
  ...emptyAppStoreState,
  ...createBrowserSlice(set, get, api),
  ...createCodexHostHandoffSlice(set, get, api),
  ...createFilePanelSlice(set, get, api),
  ...createGitWorkflowSlice(set, get, api),
  ...createHistoryPresenceSlice(set, get, api),
  ...createInviteSlice(set, get, api),
  ...createLocalPreviewSlice(set, get, api),
  ...createRoomSettingsSlice(set, get, api),
  ...createRoomChatSlice(set, get, api),
  ...createTerminalSlice(set, get, api),
  ...createWorkspaceDataSlice(set, get, api),
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
        browserRequestsByRoom: payload.browserRequests.length
          ? { ...state.browserRequestsByRoom, [roomId]: payload.browserRequests }
          : state.browserRequestsByRoom,
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
        actionRunsByRoom: latestGitHubActionsEvent
          ? { ...state.actionRunsByRoom, [roomId]: latestGitHubActionsEvent.runs }
          : state.actionRunsByRoom,
        actionsLastCheckedByRoom: latestGitHubActionsEvent
          ? { ...state.actionsLastCheckedByRoom, [roomId]: latestGitHubActionsEvent.checkedAt }
          : state.actionsLastCheckedByRoom,
        actionsMessagesByRoom: latestGitHubActionsEvent
          ? {
              ...state.actionsMessagesByRoom,
              [roomId]: `${latestGitHubActionsEvent.summary.label}: ${latestGitHubActionsEvent.message}`
            }
          : state.actionsMessagesByRoom,
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
      browserRequestsByRoom: { ...state.browserRequestsByRoom, [roomId]: [] },
      inviteRequestsByRoom: { ...state.inviteRequestsByRoom, [roomId]: [] },
      codexEventsByRoom: { ...state.codexEventsByRoom, [roomId]: [] },
      gitWorkflowEventsByRoom: { ...state.gitWorkflowEventsByRoom, [roomId]: [] },
      githubActionsEventsByRoom: { ...state.githubActionsEventsByRoom, [roomId]: [] },
      hostHandoffsByRoom: { ...state.hostHandoffsByRoom, [roomId]: [] },
      codexThreadIdsByRoom: omitRecordKey(state.codexThreadIdsByRoom, roomId),
      actionRunsByRoom: omitRecordKey(state.actionRunsByRoom, roomId),
      actionsLastCheckedByRoom: omitRecordKey(state.actionsLastCheckedByRoom, roomId),
      actionsMessagesByRoom: omitRecordKey(state.actionsMessagesByRoom, roomId),
      actionsBusyByRoom: omitRecordKey(state.actionsBusyByRoom, roomId),
      gitWorkflowBusyByRoom: omitRecordKey(state.gitWorkflowBusyByRoom, roomId),
      hostBusyByRoom: omitRecordKey(state.hostBusyByRoom, roomId),
      hostMessagesByRoom: omitRecordKey(state.hostMessagesByRoom, roomId),
      chatMessagesByRoom: omitRecordKey(state.chatMessagesByRoom, roomId),
      markdownCopyFallbacksByRoom: omitRecordKey(state.markdownCopyFallbacksByRoom, roomId),
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
      browserStatusByRoom: omitRecordKey(state.browserStatusByRoom, roomId),
      activeBrowserUrlsByRoom: omitRecordKey(state.activeBrowserUrlsByRoom, roomId),
      gitStatusByRoom: omitRecordKey(state.gitStatusByRoom, roomId),
      fileQueriesByRoom: omitRecordKey(state.fileQueriesByRoom, roomId),
      projectFilesByRoom: omitRecordKey(state.projectFilesByRoom, roomId),
      selectedFilesByRoom: omitRecordKey(state.selectedFilesByRoom, roomId),
      selectedDiffsByRoom: omitRecordKey(state.selectedDiffsByRoom, roomId),
      fileBusyByRoom: omitRecordKey(state.fileBusyByRoom, roomId),
      fileMessagesByRoom: omitRecordKey(state.fileMessagesByRoom, roomId),
      pendingAttachmentsByRoom: omitRecordKey(state.pendingAttachmentsByRoom, roomId),
      terminalLinesByRoom: omitRecordKey(state.terminalLinesByRoom, roomId),
      terminalBusyByRoom: omitRecordKey(state.terminalBusyByRoom, roomId),
      selectedTerminalIdsByRoom: omitRecordKey(state.selectedTerminalIdsByRoom, roomId),
      terminalNamesByRoom: omitRecordKey(state.terminalNamesByRoom, roomId),
      terminalCommandsByRoom: omitRecordKey(state.terminalCommandsByRoom, roomId),
      terminalInputsByRoom: omitRecordKey(state.terminalInputsByRoom, roomId),
      terminalErrorsByRoom: omitRecordKey(state.terminalErrorsByRoom, roomId),
      terminals: state.terminals.filter((terminal) => terminal.roomId !== roomId),
      browserUrlsByRoom: omitRecordKey(state.browserUrlsByRoom, roomId),
      browserReasonsByRoom: omitRecordKey(state.browserReasonsByRoom, roomId),
      browserMessagesByRoom: omitRecordKey(state.browserMessagesByRoom, roomId),
      inviteLinksByRoom: omitRecordKey(state.inviteLinksByRoom, roomId),
      inviteApprovalGatesByRoom: omitRecordKey(state.inviteApprovalGatesByRoom, roomId),
      inviteMessagesByRoom: omitRecordKey(state.inviteMessagesByRoom, roomId),
      draftsByRoom: omitRecordKey(state.draftsByRoom, roomId)
    }));
  },
  resetAppStore: () => set(emptyAppStoreState),
  resetGitWorkflowState: () => set(emptyAppStoreState)
}));
