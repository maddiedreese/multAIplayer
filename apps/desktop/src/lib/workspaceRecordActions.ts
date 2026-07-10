import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { useAppStore } from "../store/appStore";
import { shouldResetCodexApprovalForRoomUpdate } from "./codexApproval";
import { isMembershipRemovedRelayError, membershipRemovedRoomMessage } from "./relayAccess";
import { ensureRoomDefaults } from "./roomDefaults";
import { currentLocalIdentity } from "./selectedWorkspace";

interface CreateWorkspaceRecordActionsOptions {
  upsertTeamRecord: (team: TeamRecord) => void;
  upsertRoomRecord: (room: RoomRecord) => void;
  replaceRoomRecord: (room: RoomRecord) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  revokeWorkspaceAccess: (teamId: string, roomId: string) => void;
  setInviteLinkForRoom: (roomId: string, link: string) => void;
  setInviteMessageForRoom: (roomId: string, message: string | null) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setWorkspaceStatusError: (message: string | null) => void;
}

export function createWorkspaceRecordActions({
  upsertTeamRecord,
  upsertRoomRecord,
  replaceRoomRecord,
  resetCodexApprovalForRoom,
  revokeWorkspaceAccess,
  setInviteLinkForRoom,
  setInviteMessageForRoom,
  setChatMessageForRoom,
  setHostMessageForRoom,
  setWorkspaceStatusError
}: CreateWorkspaceRecordActionsOptions) {
  function upsertTeam(team: TeamRecord) {
    const { localUser } = currentLocalIdentity();
    upsertTeamRecord(team);
    if (team.role) {
      useAppStore.getState().ensureLocalTeamMemberForTeam(team.id, localUser.id, team.role);
    }
  }

  function upsertRoom(room: RoomRecord) {
    const nextRoom = ensureRoomDefaults(room);
    const previousRoom = useAppStore.getState().rooms.find((existing) => existing.id === nextRoom.id);
    if (previousRoom && shouldResetCodexApprovalForRoomUpdate(ensureRoomDefaults(previousRoom), nextRoom)) {
      resetCodexApprovalForRoom(nextRoom.id);
    }
    upsertRoomRecord(nextRoom);
  }

  function replaceRoom(room: RoomRecord) {
    const nextRoom = ensureRoomDefaults(room);
    const previousRoom = useAppStore.getState().rooms.find((existing) => existing.id === nextRoom.id);
    if (previousRoom && shouldResetCodexApprovalForRoomUpdate(ensureRoomDefaults(previousRoom), nextRoom)) {
      resetCodexApprovalForRoom(nextRoom.id);
    }
    replaceRoomRecord(nextRoom);
  }

  function handleRelayError(message: string) {
    const membershipRemoved = isMembershipRemovedRelayError(message);
    console.warn(membershipRemoved ? "Relay membership was removed" : "Relay request failed");
    const store = useAppStore.getState();
    const room = store.rooms.find((candidate) => candidate.id === store.selectedRoomId);
    if (!membershipRemoved || !room) return;
    const userMessage = membershipRemovedRoomMessage(room.name);
    revokeWorkspaceAccess(room.teamId, room.id);
    store.clearInviteAdmissionForRoom(room.id);
    store.clearPresenceForRoom(room.id);
    setInviteLinkForRoom(room.id, "");
    setInviteMessageForRoom(room.id, userMessage);
    setChatMessageForRoom(room.id, userMessage);
    setHostMessageForRoom(room.id, userMessage);
    setWorkspaceStatusError(userMessage);
  }

  return {
    upsertTeam,
    upsertRoom,
    replaceRoom,
    handleRelayError
  };
}

export type WorkspaceRecordActions = ReturnType<typeof createWorkspaceRecordActions>;
