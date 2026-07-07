import type { SetStateAction } from "react";
import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type { ChatAttachment } from "../../types";
import type { AppStoreState } from "../appStore";
import { resolveSetStateAction } from "../storeUtils";

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
  setChatMessagesByRoom: (action: SetStateAction<ChatMessagesByRoom>) => void;
  setDraftsByRoom: (action: SetStateAction<DraftsByRoom>) => void;
  setPendingAttachmentsByRoom: (action: SetStateAction<PendingAttachmentsByRoom>) => void;
  setSensitiveAttachmentReviewKey: (key: string | null) => void;
  toggleSelectedMessageForRoom: (roomId: string, messageId: string) => void;
  clearSelectedMessagesForRoom: (roomId: string) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  setPendingAttachmentsForRoom: (
    roomId: string,
    updater: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[])
  ) => void;
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
  setChatMessagesByRoom: (action) => {
    set((state) => ({
      chatMessagesByRoom: resolveSetStateAction(state.chatMessagesByRoom, action)
    }));
  },
  setDraftsByRoom: (action) => {
    set((state) => ({
      draftsByRoom: resolveSetStateAction(state.draftsByRoom, action)
    }));
  },
  setPendingAttachmentsByRoom: (action) => {
    set((state) => ({
      pendingAttachmentsByRoom: resolveSetStateAction(state.pendingAttachmentsByRoom, action)
    }));
  },
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
  setPendingAttachmentsForRoom: (roomId, updater) => {
    set((state) => {
      const currentAttachments = state.pendingAttachmentsByRoom[roomId] ?? [];
      const nextAttachments = typeof updater === "function" ? updater(currentAttachments) : updater;
      return {
        pendingAttachmentsByRoom: {
          ...state.pendingAttachmentsByRoom,
          [roomId]: nextAttachments
        }
      };
    });
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
