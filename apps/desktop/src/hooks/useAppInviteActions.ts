import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { WorkspaceRecordActions } from "../lib/workspaceRecordActions";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useInviteActions } from "./useInviteActions";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;

export function useAppInviteActions({
  appState,
  appRefs,
  localIdentity,
  selected,
  selectedRuntime,
  roomInteraction,
  workspaceRecords
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  roomInteraction: RoomInteraction;
  workspaceRecords: WorkspaceRecordActions;
}) {
  const {
    workspaceState,
    invitePanelState,
    appRuntimeState
  } = appState;
  const {
    hasSelectedRoom,
    selectedRoom,
    inviteApprovalGate
  } = selected;
  return useInviteActions({
    hasSelectedRoom,
    selectedRoom,
    selectedRoomIdRef: appRefs.selectedRoomIdRef,
    isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
    isSelectedRoomRevoked: roomInteraction.isSelectedRoomRevoked,
    isActiveHost: roomInteraction.isActiveHost,
    hostGateMessage: roomInteraction.hostGateMessage,
    inviteApprovalGate,
    inviteRequests: selectedRuntime.inviteRequests,
    inviteSecretInput: invitePanelState.inviteSecretInput,
    localUser: localIdentity.localUser,
    deviceId: localIdentity.deviceId,
    deviceIdentity: appRuntimeState.deviceIdentity,
    relayStatus: appRuntimeState.relayStatus,
    relayRef: appRefs.relayRef,
    seenEnvelopeIds: appRefs.seenEnvelopeIds,
    historyLoadedRoomIds: appRefs.historyLoadedRoomIds,
    reportRoomKeyRotationInFlight: roomInteraction.reportRoomKeyRotationInFlight,
    upsertTeam: workspaceRecords.upsertTeam,
    upsertRoom: workspaceRecords.upsertRoom,
    clearInviteSecretInput: invitePanelState.clearInviteSecretInput,
    selectWorkspaceRoom: workspaceState.selectWorkspaceRoom
  });
}
