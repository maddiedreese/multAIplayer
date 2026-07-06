import { acknowledgeRoomVisibilityWarning as saveRoomVisibilityWarningAcknowledgement } from "../lib/roomVisibilityWarning";

interface UseRoomVisibilityWarningActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
  setSecretWarningVisibleForRoom: (roomId: string, visible: boolean) => void;
}

export function useRoomVisibilityWarningActions({
  hasSelectedRoom,
  selectedRoomId,
  setSecretWarningVisibleForRoom
}: UseRoomVisibilityWarningActionsOptions) {
  function acknowledgeRoomVisibilityWarning() {
    if (!hasSelectedRoom) {
      return;
    }
    saveRoomVisibilityWarningAcknowledgement(selectedRoomId);
    setSecretWarningVisibleForRoom(selectedRoomId, false);
  }

  return {
    acknowledgeRoomVisibilityWarning
  };
}
