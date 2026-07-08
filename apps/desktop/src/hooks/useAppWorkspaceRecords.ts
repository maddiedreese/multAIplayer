import type { useAppRefs } from "./useAppRefs";
import type { useAppRoomActions } from "./useAppRoomActions";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useAppStateSlices } from "./useAppStateSlices";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useWorkspaceRecordActions } from "./useWorkspaceRecordActions";

type AppStateSlices = ReturnType<typeof useAppStateSlices>;
type AppRefs = ReturnType<typeof useAppRefs>;
type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomActions = ReturnType<typeof useAppRoomActions>;

export function useAppWorkspaceRecords({
  appState,
  appRefs,
  localIdentity,
  selected,
  roomActions
}: {
  appState: AppStateSlices;
  appRefs: AppRefs;
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  roomActions: RoomActions;
}) {
  const {
    workspaceState,
    roomRuntimeState
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
  } = roomActions;

  return useWorkspaceRecordActions({
    hasSelectedRoom,
    selectedRoom,
    localUser: localIdentity.localUser,
    roomsRef: appRefs.roomsRef,
    setTeams: workspaceState.setTeams,
    setRooms: workspaceState.setRooms,
    resetCodexApprovalForRoom,
    revokeWorkspaceAccess: roomRuntimeState.revokeWorkspaceAccess,
    setInviteLinkForRoom,
    setInviteMessageForRoom,
    setChatMessageForRoom,
    setHostMessageForRoom,
    setWorkspaceError: workspaceState.setWorkspaceError
  });
}
