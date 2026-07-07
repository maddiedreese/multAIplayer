import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type { ChatAttachment } from "../../types";
import type { AppStoreState } from "../appStore";

type ChatMessagesByRoom = Record<string, string | null>;
type DraftsByRoom = Record<string, string>;
type PendingAttachmentsByRoom = Record<string, ChatAttachment[]>;
type SelectedMessageIdsByRoom = Record<string, string[]>;

export interface RoomChatSlice {
  chatMessagesByRoom: ChatMessagesByRoom;
  draftsByRoom: DraftsByRoom;
  pendingAttachmentsByRoom: PendingAttachmentsByRoom;
  sensitiveAttachmentReviewKey: string | null;
  selectedMessageIdsByRoom: SelectedMessageIdsByRoom;
  setSensitiveAttachmentReviewKey: (key: string | null) => void;
  toggleSelectedMessageForRoom: (roomId: string, messageId: string) => void;
  clearSelectedMessagesForRoom: (roomId: string) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  setPendingAttachmentsForRoom: (roomId: string, attachments: ChatAttachment[]) => void;
  appendPendingAttachmentForRoom: (roomId: string, attachment: ChatAttachment) => void;
  removePendingAttachmentForRoom: (roomId: string, attachmentId: string) => void;
  clearPendingAttachmentsForRoom: (roomId: string) => void;
  setDraftForRoom: (roomId: string, value: string) => void;
}

export const emptyRoomChatState: Pick<
  RoomChatSlice,
  | "chatMessagesByRoom"
  | "draftsByRoom"
  | "pendingAttachmentsByRoom"
  | "sensitiveAttachmentReviewKey"
  | "selectedMessageIdsByRoom"
> = {
  chatMessagesByRoom: {},
  draftsByRoom: {},
  pendingAttachmentsByRoom: {},
  sensitiveAttachmentReviewKey: null,
  selectedMessageIdsByRoom: {}
};

export const createRoomChatSlice: StateCreator<AppStoreState, [], [], RoomChatSlice> = (set) => ({
  ...emptyRoomChatState,
  setSensitiveAttachmentReviewKey: (key) => {
    set({ sensitiveAttachmentReviewKey: key });
  },
  toggleSelectedMessageForRoom: (roomId, messageId) => {
    set((state) => {
      const roomIds = state.selectedMessageIdsByRoom[roomId] ?? [];
      const nextIds = roomIds.includes(messageId)
        ? roomIds.filter((id) => id !== messageId)
        : [...roomIds, messageId];
      return {
        selectedMessageIdsByRoom: {
          ...state.selectedMessageIdsByRoom,
          [roomId]: nextIds
        }
      };
    });
  },
  clearSelectedMessagesForRoom: (roomId) => {
    set((state) => ({
      selectedMessageIdsByRoom: omitRecordKey(state.selectedMessageIdsByRoom, roomId)
    }));
  },
  setChatMessageForRoom: (roomId, message) => {
    set((state) => ({
      chatMessagesByRoom: message
        ? { ...state.chatMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.chatMessagesByRoom, roomId)
    }));
  },
  setPendingAttachmentsForRoom: (roomId, attachments) => {
    set((state) => ({
      pendingAttachmentsByRoom: {
        ...state.pendingAttachmentsByRoom,
        [roomId]: attachments
      }
    }));
  },
  appendPendingAttachmentForRoom: (roomId, attachment) => {
    set((state) => {
      const currentAttachments = state.pendingAttachmentsByRoom[roomId] ?? [];
      if (currentAttachments.some((item) => item.id === attachment.id)) return state;
      return {
        pendingAttachmentsByRoom: {
          ...state.pendingAttachmentsByRoom,
          [roomId]: [...currentAttachments, attachment]
        }
      };
    });
  },
  removePendingAttachmentForRoom: (roomId, attachmentId) => {
    set((state) => ({
      pendingAttachmentsByRoom: {
        ...state.pendingAttachmentsByRoom,
        [roomId]: (state.pendingAttachmentsByRoom[roomId] ?? []).filter((attachment) => attachment.id !== attachmentId)
      }
    }));
  },
  clearPendingAttachmentsForRoom: (roomId) => {
    set((state) => ({
      pendingAttachmentsByRoom: omitRecordKey(state.pendingAttachmentsByRoom, roomId)
    }));
  },
  setDraftForRoom: (roomId, value) => {
    set((state) => ({
      draftsByRoom: {
        ...state.draftsByRoom,
        [roomId]: value
      }
    }));
  }
});
