import { useAppStore } from "../store/appStore";
import { fallbackUser } from "../seedData";
import { loadOrCreateDeviceId } from "./appRuntime";
import { browserAccessGateMessage, canHostBrowserAction, canRequestBrowserAccess } from "./browserPolicy";
import { canUseLocalWorkspace, localWorkspaceGateMessage } from "./workspaceAccess";
import { isLocalUserActiveHostForRoom } from "./roomHost";

export function currentSelectedRoom() {
  const state = useAppStore.getState();
  return state.rooms.find((room) => room.id === state.selectedRoomId);
}

export function currentSelectedTeam() {
  const state = useAppStore.getState();
  return state.teams.find((team) => team.id === state.selectedTeam);
}

export function currentSelectedRoomContext() {
  const state = useAppStore.getState();
  const room = state.rooms.find((candidate) => candidate.id === state.selectedRoomId);
  if (!room) return null;
  const localUser = {
    id: state.currentUser?.id ?? fallbackUser.id,
    name: state.currentUser?.name ?? state.currentUser?.login ?? fallbackUser.name
  };
  const revoked = state.revokedRoomIds.has(room.id) || state.revokedTeamIds.has(room.teamId);
  const locked = room.archivedAt != null || state.forgottenRoomIds.has(room.id) || revoked;
  const isActiveHost = isLocalUserActiveHostForRoom(room, localUser);
  return {
    room,
    localUser,
    deviceId: typeof localStorage === "undefined" ? "local-device" : loadOrCreateDeviceId(),
    revoked,
    locked,
    isActiveHost,
    canReadLocalWorkspace: canUseLocalWorkspace(room, localUser, locked),
    canRequestBrowser: canRequestBrowserAccess(room, locked),
    canHostBrowser: canHostBrowserAction(room, localUser, locked),
    browserAccessMessage: browserAccessGateMessage(room, locked),
    localWorkspaceMessage: localWorkspaceGateMessage(room, locked),
    hostGateMessage: room.hostStatus === "active"
      ? `Only ${room.host} can approve host-side actions in this room.`
      : "Claim host before approving host-side actions in this room.",
    roomSettingsGateMessage: room.hostStatus === "active"
      ? `Only ${room.host} can change room host settings.`
      : "Claim host before changing room host settings."
  };
}

export function currentLocalIdentity() {
  const currentUser = useAppStore.getState().currentUser;
  return {
    localUser: {
      id: currentUser?.id ?? fallbackUser.id,
      name: currentUser?.name ?? currentUser?.login ?? fallbackUser.name
    },
    deviceId: typeof localStorage === "undefined" ? "local-device" : loadOrCreateDeviceId()
  };
}
