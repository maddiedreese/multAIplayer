import { create } from "zustand";
import { normalizeCodexThreadId } from "../lib/codexThread";
import { replaceRoomTerminalSnapshots } from "../lib/terminalState";
import { createBrowserSlice, emptyBrowserState, type BrowserSlice } from "./slices/browserSlice";
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
import { createRoomChatSlice, emptyRoomChatState, type RoomChatSlice } from "./slices/roomChatSlice";
import { createTerminalSlice, emptyTerminalState, type TerminalSlice } from "./slices/terminalSlice";
import type {
  ChatMessage,
  CodexRoomEvent,
  HostHandoffRecord,
  LocalRoomHistoryPayload,
  PendingCodexApproval,
  RoomGoal,
} from "../types";
import type {
  ChatReactionPlaintextPayload,
  TeamMemberRecord
} from "@multaiplayer/protocol";
import { omitRecordKey } from "../lib/setUtils";

type HostBusyByRoom = Record<string, boolean>;
type HostMessagesByRoom = Record<string, string | null>;
type SettingsBusyByRoom = Record<string, boolean>;
type SettingsMessagesByRoom = Record<string, string | null>;
type CustomCodexModelsByRoom = Record<string, string>;
type ProjectPathDraftsByRoom = Record<string, string>;
type CodexEventsByRoom = Record<string, CodexRoomEvent[]>;
type ApprovalVisibleByRoom = Record<string, boolean>;
type PendingCodexApprovalsByRoom = Record<string, PendingCodexApproval>;
type CodexRunningByRoom = Record<string, boolean>;
type RoomGoalsByRoom = Record<string, RoomGoal>;
type SecretWarningsVisibleByRoom = Record<string, boolean>;
type CodexThreadIdsByRoom = Record<string, string>;
type HostHandoffsByRoom = Record<string, HostHandoffRecord[]>;
type CodexContinuationByRoom = Record<string, HostHandoffRecord>;
type TeamMembersByTeam = Record<string, TeamMemberRecord[]>;
type TeamMembersMessageByTeam = Record<string, string | null>;
type TeamMembersBusyByTeam = Record<string, boolean>;
type MessagesByRoom = Record<string, ChatMessage[]>;
type RoomBusyByRoom = Record<string, boolean>;

interface WorkspaceInitialData {
  teamMembersByTeam: TeamMembersByTeam;
  messagesByRoom: MessagesByRoom;
}

const emptyAppStoreState = {
  ...emptyGitWorkflowState,
  ...emptyBrowserState,
  ...emptyFilePanelState,
  ...emptyHistoryPresenceState,
  hostBusyByRoom: {},
  hostMessagesByRoom: {},
  settingsBusyByRoom: {},
  settingsMessagesByRoom: {},
  customCodexModelsByRoom: {},
  projectPathDraftsByRoom: {},
  ...emptyLocalPreviewState,
  ...emptyInviteState,
  ...emptyRoomChatState,
  codexEventsByRoom: {},
  approvalVisibleByRoom: {},
  pendingCodexApprovalsByRoom: {},
  codexRunningByRoom: {},
  roomGoalsByRoom: {},
  secretWarningsVisibleByRoom: {},
  codexThreadIdsByRoom: {},
  hostHandoffsByRoom: {},
  codexContinuationByRoom: {},
  ...emptyTerminalState,
  teamMembersByTeam: {},
  teamMembersMessageByTeam: {},
  teamMembersBusyByTeam: {},
  messagesByRoom: {}
};

function updateRoomBusyMap(current: RoomBusyByRoom, roomId: string, busy: boolean): RoomBusyByRoom {
  return busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId);
}

export interface AppStoreState
  extends BrowserSlice,
    FilePanelSlice,
    GitWorkflowSlice,
    HistoryPresenceSlice,
    InviteSlice,
    LocalPreviewSlice,
    RoomChatSlice,
    TerminalSlice {
  hostBusyByRoom: HostBusyByRoom;
  hostMessagesByRoom: HostMessagesByRoom;
  settingsBusyByRoom: SettingsBusyByRoom;
  settingsMessagesByRoom: SettingsMessagesByRoom;
  customCodexModelsByRoom: CustomCodexModelsByRoom;
  projectPathDraftsByRoom: ProjectPathDraftsByRoom;
  codexEventsByRoom: CodexEventsByRoom;
  approvalVisibleByRoom: ApprovalVisibleByRoom;
  pendingCodexApprovalsByRoom: PendingCodexApprovalsByRoom;
  codexRunningByRoom: CodexRunningByRoom;
  roomGoalsByRoom: RoomGoalsByRoom;
  secretWarningsVisibleByRoom: SecretWarningsVisibleByRoom;
  codexThreadIdsByRoom: CodexThreadIdsByRoom;
  hostHandoffsByRoom: HostHandoffsByRoom;
  codexContinuationByRoom: CodexContinuationByRoom;
  teamMembersByTeam: TeamMembersByTeam;
  teamMembersMessageByTeam: TeamMembersMessageByTeam;
  teamMembersBusyByTeam: TeamMembersBusyByTeam;
  messagesByRoom: MessagesByRoom;
  seedWorkspaceInitialDataIfEmpty: (initialData: WorkspaceInitialData) => void;
  setTeamMembersForTeam: (teamId: string, members: TeamMemberRecord[]) => void;
  setTeamMembersMessageForTeam: (teamId: string, message: string | null) => void;
  setTeamMembersBusyForTeam: (teamId: string, busy: boolean) => void;
  ensureLocalTeamMemberForTeam: (teamId: string, userId: string, role: TeamMemberRecord["role"]) => void;
  initializeMessagesForRoom: (roomId: string) => void;
  hydrateLocalRoomHistoryForRoom: (roomId: string, payload: LocalRoomHistoryPayload) => void;
  appendRoomMessage: (roomId: string, message: ChatMessage) => void;
  applyMessageReaction: (roomId: string, reaction: ChatReactionPlaintextPayload) => void;
  setHostBusyForRoom: (roomId: string, busy: boolean) => void;
  setSettingsBusyForRoom: (roomId: string, busy: boolean) => void;
  appendHostHandoff: (roomId: string, handoff: HostHandoffRecord) => void;
  markHostHandoffAcceptedForRoom: (roomId: string, handoffId: string) => void;
  markLatestHostHandoffAcceptedForRoom: (roomId: string) => void;
  setCodexContinuationForRoom: (roomId: string, handoff: HostHandoffRecord | null) => void;
  appendCodexEvent: (roomId: string, event: CodexRoomEvent) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  setPendingCodexApprovalForRoom: (roomId: string, approval: PendingCodexApproval | null) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  setCodexRunningForRoom: (roomId: string, running: boolean) => void;
  setRoomGoalForRoom: (roomId: string, goal: RoomGoal | null) => void;
  setCodexThreadIdForRoom: (roomId: string, threadId: string | null) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setSecretWarningVisibleForRoom: (roomId: string, visible: boolean) => void;
  setSettingsMessageForRoom: (roomId: string, message: string | null) => void;
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
  ...createGitWorkflowSlice(set, get, api),
  ...createHistoryPresenceSlice(set, get, api),
  ...createInviteSlice(set, get, api),
  ...createLocalPreviewSlice(set, get, api),
  ...createRoomChatSlice(set, get, api),
  ...createTerminalSlice(set, get, api),
  seedWorkspaceInitialDataIfEmpty: ({ teamMembersByTeam, messagesByRoom }) => {
    set((state) => {
      const shouldSeedTeamMembers =
        Object.keys(teamMembersByTeam).length > 0 && Object.keys(state.teamMembersByTeam).length === 0;
      const shouldSeedMessages = Object.keys(messagesByRoom).length > 0 && Object.keys(state.messagesByRoom).length === 0;
      if (!shouldSeedTeamMembers && !shouldSeedMessages) return state;
      return {
        ...(shouldSeedTeamMembers ? { teamMembersByTeam } : {}),
        ...(shouldSeedMessages ? { messagesByRoom } : {})
      };
    });
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
  setSettingsMessageForRoom: (roomId, message) => {
    set((state) => ({
      settingsMessagesByRoom: message
        ? { ...state.settingsMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.settingsMessagesByRoom, roomId)
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
