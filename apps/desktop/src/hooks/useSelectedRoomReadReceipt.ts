import { useEffect } from "react";

interface UseSelectedRoomReadReceiptOptions {
  selectedRoomId: string;
  markRoomRead: (roomId: string) => void;
}

export function useSelectedRoomReadReceipt({
  selectedRoomId,
  markRoomRead
}: UseSelectedRoomReadReceiptOptions) {
  useEffect(() => {
    if (!selectedRoomId) return;
    markRoomRead(selectedRoomId);
  }, [selectedRoomId, markRoomRead]);
}
