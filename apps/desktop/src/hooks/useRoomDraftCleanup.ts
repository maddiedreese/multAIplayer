import { useEffect, type Dispatch, type SetStateAction } from "react";
import { omitRecordKey } from "../lib/setUtils";

interface UseRoomDraftCleanupOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
  selectedRoomProjectPath: string;
  selectedCodexModel: string;
  setCustomCodexModelsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setProjectPathDraftsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
}

export function useRoomDraftCleanup({
  hasSelectedRoom,
  selectedRoomId,
  selectedRoomProjectPath,
  selectedCodexModel,
  setCustomCodexModelsByRoom,
  setProjectPathDraftsByRoom
}: UseRoomDraftCleanupOptions) {
  useEffect(() => {
    if (!hasSelectedRoom) return;
    setCustomCodexModelsByRoom((current) =>
      current[selectedRoomId] === selectedCodexModel ? omitRecordKey(current, selectedRoomId) : current
    );
  }, [hasSelectedRoom, selectedCodexModel, selectedRoomId, setCustomCodexModelsByRoom]);

  useEffect(() => {
    if (!hasSelectedRoom) return;
    setProjectPathDraftsByRoom((current) =>
      current[selectedRoomId] === selectedRoomProjectPath ? omitRecordKey(current, selectedRoomId) : current
    );
  }, [hasSelectedRoom, selectedRoomId, selectedRoomProjectPath, setProjectPathDraftsByRoom]);
}
