import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppRoomActions } from "./useAppRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppSelectedRoomRuntime } from "./useAppSelectedRoomRuntime";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useAppWorkspaceRecords } from "./useAppWorkspaceRecords";
import type { useLocalIdentity } from "./useLocalIdentity";
import type { useRoomChatMutations } from "./useRoomChatMutations";
import { useInviteActions } from "./useInviteActions";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type SelectedRoomRuntime = ReturnType<typeof useAppSelectedRoomRuntime>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;
type RoomActions = ReturnType<typeof useAppRoomActions>;
type RoomChatMutations = ReturnType<typeof useRoomChatMutations>;
type WorkspaceRecords = ReturnType<typeof useAppWorkspaceRecords>;

export function useAppInviteActions({
  appState,
  appRefs,
  localIdentity,
  selected,
  selectedRuntime,
  roomInteraction,
  roomActions,
  roomChatMutations,
  workspaceRecords
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  selectedRuntime: SelectedRoomRuntime;
  roomInteraction: RoomInteraction;
  roomActions: RoomActions;
  roomChatMutations: RoomChatMutations;
  workspaceRecords: WorkspaceRecords;
}) {
  const {
    workspaceState,
    roomRuntimeState,
    invitePanelState,
    appRuntimeState
  } = appState;
  const {
    hasSelectedRoom,
    selectedRoom,
    inviteApprovalGate
  } = selected;
  const {
    appendInviteRequest,
    updateInviteRequestStatus,
    setSelectedInviteMessage,
    setInviteMessageForRoom,
    setInviteLinkForRoom,
    setKeyRotationBusyForRoom
  } = roomActions;

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
    appendInviteRequest,
    updateInviteRequestStatus,
    appendRoomMessage: roomChatMutations.appendRoomMessage,
    setSelectedInviteMessage,
    setInviteMessageForRoom,
    setInviteLinkForRoom,
    clearInviteSecretInput: invitePanelState.clearInviteSecretInput,
    setSelectedTeam: workspaceState.setSelectedTeam,
    setSelectedRoomId: workspaceState.setSelectedRoomId,
    setForgottenRoomIds: roomRuntimeState.setForgottenRoomIds,
    setRevokedRoomIds: roomRuntimeState.setRevokedRoomIds,
    setRevokedTeamIds: roomRuntimeState.setRevokedTeamIds,
    setKeyRotationBusyForRoom
  });
}
