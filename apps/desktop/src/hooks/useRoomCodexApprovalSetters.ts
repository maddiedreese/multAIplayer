import type { Dispatch, SetStateAction } from "react";
import { omitRecordKey } from "../lib/setUtils";
import type { PendingCodexApproval } from "../types";

interface UseRoomCodexApprovalSettersOptions {
  setApprovalVisibleByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setPendingCodexApprovalsByRoom: Dispatch<SetStateAction<Record<string, PendingCodexApproval>>>;
  setCodexRunningByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export function useRoomCodexApprovalSetters({
  setApprovalVisibleByRoom,
  setPendingCodexApprovalsByRoom,
  setCodexRunningByRoom
}: UseRoomCodexApprovalSettersOptions) {
  function setApprovalVisibleForRoom(roomId: string, visible: boolean) {
    setApprovalVisibleByRoom((current) => visible ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setPendingCodexApprovalForRoom(
    roomId: string,
    approval: PendingCodexApproval | null
  ) {
    setPendingCodexApprovalsByRoom((current) => approval ? { ...current, [roomId]: approval } : omitRecordKey(current, roomId));
  }

  function resetCodexApprovalForRoom(roomId: string) {
    setPendingCodexApprovalForRoom(roomId, null);
    setApprovalVisibleForRoom(roomId, false);
  }

  function setCodexRunningForRoom(roomId: string, running: boolean) {
    setCodexRunningByRoom((current) => running ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  return {
    setApprovalVisibleForRoom,
    setPendingCodexApprovalForRoom,
    resetCodexApprovalForRoom,
    setCodexRunningForRoom
  };
}
