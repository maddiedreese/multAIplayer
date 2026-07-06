import type { Dispatch, SetStateAction } from "react";
import { omitRecordKey } from "../lib/setUtils";

interface UseRoomBrowserSettersOptions {
  selectedRoomId: string;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
  setBrowserUrlsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setBrowserReasonsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setBrowserMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
}

export function useRoomBrowserSetters({
  selectedRoomId,
  defaultBrowserUrl,
  defaultBrowserReason,
  setBrowserUrlsByRoom,
  setBrowserReasonsByRoom,
  setBrowserMessagesByRoom
}: UseRoomBrowserSettersOptions) {
  function setBrowserUrlForRoom(roomId: string, url: string) {
    setBrowserUrlsByRoom((current) => url === defaultBrowserUrl ? omitRecordKey(current, roomId) : { ...current, [roomId]: url });
  }

  function setBrowserReasonForRoom(roomId: string, reason: string) {
    setBrowserReasonsByRoom((current) => reason === defaultBrowserReason ? omitRecordKey(current, roomId) : { ...current, [roomId]: reason });
  }

  function setBrowserMessageForRoom(roomId: string, message: string | null) {
    setBrowserMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedBrowserMessage(message: string | null) {
    setBrowserMessageForRoom(selectedRoomId, message);
  }

  return {
    setBrowserUrlForRoom,
    setBrowserReasonForRoom,
    setBrowserMessageForRoom,
    setSelectedBrowserMessage
  };
}
