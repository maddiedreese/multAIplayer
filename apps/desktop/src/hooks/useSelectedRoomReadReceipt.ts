import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { markRoomRead } from "../lib/roomUnread";

interface UseSelectedRoomReadReceiptOptions {
  selectedRoomId: string;
  setRooms: Dispatch<SetStateAction<RoomRecord[]>>;
}

export function useSelectedRoomReadReceipt({
  selectedRoomId,
  setRooms
}: UseSelectedRoomReadReceiptOptions) {
  useEffect(() => {
    if (!selectedRoomId) return;
    setRooms((current) => markRoomRead(current, selectedRoomId));
  }, [selectedRoomId, setRooms]);
}
