import type { Dispatch, SetStateAction } from "react";
import type { ChatAttachment } from "../types";

interface UseRoomDraftSettersOptions {
  setPendingAttachmentsByRoom: Dispatch<SetStateAction<Record<string, ChatAttachment[]>>>;
  setDraftsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
}

export function useRoomDraftSetters({
  setPendingAttachmentsByRoom,
  setDraftsByRoom
}: UseRoomDraftSettersOptions) {
  function setPendingAttachmentsForRoom(
    roomId: string,
    updater: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[])
  ) {
    setPendingAttachmentsByRoom((current) => {
      const currentAttachments = current[roomId] ?? [];
      const nextAttachments = typeof updater === "function" ? updater(currentAttachments) : updater;
      return {
        ...current,
        [roomId]: nextAttachments
      };
    });
  }

  function setDraftForRoom(roomId: string, value: string) {
    setDraftsByRoom((current) => ({
      ...current,
      [roomId]: value
    }));
  }

  return {
    setPendingAttachmentsForRoom,
    setDraftForRoom
  };
}
