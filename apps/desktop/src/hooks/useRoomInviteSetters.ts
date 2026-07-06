import type { Dispatch, SetStateAction } from "react";
import { omitRecordKey } from "../lib/setUtils";

interface UseRoomInviteSettersOptions {
  selectedRoomId: string;
  setInviteLinksByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setInviteApprovalGatesByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setInviteMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
}

export function useRoomInviteSetters({
  selectedRoomId,
  setInviteLinksByRoom,
  setInviteApprovalGatesByRoom,
  setInviteMessagesByRoom
}: UseRoomInviteSettersOptions) {
  function setInviteLinkForRoom(roomId: string, link: string) {
    setInviteLinksByRoom((current) => link ? { ...current, [roomId]: link } : omitRecordKey(current, roomId));
  }

  function setInviteApprovalGateForRoom(roomId: string, enabled: boolean) {
    setInviteApprovalGatesByRoom((current) => enabled ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setInviteMessageForRoom(roomId: string, message: string | null) {
    setInviteMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedInviteMessage(message: string | null) {
    setInviteMessageForRoom(selectedRoomId, message);
  }

  return {
    setInviteLinkForRoom,
    setInviteApprovalGateForRoom,
    setInviteMessageForRoom,
    setSelectedInviteMessage
  };
}
