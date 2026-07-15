import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/core/setUtils";
import type { ChatAttachment } from "../../types";
import type { AppStoreState } from "../appStore";

export interface RoomChatRoomState {
  message?: string;
  draft?: string;
  pendingAttachments?: ChatAttachment[];
  selectedMessageIds?: string[];
  markdownSelectionMode?: boolean;
  replyToMessageId?: string;
}

export type RoomChatByRoom = Record<string, RoomChatRoomState>;

export interface RoomChatPanelMaps {
  chatMessagesByRoom: Record<string, string | null>;
  draftsByRoom: Record<string, string>;
  pendingAttachmentsByRoom: Record<string, ChatAttachment[]>;
  selectedMessageIdsByRoom: Record<string, string[]>;
  replyToMessageIdsByRoom: Record<string, string>;
}

function compactRoomChat(record: RoomChatRoomState): RoomChatRoomState | undefined {
  return Object.keys(record).length ? record : undefined;
}

function updateRoomChatForRoom(
  current: RoomChatByRoom,
  roomId: string,
  update: (roomChat: RoomChatRoomState) => RoomChatRoomState
): RoomChatByRoom {
  const nextRoomChat = compactRoomChat(update(current[roomId] ?? {}));
  if (!nextRoomChat) return omitRecordKey(current, roomId);
  return {
    ...current,
    [roomId]: nextRoomChat
  };
}

export function projectRoomChatPanelMaps(roomChatByRoom: RoomChatByRoom): RoomChatPanelMaps {
  return {
    chatMessagesByRoom: Object.fromEntries(
      Object.entries(roomChatByRoom)
        .filter(([, chat]) => chat.message)
        .map(([roomId, chat]) => [roomId, chat.message ?? null])
    ),
    draftsByRoom: Object.fromEntries(
      Object.entries(roomChatByRoom)
        .filter(([, chat]) => chat.draft)
        .map(([roomId, chat]) => [roomId, chat.draft ?? ""])
    ),
    pendingAttachmentsByRoom: Object.fromEntries(
      Object.entries(roomChatByRoom)
        .filter(([, chat]) => chat.pendingAttachments)
        .map(([roomId, chat]) => [roomId, chat.pendingAttachments ?? []])
    ),
    selectedMessageIdsByRoom: Object.fromEntries(
      Object.entries(roomChatByRoom)
        .filter(([, chat]) => chat.selectedMessageIds)
        .map(([roomId, chat]) => [roomId, chat.selectedMessageIds ?? []])
    ),
    replyToMessageIdsByRoom: Object.fromEntries(
      Object.entries(roomChatByRoom)
        .filter(([, chat]) => chat.replyToMessageId)
        .map(([roomId, chat]) => [roomId, chat.replyToMessageId ?? ""])
    )
  };
}

export interface RoomChatSlice {
  roomChatByRoom: RoomChatByRoom;
  sensitiveAttachmentReviewKey: string | null;
  setSensitiveAttachmentReviewKey: (key: string | null) => void;
  toggleSelectedMessageForRoom: (roomId: string, messageId: string) => void;
  clearSelectedMessagesForRoom: (roomId: string) => void;
  toggleMarkdownSelectionModeForRoom: (roomId: string) => void;
  disableMarkdownSelectionModeForRoom: (roomId: string) => void;
  setReplyToMessageForRoom: (roomId: string, messageId: string | null) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  setPendingAttachmentsForRoom: (roomId: string, attachments: ChatAttachment[]) => void;
  appendPendingAttachmentForRoom: (roomId: string, attachment: ChatAttachment) => void;
  removePendingAttachmentForRoom: (roomId: string, attachmentId: string) => void;
  clearPendingAttachmentsForRoom: (roomId: string) => void;
  setDraftForRoom: (roomId: string, value: string) => void;
}

export const emptyRoomChatState: Pick<RoomChatSlice, "roomChatByRoom" | "sensitiveAttachmentReviewKey"> = {
  roomChatByRoom: {},
  sensitiveAttachmentReviewKey: null
};

export const createRoomChatSlice: StateCreator<AppStoreState, [], [], RoomChatSlice> = (set) => ({
  ...emptyRoomChatState,
  setSensitiveAttachmentReviewKey: (key) => {
    set({ sensitiveAttachmentReviewKey: key });
  },
  toggleSelectedMessageForRoom: (roomId, messageId) => {
    set((state) => {
      const roomIds = state.roomChatByRoom[roomId]?.selectedMessageIds ?? [];
      const nextIds = roomIds.includes(messageId) ? roomIds.filter((id) => id !== messageId) : [...roomIds, messageId];
      return {
        roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => ({
          ...roomChat,
          selectedMessageIds: nextIds
        }))
      };
    });
  },
  clearSelectedMessagesForRoom: (roomId) => {
    set((state) => ({
      roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => {
        const { selectedMessageIds, ...rest } = roomChat;
        return rest;
      })
    }));
  },
  toggleMarkdownSelectionModeForRoom: (roomId) => {
    set((state) => ({
      roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => {
        if (roomChat.markdownSelectionMode) {
          const { markdownSelectionMode, selectedMessageIds, ...rest } = roomChat;
          return rest;
        }
        return { ...roomChat, markdownSelectionMode: true };
      })
    }));
  },
  disableMarkdownSelectionModeForRoom: (roomId) => {
    set((state) => ({
      roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => {
        const { markdownSelectionMode, selectedMessageIds, ...rest } = roomChat;
        return rest;
      })
    }));
  },
  setReplyToMessageForRoom: (roomId, messageId) => {
    set((state) => ({
      roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => {
        const { replyToMessageId, ...rest } = roomChat;
        return messageId ? { ...roomChat, replyToMessageId: messageId } : rest;
      })
    }));
  },
  setChatMessageForRoom: (roomId, message) => {
    set((state) => ({
      roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => {
        const { message: _message, ...rest } = roomChat;
        return message ? { ...roomChat, message } : rest;
      })
    }));
  },
  setPendingAttachmentsForRoom: (roomId, attachments) => {
    set((state) => ({
      roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => ({
        ...roomChat,
        pendingAttachments: attachments
      }))
    }));
  },
  appendPendingAttachmentForRoom: (roomId, attachment) => {
    set((state) => {
      const currentAttachments = state.roomChatByRoom[roomId]?.pendingAttachments ?? [];
      if (currentAttachments.some((item) => item.id === attachment.id)) return state;
      return {
        roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => ({
          ...roomChat,
          pendingAttachments: [...currentAttachments, attachment]
        }))
      };
    });
  },
  removePendingAttachmentForRoom: (roomId, attachmentId) => {
    set((state) => ({
      roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => {
        const nextAttachments = (roomChat.pendingAttachments ?? []).filter(
          (attachment) => attachment.id !== attachmentId
        );
        if (nextAttachments.length) return { ...roomChat, pendingAttachments: nextAttachments };
        const { pendingAttachments, ...rest } = roomChat;
        return rest;
      })
    }));
  },
  clearPendingAttachmentsForRoom: (roomId) => {
    set((state) => ({
      roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => {
        const { pendingAttachments, ...rest } = roomChat;
        return rest;
      })
    }));
  },
  setDraftForRoom: (roomId, value) => {
    set((state) => ({
      roomChatByRoom: updateRoomChatForRoom(state.roomChatByRoom, roomId, (roomChat) => {
        const { draft, ...rest } = roomChat;
        return value ? { ...roomChat, draft: value } : rest;
      })
    }));
  }
});
