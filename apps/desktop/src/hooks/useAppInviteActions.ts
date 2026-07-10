import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { WorkspaceRecordActions } from "../lib/workspaceRecordActions";
import { useInviteActions } from "./useInviteActions";
import { useAppStore } from "../store/appStore";

type AppRefs = ReturnType<typeof useAppRefs>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;

export function useAppInviteActions({
  appRefs,
  roomInteraction,
  workspaceRecords
}: {
  appRefs: AppRefs;
  roomInteraction: RoomInteraction;
  workspaceRecords: WorkspaceRecordActions;
}) {
  return useInviteActions({
    selectedRoomIdRef: appRefs.selectedRoomIdRef,
    relayRef: appRefs.relayRef,
    seenEnvelopeIds: appRefs.seenEnvelopeIds,
    historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
    reportRoomKeyRotationInFlight: roomInteraction.reportRoomKeyRotationInFlight,
    upsertTeam: workspaceRecords.upsertTeam,
    upsertRoom: workspaceRecords.upsertRoom,
    clearInviteSecretInput: () => useAppStore.getState().clearInviteSecretInput(),
    selectWorkspaceRoom: (teamId, roomId) => useAppStore.getState().selectWorkspaceRoom(teamId, roomId)
  });
}
