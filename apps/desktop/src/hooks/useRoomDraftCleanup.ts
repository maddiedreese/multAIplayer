import { useEffect } from "react";
import { useAppStore } from "../store/appStore";

interface UseRoomDraftCleanupOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string | null;
  selectedRoomProjectPath: string;
  selectedCodexModel: string;
}

export function useRoomDraftCleanup({
  hasSelectedRoom,
  selectedRoomId,
  selectedRoomProjectPath,
  selectedCodexModel
}: UseRoomDraftCleanupOptions) {
  const setCustomCodexModelForRoom = useAppStore((state) => state.setCustomCodexModelForRoom);
  const setProjectPathDraftForRoom = useAppStore((state) => state.setProjectPathDraftForRoom);

  useEffect(() => {
    if (!hasSelectedRoom || !selectedRoomId) return;
    setCustomCodexModelForRoom(selectedRoomId, selectedCodexModel, selectedCodexModel);
  }, [hasSelectedRoom, selectedCodexModel, selectedRoomId, setCustomCodexModelForRoom]);

  useEffect(() => {
    if (!hasSelectedRoom || !selectedRoomId) return;
    setProjectPathDraftForRoom(selectedRoomId, selectedRoomProjectPath, selectedRoomProjectPath);
  }, [hasSelectedRoom, selectedRoomId, selectedRoomProjectPath, setProjectPathDraftForRoom]);
}
