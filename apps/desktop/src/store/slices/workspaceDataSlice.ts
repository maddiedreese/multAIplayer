import type { StateCreator } from "zustand";
import type {
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  ChatReactionPlaintextPayload,
  TeamMemberRecord
} from "@multaiplayer/protocol";
import { messageIsBeforeCodexWatermark } from "../../lib/codex/codexMessageWatermark";
import { messagesSinceLastCodex } from "../../lib/codex/codexTurn";
import type { ChatAttachment, ChatMessage, PendingCodexApproval } from "../../types";
import type { AppStoreState } from "../appStore";

type TeamMembersByTeam = Record<string, TeamMemberRecord[]>;
type TeamMembersMessageByTeam = Record<string, string | null>;
type TeamMembersBusyByTeam = Record<string, boolean>;
type MessagesByRoom = Record<string, ChatMessage[]>;
type ChatEditsByRoom = Record<string, ChatEditPlaintextPayload[]>;
type ChatDeletesByRoom = Record<string, ChatDeletePlaintextPayload[]>;

export interface TeamRosterState {
  members?: TeamMemberRecord[];
  message?: string | null;
  busy?: boolean;
}

export type TeamRosterByTeam = Record<string, TeamRosterState>;

interface WorkspaceInitialData {
  teamMembersByTeam: TeamMembersByTeam;
  messagesByRoom: MessagesByRoom;
}

export interface WorkspaceDataSlice {
  teamRosterByTeam: TeamRosterByTeam;
  messagesByRoom: MessagesByRoom;
  chatEditsByRoom: ChatEditsByRoom;
  chatDeletesByRoom: ChatDeletesByRoom;
  seedWorkspaceInitialDataIfEmpty: (initialData: WorkspaceInitialData) => void;
  setTeamMembersForTeam: (teamId: string, members: TeamMemberRecord[]) => void;
  setTeamMembersMessageForTeam: (teamId: string, message: string | null) => void;
  setTeamMembersBusyForTeam: (teamId: string, busy: boolean) => void;
  ensureLocalTeamMemberForTeam: (teamId: string, userId: string, role: TeamMemberRecord["role"]) => void;
  initializeMessagesForRoom: (roomId: string) => void;
  appendRoomMessage: (roomId: string, message: ChatMessage) => void;
  editRoomMessage: (roomId: string, edit: ChatEditPlaintextPayload) => void;
  deleteRoomMessage: (roomId: string, deletion: ChatDeletePlaintextPayload) => void;
  applyMessageReaction: (roomId: string, reaction: ChatReactionPlaintextPayload) => void;
}

export const emptyWorkspaceDataState: Pick<
  WorkspaceDataSlice,
  "teamRosterByTeam" | "messagesByRoom" | "chatEditsByRoom" | "chatDeletesByRoom"
> = {
  teamRosterByTeam: {},
  messagesByRoom: {},
  chatEditsByRoom: {},
  chatDeletesByRoom: {}
};

function updateTeamRosterForTeam(
  current: TeamRosterByTeam,
  teamId: string,
  update: (teamRoster: TeamRosterState) => TeamRosterState
): TeamRosterByTeam {
  return {
    ...current,
    [teamId]: update(current[teamId] ?? {})
  };
}

export function projectTeamMembersByTeam(teamRosterByTeam: TeamRosterByTeam): TeamMembersByTeam {
  return Object.fromEntries(
    Object.entries(teamRosterByTeam)
      .filter(([, roster]) => roster.members)
      .map(([teamId, roster]) => [teamId, roster.members ?? []])
  );
}

export function projectTeamMembersMessageByTeam(teamRosterByTeam: TeamRosterByTeam): TeamMembersMessageByTeam {
  return Object.fromEntries(
    Object.entries(teamRosterByTeam)
      .filter(([, roster]) => "message" in roster)
      .map(([teamId, roster]) => [teamId, roster.message ?? null])
  );
}

export function projectTeamMembersBusyByTeam(teamRosterByTeam: TeamRosterByTeam): TeamMembersBusyByTeam {
  return Object.fromEntries(
    Object.entries(teamRosterByTeam)
      .filter(([, roster]) => "busy" in roster)
      .map(([teamId, roster]) => [teamId, roster.busy ?? false])
  );
}

export const createWorkspaceDataSlice: StateCreator<AppStoreState, [], [], WorkspaceDataSlice> = (set) => ({
  ...emptyWorkspaceDataState,
  seedWorkspaceInitialDataIfEmpty: ({ teamMembersByTeam, messagesByRoom }) => {
    set((state) => {
      const shouldSeedTeamMembers =
        Object.keys(teamMembersByTeam).length > 0 && Object.keys(state.teamRosterByTeam).length === 0;
      const shouldSeedMessages =
        Object.keys(messagesByRoom).length > 0 && Object.keys(state.messagesByRoom).length === 0;
      if (!shouldSeedTeamMembers && !shouldSeedMessages) return state;
      return {
        ...(shouldSeedTeamMembers
          ? {
              teamRosterByTeam: Object.fromEntries(
                Object.entries(teamMembersByTeam).map(([teamId, members]) => [teamId, { members }])
              )
            }
          : {}),
        ...(shouldSeedMessages ? { messagesByRoom } : {})
      };
    });
  },
  setTeamMembersForTeam: (teamId, members) => {
    set((state) => ({
      teamRosterByTeam: updateTeamRosterForTeam(state.teamRosterByTeam, teamId, (roster) => ({
        ...roster,
        members
      }))
    }));
  },
  setTeamMembersMessageForTeam: (teamId, message) => {
    set((state) => ({
      teamRosterByTeam: updateTeamRosterForTeam(state.teamRosterByTeam, teamId, (roster) => ({
        ...roster,
        message
      }))
    }));
  },
  setTeamMembersBusyForTeam: (teamId, busy) => {
    set((state) => ({
      teamRosterByTeam: updateTeamRosterForTeam(state.teamRosterByTeam, teamId, (roster) => ({
        ...roster,
        busy
      }))
    }));
  },
  ensureLocalTeamMemberForTeam: (teamId, userId, role) => {
    set((state) => {
      if (state.teamRosterByTeam[teamId]?.members?.some((member) => member.userId === userId)) return state;
      return {
        teamRosterByTeam: updateTeamRosterForTeam(state.teamRosterByTeam, teamId, (roster) => ({
          ...roster,
          members: [
            {
              teamId,
              userId,
              role,
              joinedAt: new Date().toISOString()
            }
          ]
        }))
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
  editRoomMessage: (roomId, edit) => {
    set((state) => {
      const roomMessages = state.messagesByRoom[roomId] ?? [];
      const target = roomMessages.find((message) => message.id === edit.messageId);
      if (!target || target.deletedAt) return state;
      if (target.authorUserId && target.authorUserId !== edit.editedByUserId) return state;
      const roomRuntime = state.codexRuntimeByRoom[roomId];
      if (!messageIsBeforeCodexWatermark(target, roomRuntime?.events ?? [])) return state;
      const nextMessages = roomMessages.map((message) => {
        if (message.id !== edit.messageId) return message;
        return {
          ...message,
          body: edit.body,
          editedAt: edit.editedAt,
          editedByUserId: edit.editedByUserId
        };
      });
      const approvalIncludesMessage =
        roomRuntime?.pendingApproval?.messages.some((message) => message.id === edit.messageId) ?? false;
      const refreshedApproval =
        approvalIncludesMessage && roomRuntime?.pendingApproval
          ? refreshPendingApprovalMessages(roomRuntime.pendingApproval, nextMessages)
          : null;
      return {
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: nextMessages
        },
        chatEditsByRoom: {
          ...state.chatEditsByRoom,
          [roomId]: appendUniqueAuditEvent(state.chatEditsByRoom[roomId], edit, (item) => item.id)
        },
        ...(approvalIncludesMessage
          ? {
              codexRuntimeByRoom: {
                ...state.codexRuntimeByRoom,
                [roomId]: {
                  ...roomRuntime,
                  ...(refreshedApproval ? { pendingApproval: refreshedApproval } : {})
                }
              }
            }
          : {})
      };
    });
  },
  deleteRoomMessage: (roomId, deletion) => {
    set((state) => deleteRoomMessageState(state, roomId, deletion));
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
            const nextReactors =
              reaction.action === "add"
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

function deleteRoomMessageState(state: AppStoreState, roomId: string, deletion: ChatDeletePlaintextPayload) {
  const context = deletableMessageContext(state, roomId, deletion);
  if (!context) return state;
  const { roomMessages, roomRuntime } = context;
  const nextMessages = roomMessages.map((message) =>
    message.id === deletion.messageId
      ? {
          ...message,
          body: "",
          deletedAt: deletion.deletedAt,
          deletedBy: deletion.deletedBy,
          deletedByUserId: deletion.deletedByUserId,
          attachments: undefined,
          reactions: undefined
        }
      : message
  );
  const approvalIncludesMessage =
    roomRuntime?.pendingApproval?.messages.some((message) => message.id === deletion.messageId) ?? false;
  const queuedApprovals = roomRuntime?.queuedApprovals?.filter((turn) => turn.triggerMessageId !== deletion.messageId);
  const queueChanged = queuedApprovals && queuedApprovals.length !== (roomRuntime?.queuedApprovals ?? []).length;
  const refreshedApproval =
    approvalIncludesMessage && roomRuntime?.pendingApproval
      ? refreshPendingApprovalMessages(roomRuntime.pendingApproval, nextMessages)
      : null;
  return {
    messagesByRoom: { ...state.messagesByRoom, [roomId]: nextMessages },
    chatDeletesByRoom: {
      ...state.chatDeletesByRoom,
      [roomId]: appendUniqueAuditEvent(state.chatDeletesByRoom[roomId], deletion, (item) => item.id)
    },
    ...(approvalIncludesMessage || queueChanged
      ? {
          codexRuntimeByRoom: {
            ...state.codexRuntimeByRoom,
            [roomId]: updateCodexRuntimeAfterMessageDelete(
              roomRuntime,
              approvalIncludesMessage ? refreshedApproval : roomRuntime?.pendingApproval,
              queueChanged ? queuedApprovals : roomRuntime?.queuedApprovals
            )
          }
        }
      : {})
  };
}

function deletableMessageContext(state: AppStoreState, roomId: string, deletion: ChatDeletePlaintextPayload) {
  const roomMessages = state.messagesByRoom[roomId] ?? [];
  const target = roomMessages.find((message) => message.id === deletion.messageId);
  if (!target || target.deletedAt) return null;
  if (target.authorUserId && target.authorUserId !== deletion.deletedByUserId) return null;
  const roomRuntime = state.codexRuntimeByRoom[roomId];
  if (!messageIsBeforeCodexWatermark(target, roomRuntime?.events ?? [])) return null;
  return { roomMessages, roomRuntime };
}

function updateCodexRuntimeAfterMessageDelete(
  roomRuntime: AppStoreState["codexRuntimeByRoom"][string] | undefined,
  pendingApproval: PendingCodexApproval | null | undefined,
  queuedApprovals = roomRuntime?.queuedApprovals
): AppStoreState["codexRuntimeByRoom"][string] {
  const { pendingApproval: _pendingApproval, queuedApprovals: _queuedApprovals, ...rest } = roomRuntime ?? {};
  return {
    ...rest,
    ...(pendingApproval ? { pendingApproval } : {}),
    ...(queuedApprovals?.length ? { queuedApprovals } : {})
  };
}

function refreshPendingApprovalMessages(
  approval: PendingCodexApproval,
  roomMessages: ChatMessage[]
): PendingCodexApproval | null {
  const approvalMessageIds = new Set(approval.messages.map((message) => message.id).filter(Boolean));
  const refreshedMessages = roomMessages.filter((message) => approvalMessageIds.has(message.id) && !message.deletedAt);
  if (!refreshedMessages.length) return null;
  const delta = messagesSinceLastCodex(refreshedMessages) as ChatMessage[];
  const attachments = delta.flatMap((message) => message.attachments ?? []);
  return {
    ...approval,
    messages: refreshedMessages,
    summary: {
      ...approval.summary,
      messagesSinceLastCodex: delta.length,
      attachments: attachments.map(formatApprovalAttachmentSummary)
    }
  };
}

function formatApprovalAttachmentSummary(
  attachment: ChatAttachment
): PendingCodexApproval["summary"]["attachments"][number] {
  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    storage: attachment.blobId ? "encrypted_blob" : "inline",
    contentIncluded: Boolean(attachment.content)
  };
}

function appendUniqueAuditEvent<T>(current: T[] | undefined, event: T, keyFor: (event: T) => string): T[] {
  const events = current ?? [];
  const key = keyFor(event);
  if (events.some((item) => keyFor(item) === key)) return events;
  return [...events, event];
}
