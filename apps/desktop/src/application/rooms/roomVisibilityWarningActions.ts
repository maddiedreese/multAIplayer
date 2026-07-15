import { useAppStore } from "../../store/appStore";
import { acknowledgeRoomVisibilityWarning as saveRoomVisibilityWarningAcknowledgement } from "../../lib/history/roomVisibilityWarning";

export function createRoomVisibilityWarningActions() {
  function acknowledgeRoomVisibilityWarning() {
    const { selectedRoomId } = useAppStore.getState();
    if (!selectedRoomId) return;
    saveRoomVisibilityWarningAcknowledgement(selectedRoomId);
    useAppStore.getState().setSecretWarningVisibleForRoom(selectedRoomId, false);
  }

  return { acknowledgeRoomVisibilityWarning };
}
