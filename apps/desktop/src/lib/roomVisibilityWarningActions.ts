import { useAppStore } from "../store/appStore";
import { acknowledgeRoomVisibilityWarning as saveRoomVisibilityWarningAcknowledgement } from "./roomVisibilityWarning";

interface RoomVisibilityWarningActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
}

export function createRoomVisibilityWarningActions({
  hasSelectedRoom,
  selectedRoomId
}: RoomVisibilityWarningActionsOptions) {
  function acknowledgeRoomVisibilityWarning() {
    if (!hasSelectedRoom) return;
    saveRoomVisibilityWarningAcknowledgement(selectedRoomId);
    useAppStore.getState().setSecretWarningVisibleForRoom(selectedRoomId, false);
  }

  return { acknowledgeRoomVisibilityWarning };
}
