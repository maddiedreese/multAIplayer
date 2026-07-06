import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomScopedSetters } from "./useAppRoomScopedSetters";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useWorkspaceRecordActions } from "./useWorkspaceRecordActions";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomSetters = ReturnType<typeof useAppRoomScopedSetters>;

export function useAppWorkspaceRecords({
  appState,
  appRefs,
  localIdentity,
  selected,
  roomSetters
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  roomSetters: RoomSetters;
}) {
  const {
    workspaceState,
    roomRuntimeState,
    invitePanelState
  } = appState;
  const {
    hasSelectedRoom,
    selectedRoom
  } = selected;
  const {
    resetCodexApprovalForRoom,
    setInviteLinkForRoom,
    setInviteMessageForRoom,
    setChatMessageForRoom,
    setHostMessageForRoom
  } = roomSetters;

  return useWorkspaceRecordActions({
    hasSelectedRoom,
    selectedRoom,
    localUser: localIdentity.localUser,
    roomsRef: appRefs.roomsRef,
    setTeams: workspaceState.setTeams,
    setTeamMembersByTeam: workspaceState.setTeamMembersByTeam,
    setRooms: workspaceState.setRooms,
    resetCodexApprovalForRoom,
    setRevokedRoomIds: roomRuntimeState.setRevokedRoomIds,
    setRevokedTeamIds: roomRuntimeState.setRevokedTeamIds,
    setForgottenRoomIds: roomRuntimeState.setForgottenRoomIds,
    setInviteAdmissionsByRoom: invitePanelState.setInviteAdmissionsByRoom,
    setPresenceByRoom: roomRuntimeState.setPresenceByRoom,
    setInviteLinkForRoom,
    setInviteMessageForRoom,
    setChatMessageForRoom,
    setHostMessageForRoom,
    setWorkspaceError: workspaceState.setWorkspaceError
  });
}
