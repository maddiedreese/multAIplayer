import { create } from "zustand";
import type { SetStateAction } from "react";
import type { GitHubActionRun } from "../lib/authClient";
import type {
  GitStatusSummary
} from "../lib/localBackend";
import { updateGitWorkflowDraftRecord, type GitWorkflowDraft } from "../lib/gitWorkflowDraft";
import { normalizeCodexThreadId } from "../lib/codexThread";
import { replaceRoomTerminalSnapshots } from "../lib/terminalState";
import { createBrowserSlice, emptyBrowserState, type BrowserSlice } from "./slices/browserSlice";
import { createFilePanelSlice, emptyFilePanelState, type FilePanelSlice } from "./slices/filePanelSlice";
import { createRoomChatSlice, emptyRoomChatState, type RoomChatSlice } from "./slices/roomChatSlice";
import { createTerminalSlice, emptyTerminalState, type TerminalSlice } from "./slices/terminalSlice";
import { resolveSetStateAction } from "./storeUtils";
import type {
  ChatMessage,
  CodexRoomEvent,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewDialogState,
  LocalPreviewRecord,
  LocalRoomHistoryPayload,
  PendingCodexApproval,
  RoomPresence,
  RoomGoal,
} from "../types";
import type { InspectorTab } from "../components/RoomInspectorPanel";
import type {
  ChatReactionPlaintextPayload,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  TeamMemberRecord
} from "@multaiplayer/protocol";
import { omitRecordKey } from "../lib/setUtils";

type GitStatusByRoom = Record<string, GitStatusSummary | null>;
type GitWorkflowBusyByRoom = Record<string, boolean>;
type GitWorkflowMessagesByRoom = Record<string, string | null>;
type GitWorkflowDraftsByRoom = Record<string, Partial<GitWorkflowDraft>>;
type ActionsBusyByRoom = Record<string, boolean>;
type ActionsMessagesByRoom = Record<string, string | null>;
type ActionRunsByRoom = Record<string, GitHubActionRun[]>;
type ActionsLastCheckedByRoom = Record<string, string | null>;
type HostBusyByRoom = Record<string, boolean>;
type HostMessagesByRoom = Record<string, string | null>;
type SettingsBusyByRoom = Record<string, boolean>;
type SettingsMessagesByRoom = Record<string, string | null>;
type CustomCodexModelsByRoom = Record<string, string>;
type ProjectPathDraftsByRoom = Record<string, string>;
type LocalPreviewsByRoom = Record<string, LocalPreviewRecord[]>;
type LocalPreviewBusyByRoom = Record<string, boolean>;
type InviteRequestsByRoom = Record<string, InviteJoinRequest[]>;
type InviteLinksByRoom = Record<string, string>;
type InviteApprovalGatesByRoom = Record<string, boolean>;
type InviteMessagesByRoom = Record<string, string | null>;
type KeyRotationBusyByRoom = Record<string, boolean>;
type InviteAdmissionsByRoom = Record<string, string>;
type CodexEventsByRoom = Record<string, CodexRoomEvent[]>;
type ApprovalVisibleByRoom = Record<string, boolean>;
type PendingCodexApprovalsByRoom = Record<string, PendingCodexApproval>;
type CodexRunningByRoom = Record<string, boolean>;
type RoomGoalsByRoom = Record<string, RoomGoal>;
type SecretWarningsVisibleByRoom = Record<string, boolean>;
type CodexThreadIdsByRoom = Record<string, string>;
type HistorySearchMessagesByRoom = Record<string, ChatMessage[]>;
type HistoryMessagesByRoom = Record<string, string | null>;
type TeamHistoryMessagesByTeam = Record<string, string | null>;
type InspectorTabsByRoom = Record<string, InspectorTab>;
type PresenceByRoom = Record<string, Record<string, RoomPresence>>;
type HostHandoffsByRoom = Record<string, HostHandoffRecord[]>;
type CodexContinuationByRoom = Record<string, HostHandoffRecord>;
type GitWorkflowEventsByRoom = Record<string, GitWorkflowEventPlaintextPayload[]>;
type GitHubActionsEventsByRoom = Record<string, GitHubActionsEventPlaintextPayload[]>;
type TeamMembersByTeam = Record<string, TeamMemberRecord[]>;
type TeamMembersMessageByTeam = Record<string, string | null>;
type TeamMembersBusyByTeam = Record<string, boolean>;
type MessagesByRoom = Record<string, ChatMessage[]>;
type RoomBusyByRoom = Record<string, boolean>;

const emptyLocalPreviewDialog: LocalPreviewDialogState = {
  open: false,
  phase: "select",
  roomId: "",
  candidates: [],
  selectedUrl: "",
  manualUrl: "",
  error: null,
  cloudflaredVersion: null
};

const emptyAppStoreState = {
  gitStatusByRoom: {},
  gitWorkflowBusyByRoom: {},
  gitWorkflowMessagesByRoom: {},
  gitWorkflowDraftsByRoom: {},
  actionsBusyByRoom: {},
  actionsMessagesByRoom: {},
  actionRunsByRoom: {},
  actionsLastCheckedByRoom: {},
  ...emptyBrowserState,
  ...emptyFilePanelState,
  hostBusyByRoom: {},
  hostMessagesByRoom: {},
  settingsBusyByRoom: {},
  settingsMessagesByRoom: {},
  customCodexModelsByRoom: {},
  projectPathDraftsByRoom: {},
  localPreviewsByRoom: {},
  localPreviewDialog: emptyLocalPreviewDialog,
  localPreviewBusyByRoom: {},
  inviteRequestsByRoom: {},
  inviteSecretInput: "",
  inviteLinksByRoom: {},
  inviteApprovalGatesByRoom: {},
  inviteMessagesByRoom: {},
  keyRotationBusyByRoom: {},
  inviteAdmissionsByRoom: {},
  ...emptyRoomChatState,
  codexEventsByRoom: {},
  approvalVisibleByRoom: {},
  pendingCodexApprovalsByRoom: {},
  codexRunningByRoom: {},
  roomGoalsByRoom: {},
  secretWarningsVisibleByRoom: {},
  codexThreadIdsByRoom: {},
  historySearchMessagesByRoom: {},
  historyMessagesByRoom: {},
  teamHistoryMessagesByTeam: {},
  inspectorTabsByRoom: {},
  presenceByRoom: {},
  hostHandoffsByRoom: {},
  codexContinuationByRoom: {},
  gitWorkflowEventsByRoom: {},
  githubActionsEventsByRoom: {},
  ...emptyTerminalState,
  teamMembersByTeam: {},
  teamMembersMessageByTeam: {},
  teamMembersBusyByTeam: {},
  messagesByRoom: {}
};

function updateRoomBusyMap(current: RoomBusyByRoom, roomId: string, busy: boolean): RoomBusyByRoom {
  return busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId);
}

export interface AppStoreState extends BrowserSlice, FilePanelSlice, RoomChatSlice, TerminalSlice {
  gitStatusByRoom: GitStatusByRoom;
  gitWorkflowBusyByRoom: GitWorkflowBusyByRoom;
  gitWorkflowMessagesByRoom: GitWorkflowMessagesByRoom;
  gitWorkflowDraftsByRoom: GitWorkflowDraftsByRoom;
  actionsBusyByRoom: ActionsBusyByRoom;
  actionsMessagesByRoom: ActionsMessagesByRoom;
  actionRunsByRoom: ActionRunsByRoom;
  actionsLastCheckedByRoom: ActionsLastCheckedByRoom;
  hostBusyByRoom: HostBusyByRoom;
  hostMessagesByRoom: HostMessagesByRoom;
  settingsBusyByRoom: SettingsBusyByRoom;
  settingsMessagesByRoom: SettingsMessagesByRoom;
  customCodexModelsByRoom: CustomCodexModelsByRoom;
  projectPathDraftsByRoom: ProjectPathDraftsByRoom;
  localPreviewsByRoom: LocalPreviewsByRoom;
  localPreviewDialog: LocalPreviewDialogState;
  localPreviewBusyByRoom: LocalPreviewBusyByRoom;
  inviteRequestsByRoom: InviteRequestsByRoom;
  inviteSecretInput: string;
  inviteLinksByRoom: InviteLinksByRoom;
  inviteApprovalGatesByRoom: InviteApprovalGatesByRoom;
  inviteMessagesByRoom: InviteMessagesByRoom;
  keyRotationBusyByRoom: KeyRotationBusyByRoom;
  inviteAdmissionsByRoom: InviteAdmissionsByRoom;
  codexEventsByRoom: CodexEventsByRoom;
  approvalVisibleByRoom: ApprovalVisibleByRoom;
  pendingCodexApprovalsByRoom: PendingCodexApprovalsByRoom;
  codexRunningByRoom: CodexRunningByRoom;
  roomGoalsByRoom: RoomGoalsByRoom;
  secretWarningsVisibleByRoom: SecretWarningsVisibleByRoom;
  codexThreadIdsByRoom: CodexThreadIdsByRoom;
  historySearchMessagesByRoom: HistorySearchMessagesByRoom;
  historyMessagesByRoom: HistoryMessagesByRoom;
  teamHistoryMessagesByTeam: TeamHistoryMessagesByTeam;
  inspectorTabsByRoom: InspectorTabsByRoom;
  presenceByRoom: PresenceByRoom;
  hostHandoffsByRoom: HostHandoffsByRoom;
  codexContinuationByRoom: CodexContinuationByRoom;
  gitWorkflowEventsByRoom: GitWorkflowEventsByRoom;
  githubActionsEventsByRoom: GitHubActionsEventsByRoom;
  teamMembersByTeam: TeamMembersByTeam;
  teamMembersMessageByTeam: TeamMembersMessageByTeam;
  teamMembersBusyByTeam: TeamMembersBusyByTeam;
  messagesByRoom: MessagesByRoom;
  setActionsMessageForRoom: (roomId: string, message: string | null) => void;
  setActionRunsForRoom: (roomId: string, runs: GitHubActionRun[]) => void;
  setActionsLastCheckedForRoom: (roomId: string, checkedAt: string | null) => void;
  resetGitHubActionsStateForRoom: (roomId: string) => void;
  setInspectorTabForRoom: (roomId: string, tab: InspectorTab) => void;
  setLocalPreviewDialog: (action: SetStateAction<LocalPreviewDialogState>) => void;
  setInviteRequestsForRoom: (roomId: string, requests: InviteJoinRequest[]) => void;
  setInviteSecretInputValue: (value: string) => void;
  clearInviteSecretInput: () => void;
  setInviteAdmissionForRoom: (roomId: string, inviteId: string | null) => void;
  clearInviteAdmissionForRoom: (roomId: string) => void;
  replaceHistorySearchMessagesByRoom: (messagesByRoom: HistorySearchMessagesByRoom) => void;
  clearPresenceByRoom: () => void;
  clearPresenceForRoom: (roomId: string) => void;
  setRoomPresenceForDevice: (roomId: string, deviceId: string, presence: RoomPresence | null) => void;
  setTeamMembersByTeam: (action: SetStateAction<TeamMembersByTeam>) => void;
  setTeamMembersMessageByTeam: (action: SetStateAction<TeamMembersMessageByTeam>) => void;
  setTeamMembersBusyByTeam: (action: SetStateAction<TeamMembersBusyByTeam>) => void;
  setTeamMembersForTeam: (teamId: string, members: TeamMemberRecord[]) => void;
  setTeamMembersMessageForTeam: (teamId: string, message: string | null) => void;
  setTeamMembersBusyForTeam: (teamId: string, busy: boolean) => void;
  ensureLocalTeamMemberForTeam: (teamId: string, userId: string, role: TeamMemberRecord["role"]) => void;
  setMessagesByRoom: (action: SetStateAction<MessagesByRoom>) => void;
  initializeMessagesForRoom: (roomId: string) => void;
  hydrateLocalRoomHistoryForRoom: (roomId: string, payload: LocalRoomHistoryPayload) => void;
  appendRoomMessage: (roomId: string, message: ChatMessage) => void;
  applyMessageReaction: (roomId: string, reaction: ChatReactionPlaintextPayload) => void;
  setGitWorkflowBusyForRoom: (roomId: string, busy: boolean) => void;
  setActionsBusyForRoom: (roomId: string, busy: boolean) => void;
  setLocalPreviewBusyForRoom: (roomId: string, busy: boolean) => void;
  setHostBusyForRoom: (roomId: string, busy: boolean) => void;
  setSettingsBusyForRoom: (roomId: string, busy: boolean) => void;
  setKeyRotationBusyForRoom: (roomId: string, busy: boolean) => void;
  updateInviteRequestStatus: (roomId: string, requestId: string, status: InviteJoinRequest["status"]) => void;
  appendGitWorkflowEvent: (roomId: string, event: GitWorkflowEventPlaintextPayload) => void;
  appendGitHubActionsEvent: (roomId: string, event: GitHubActionsEventPlaintextPayload) => void;
  appendLocalPreviewEvent: (roomId: string, event: LocalPreviewRecord) => void;
  appendHostHandoff: (roomId: string, handoff: HostHandoffRecord) => void;
  markHostHandoffAcceptedForRoom: (roomId: string, handoffId: string) => void;
  markLatestHostHandoffAcceptedForRoom: (roomId: string) => void;
  setCodexContinuationForRoom: (roomId: string, handoff: HostHandoffRecord | null) => void;
  appendInviteRequest: (roomId: string, request: InviteJoinRequest) => void;
  appendCodexEvent: (roomId: string, event: CodexRoomEvent) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  setPendingCodexApprovalForRoom: (roomId: string, approval: PendingCodexApproval | null) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  setCodexRunningForRoom: (roomId: string, running: boolean) => void;
  setRoomGoalForRoom: (roomId: string, goal: RoomGoal | null) => void;
  setCodexThreadIdForRoom: (roomId: string, threadId: string | null) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setSecretWarningVisibleForRoom: (roomId: string, visible: boolean) => void;
  setHistoryMessageForRoom: (roomId: string, message: string | null) => void;
  setTeamHistoryMessageForTeam: (teamId: string, message: string | null) => void;
  setSettingsMessageForRoom: (roomId: string, message: string | null) => void;
  setGitWorkflowMessageForRoom: (roomId: string, message: string | null) => void;
  setGitStatusForRoom: (roomId: string, status: GitStatusSummary | null) => void;
  updateGitWorkflowDraftForRoom: (roomId: string, patch: Partial<GitWorkflowDraft>) => void;
  setInviteLinkForRoom: (roomId: string, link: string) => void;
  setInviteApprovalGateForRoom: (roomId: string, enabled: boolean) => void;
  setInviteMessageForRoom: (roomId: string, message: string | null) => void;
  setCustomCodexModelForRoom: (roomId: string, model: string, currentModel: string) => void;
  setProjectPathDraftForRoom: (roomId: string, projectPath: string, currentProjectPath: string) => void;
  clearRoomScopedStateForRoom: (roomId: string) => void;
  resetAppStore: () => void;
  resetGitWorkflowState: () => void;
}

export const useAppStore = create<AppStoreState>((set, get, api) => ({
  ...emptyAppStoreState,
  ...createBrowserSlice(set, get, api),
  ...createFilePanelSlice(set, get, api),
  ...createRoomChatSlice(set, get, api),
  ...createTerminalSlice(set, get, api),
  setActionsMessageForRoom: (roomId, message) => {
    set((state) => ({
      actionsMessagesByRoom: message
        ? { ...state.actionsMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.actionsMessagesByRoom, roomId)
    }));
  },
  setActionRunsForRoom: (roomId, runs) => {
    set((state) => ({
      actionRunsByRoom: {
        ...state.actionRunsByRoom,
        [roomId]: runs
      }
    }));
  },
  setActionsLastCheckedForRoom: (roomId, checkedAt) => {
    set((state) => ({
      actionsLastCheckedByRoom: checkedAt
        ? { ...state.actionsLastCheckedByRoom, [roomId]: checkedAt }
        : omitRecordKey(state.actionsLastCheckedByRoom, roomId)
    }));
  },
  resetGitHubActionsStateForRoom: (roomId) => {
    set((state) => ({
      actionRunsByRoom: {
        ...state.actionRunsByRoom,
        [roomId]: []
      },
      actionsLastCheckedByRoom: omitRecordKey(state.actionsLastCheckedByRoom, roomId),
      actionsMessagesByRoom: omitRecordKey(state.actionsMessagesByRoom, roomId),
      actionsBusyByRoom: omitRecordKey(state.actionsBusyByRoom, roomId)
    }));
  },
  setInspectorTabForRoom: (roomId, tab) => {
    set((state) => ({
      inspectorTabsByRoom: {
        ...state.inspectorTabsByRoom,
        [roomId]: tab
      }
    }));
  },
  setLocalPreviewDialog: (action) => {
    set((state) => ({
      localPreviewDialog: resolveSetStateAction(state.localPreviewDialog, action)
    }));
  },
  setInviteRequestsForRoom: (roomId, requests) => {
    set((state) => ({
      inviteRequestsByRoom: {
        ...state.inviteRequestsByRoom,
        [roomId]: requests
      }
    }));
  },
  setInviteSecretInputValue: (value) => {
    set({ inviteSecretInput: value });
  },
  clearInviteSecretInput: () => {
    set({ inviteSecretInput: "" });
  },
  setInviteAdmissionForRoom: (roomId, inviteId) => {
    set((state) => ({
      inviteAdmissionsByRoom: inviteId
        ? { ...state.inviteAdmissionsByRoom, [roomId]: inviteId }
        : omitRecordKey(state.inviteAdmissionsByRoom, roomId)
    }));
  },
  clearInviteAdmissionForRoom: (roomId) => {
    set((state) => ({
      inviteAdmissionsByRoom: omitRecordKey(state.inviteAdmissionsByRoom, roomId)
    }));
  },
  replaceHistorySearchMessagesByRoom: (messagesByRoom) => {
    set({ historySearchMessagesByRoom: messagesByRoom });
  },
  clearPresenceByRoom: () => {
    set({ presenceByRoom: {} });
  },
  clearPresenceForRoom: (roomId) => {
    set((state) => ({
      presenceByRoom: omitRecordKey(state.presenceByRoom, roomId)
    }));
  },
  setRoomPresenceForDevice: (roomId, deviceId, presence) => {
    set((state) => {
      const roomPresence = state.presenceByRoom[roomId] ?? {};
      const nextRoomPresence = presence
        ? { ...roomPresence, [deviceId]: presence }
        : omitRecordKey(roomPresence, deviceId);
      return {
        presenceByRoom: {
          ...state.presenceByRoom,
          [roomId]: nextRoomPresence
        }
      };
    });
  },
  setTeamMembersByTeam: (action) => {
    set((state) => ({
      teamMembersByTeam: resolveSetStateAction(state.teamMembersByTeam, action)
    }));
  },
  setTeamMembersMessageByTeam: (action) => {
    set((state) => ({
      teamMembersMessageByTeam: resolveSetStateAction(state.teamMembersMessageByTeam, action)
    }));
  },
  setTeamMembersBusyByTeam: (action) => {
    set((state) => ({
      teamMembersBusyByTeam: resolveSetStateAction(state.teamMembersBusyByTeam, action)
    }));
  },
  setTeamMembersForTeam: (teamId, members) => {
    set((state) => ({
      teamMembersByTeam: {
        ...state.teamMembersByTeam,
        [teamId]: members
      }
    }));
  },
  setTeamMembersMessageForTeam: (teamId, message) => {
    set((state) => ({
      teamMembersMessageByTeam: {
        ...state.teamMembersMessageByTeam,
        [teamId]: message
      }
    }));
  },
  setTeamMembersBusyForTeam: (teamId, busy) => {
    set((state) => ({
      teamMembersBusyByTeam: {
        ...state.teamMembersBusyByTeam,
        [teamId]: busy
      }
    }));
  },
  ensureLocalTeamMemberForTeam: (teamId, userId, role) => {
    set((state) => {
      if (state.teamMembersByTeam[teamId]?.some((member) => member.userId === userId)) return state;
      return {
        teamMembersByTeam: {
          ...state.teamMembersByTeam,
          [teamId]: [{
            teamId,
            userId,
            role,
            joinedAt: new Date().toISOString()
          }]
        }
      };
    });
  },
  setMessagesByRoom: (action) => {
    set((state) => ({
      messagesByRoom: resolveSetStateAction(state.messagesByRoom, action)
    }));
  },
  initializeMessagesForRoom: (roomId) => {
    set((state) => {
      if (state.messagesByRoom[roomId]) return state;
      return {
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: []
        }
      };
    });
  },
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
  appendRoomMessage: (roomId, message) => {
    set((state) => {
      const roomMessages = state.messagesByRoom[roomId] ?? [];
      if (roomMessages.some((existing) => existing.id === message.id)) return state;
      return {
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: [...roomMessages, message]
        }
      };
    });
  },
  applyMessageReaction: (roomId, reaction) => {
    set((state) => {
      const roomMessages = state.messagesByRoom[roomId] ?? [];
      return {
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: roomMessages.map((message) => {
            if (message.id !== reaction.messageId) return message;
            const reactions = message.reactions ?? [];
            const existing = reactions.find((item) => item.emoji === reaction.emoji);
            const reactors = existing?.reactors.filter((reactor) => reactor.userId !== reaction.reactorUserId) ?? [];
            const nextReactors = reaction.action === "add"
              ? [...reactors, { userId: reaction.reactorUserId, name: reaction.reactor }]
              : reactors;
            return {
              ...message,
              reactions: [
                ...reactions.filter((item) => item.emoji !== reaction.emoji),
                ...(nextReactors.length ? [{ emoji: reaction.emoji, reactors: nextReactors }] : [])
              ]
            };
          })
        }
      };
    });
  },
  setGitWorkflowBusyForRoom: (roomId, busy) => {
    set((state) => ({
      gitWorkflowBusyByRoom: updateRoomBusyMap(state.gitWorkflowBusyByRoom, roomId, busy)
    }));
  },
  setActionsBusyForRoom: (roomId, busy) => {
    set((state) => ({
      actionsBusyByRoom: updateRoomBusyMap(state.actionsBusyByRoom, roomId, busy)
    }));
  },
  setLocalPreviewBusyForRoom: (roomId, busy) => {
    set((state) => ({
      localPreviewBusyByRoom: updateRoomBusyMap(state.localPreviewBusyByRoom, roomId, busy)
    }));
  },
  setHostBusyForRoom: (roomId, busy) => {
    set((state) => ({
      hostBusyByRoom: updateRoomBusyMap(state.hostBusyByRoom, roomId, busy)
    }));
  },
  setSettingsBusyForRoom: (roomId, busy) => {
    set((state) => ({
      settingsBusyByRoom: updateRoomBusyMap(state.settingsBusyByRoom, roomId, busy)
    }));
  },
  setKeyRotationBusyForRoom: (roomId, busy) => {
    set((state) => ({
      keyRotationBusyByRoom: updateRoomBusyMap(state.keyRotationBusyByRoom, roomId, busy)
    }));
  },
  updateInviteRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      inviteRequestsByRoom: {
        ...state.inviteRequestsByRoom,
        [roomId]: (state.inviteRequestsByRoom[roomId] ?? []).map((request) =>
          request.id === requestId ? { ...request, status } : request
        )
      }
    }));
  },
  appendGitWorkflowEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.gitWorkflowEventsByRoom[roomId] ?? [];
      if (
        roomEvents.some((existing) =>
          existing.createdAt === event.createdAt &&
          existing.status === event.status &&
          existing.message === event.message
        )
      ) {
        return state;
      }
      return {
        gitWorkflowEventsByRoom: {
          ...state.gitWorkflowEventsByRoom,
          [roomId]: [...roomEvents, event].slice(-100)
        }
      };
    });
  },
  appendGitHubActionsEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.githubActionsEventsByRoom[roomId] ?? [];
      if (
        roomEvents.some((existing) =>
          existing.checkedAt === event.checkedAt &&
          existing.owner === event.owner &&
          existing.repo === event.repo &&
          existing.branch === event.branch
        )
      ) {
        return state;
      }
      return {
        githubActionsEventsByRoom: {
          ...state.githubActionsEventsByRoom,
          [roomId]: [...roomEvents, event].slice(-50)
        }
      };
    });
  },
  appendLocalPreviewEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.localPreviewsByRoom[roomId] ?? [];
      const nextEvents = roomEvents.some((existing) => existing.id === event.id)
        ? roomEvents.map((existing) => existing.id === event.id ? event : existing)
        : [...roomEvents, event];
      return {
        localPreviewsByRoom: {
          ...state.localPreviewsByRoom,
          [roomId]: nextEvents.slice(-50)
        }
      };
    });
  },
  appendHostHandoff: (roomId, handoff) => {
    set((state) => {
      const roomHandoffs = state.hostHandoffsByRoom[roomId] ?? [];
      if (roomHandoffs.some((existing) => existing.id === handoff.id)) return state;
      return {
        hostHandoffsByRoom: {
          ...state.hostHandoffsByRoom,
          [roomId]: [...roomHandoffs, handoff]
        }
      };
    });
  },
  markHostHandoffAcceptedForRoom: (roomId, handoffId) => {
    set((state) => {
      const roomHandoffs = state.hostHandoffsByRoom[roomId] ?? [];
      if (!roomHandoffs.some((handoff) => handoff.id === handoffId)) return state;
      return {
        hostHandoffsByRoom: {
          ...state.hostHandoffsByRoom,
          [roomId]: roomHandoffs.map((handoff) =>
            handoff.id === handoffId ? { ...handoff, status: "accepted" } : handoff
          )
        }
      };
    });
  },
  markLatestHostHandoffAcceptedForRoom: (roomId) => {
    set((state) => {
      const roomHandoffs = state.hostHandoffsByRoom[roomId] ?? [];
      const latestAvailable = [...roomHandoffs].reverse().find((handoff) => handoff.status === "available");
      if (!latestAvailable) return state;
      return {
        hostHandoffsByRoom: {
          ...state.hostHandoffsByRoom,
          [roomId]: roomHandoffs.map((handoff) =>
            handoff.id === latestAvailable.id ? { ...handoff, status: "accepted" } : handoff
          )
        }
      };
    });
  },
  setCodexContinuationForRoom: (roomId, handoff) => {
    set((state) => ({
      codexContinuationByRoom: handoff
        ? { ...state.codexContinuationByRoom, [roomId]: handoff }
        : omitRecordKey(state.codexContinuationByRoom, roomId)
    }));
  },
  appendInviteRequest: (roomId, request) => {
    set((state) => {
      const roomRequests = state.inviteRequestsByRoom[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return state;
      return {
        inviteRequestsByRoom: {
          ...state.inviteRequestsByRoom,
          [roomId]: [...roomRequests, request]
        }
      };
    });
  },
  appendCodexEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.codexEventsByRoom[roomId] ?? [];
      if (
        roomEvents.some((existing) =>
          existing.turnId === event.turnId &&
          existing.createdAt === event.createdAt &&
          existing.status === event.status &&
          existing.message === event.message
        )
      ) {
        return state;
      }
      return {
        codexEventsByRoom: {
          ...state.codexEventsByRoom,
          [roomId]: [...roomEvents, event].slice(-80)
        }
      };
    });
  },
  setApprovalVisibleForRoom: (roomId, visible) => {
    set((state) => ({
      approvalVisibleByRoom: visible
        ? { ...state.approvalVisibleByRoom, [roomId]: true }
        : omitRecordKey(state.approvalVisibleByRoom, roomId)
    }));
  },
  setPendingCodexApprovalForRoom: (roomId, approval) => {
    set((state) => ({
      pendingCodexApprovalsByRoom: approval
        ? { ...state.pendingCodexApprovalsByRoom, [roomId]: approval }
        : omitRecordKey(state.pendingCodexApprovalsByRoom, roomId)
    }));
  },
  resetCodexApprovalForRoom: (roomId) => {
    set((state) => ({
      pendingCodexApprovalsByRoom: omitRecordKey(state.pendingCodexApprovalsByRoom, roomId),
      approvalVisibleByRoom: omitRecordKey(state.approvalVisibleByRoom, roomId)
    }));
  },
  setCodexRunningForRoom: (roomId, running) => {
    set((state) => ({
      codexRunningByRoom: running
        ? { ...state.codexRunningByRoom, [roomId]: true }
        : omitRecordKey(state.codexRunningByRoom, roomId)
    }));
  },
  setRoomGoalForRoom: (roomId, goal) => {
    set((state) => ({
      roomGoalsByRoom: goal
        ? { ...state.roomGoalsByRoom, [roomId]: goal }
        : omitRecordKey(state.roomGoalsByRoom, roomId)
    }));
  },
  setCodexThreadIdForRoom: (roomId, threadId) => {
    set((state) => ({
      codexThreadIdsByRoom: threadId
        ? { ...state.codexThreadIdsByRoom, [roomId]: threadId }
        : omitRecordKey(state.codexThreadIdsByRoom, roomId)
    }));
  },
  setHostMessageForRoom: (roomId, message) => {
    set((state) => ({
      hostMessagesByRoom: message
        ? { ...state.hostMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.hostMessagesByRoom, roomId)
    }));
  },
  setSecretWarningVisibleForRoom: (roomId, visible) => {
    set((state) => ({
      secretWarningsVisibleByRoom: visible
        ? { ...state.secretWarningsVisibleByRoom, [roomId]: true }
        : omitRecordKey(state.secretWarningsVisibleByRoom, roomId)
    }));
  },
  setHistoryMessageForRoom: (roomId, message) => {
    set((state) => ({
      historyMessagesByRoom: message
        ? { ...state.historyMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.historyMessagesByRoom, roomId)
    }));
  },
  setTeamHistoryMessageForTeam: (teamId, message) => {
    const key = teamId || "__no-team";
    set((state) => ({
      teamHistoryMessagesByTeam: message
        ? { ...state.teamHistoryMessagesByTeam, [key]: message }
        : omitRecordKey(state.teamHistoryMessagesByTeam, key)
    }));
  },
  setSettingsMessageForRoom: (roomId, message) => {
    set((state) => ({
      settingsMessagesByRoom: message
        ? { ...state.settingsMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.settingsMessagesByRoom, roomId)
    }));
  },
  setGitWorkflowMessageForRoom: (roomId, message) => {
    set((state) => ({
      gitWorkflowMessagesByRoom: {
        ...state.gitWorkflowMessagesByRoom,
        [roomId]: message
      }
    }));
  },
  setGitStatusForRoom: (roomId, status) => {
    set((state) => ({
      gitStatusByRoom: {
        ...state.gitStatusByRoom,
        [roomId]: status
      }
    }));
  },
  updateGitWorkflowDraftForRoom: (roomId, patch) => {
    set((state) => ({
      gitWorkflowDraftsByRoom: updateGitWorkflowDraftRecord(state.gitWorkflowDraftsByRoom, roomId, patch)
    }));
  },
  setInviteLinkForRoom: (roomId, link) => {
    set((state) => ({
      inviteLinksByRoom: link
        ? { ...state.inviteLinksByRoom, [roomId]: link }
        : omitRecordKey(state.inviteLinksByRoom, roomId)
    }));
  },
  setInviteApprovalGateForRoom: (roomId, enabled) => {
    set((state) => ({
      inviteApprovalGatesByRoom: enabled
        ? { ...state.inviteApprovalGatesByRoom, [roomId]: true }
        : omitRecordKey(state.inviteApprovalGatesByRoom, roomId)
    }));
  },
  setInviteMessageForRoom: (roomId, message) => {
    set((state) => ({
      inviteMessagesByRoom: message
        ? { ...state.inviteMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.inviteMessagesByRoom, roomId)
    }));
  },
  setCustomCodexModelForRoom: (roomId, model, currentModel) => {
    set((state) => ({
      customCodexModelsByRoom: model === currentModel
        ? omitRecordKey(state.customCodexModelsByRoom, roomId)
        : { ...state.customCodexModelsByRoom, [roomId]: model }
    }));
  },
  setProjectPathDraftForRoom: (roomId, projectPath, currentProjectPath) => {
    set((state) => ({
      projectPathDraftsByRoom: projectPath === currentProjectPath
        ? omitRecordKey(state.projectPathDraftsByRoom, roomId)
        : { ...state.projectPathDraftsByRoom, [roomId]: projectPath }
    }));
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
