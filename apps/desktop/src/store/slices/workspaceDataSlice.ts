import type { StateCreator } from "zustand";
import type { ChatReactionPlaintextPayload, TeamMemberRecord } from "@multaiplayer/protocol";
import type { ChatMessage } from "../../types";
import type { AppStoreState } from "../appStore";

type TeamMembersByTeam = Record<string, TeamMemberRecord[]>;
type TeamMembersMessageByTeam = Record<string, string | null>;
type TeamMembersBusyByTeam = Record<string, boolean>;
type MessagesByRoom = Record<string, ChatMessage[]>;

interface WorkspaceInitialData {
  teamMembersByTeam: TeamMembersByTeam;
  messagesByRoom: MessagesByRoom;
}

export interface WorkspaceDataSlice {
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
  appendRoomMessage: (roomId: string, message: ChatMessage) => void;
  applyMessageReaction: (roomId: string, reaction: ChatReactionPlaintextPayload) => void;
}

export const emptyWorkspaceDataState: Pick<
  WorkspaceDataSlice,
  "teamMembersByTeam" | "teamMembersMessageByTeam" | "teamMembersBusyByTeam" | "messagesByRoom"
> = {
  teamMembersByTeam: {},
  teamMembersMessageByTeam: {},
  teamMembersBusyByTeam: {},
  messagesByRoom: {}
};

export const createWorkspaceDataSlice: StateCreator<AppStoreState, [], [], WorkspaceDataSlice> = (set) => ({
  ...emptyWorkspaceDataState,
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
  }
});
