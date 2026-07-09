import { useCallback, type MutableRefObject } from "react";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { isMembershipRemovedRelayError, membershipRemovedRoomMessage } from "../lib/relayAccess";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import { shouldResetCodexApprovalForRoomUpdate } from "../lib/codexApproval";
import { useAppStore } from "../store/appStore";

interface LocalUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface UseWorkspaceRecordActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoom: RoomRecord;
  localUser: LocalUser;
  roomsRef: MutableRefObject<RoomRecord[]>;
  upsertTeamRecord: (team: TeamRecord) => void;
  upsertRoomRecord: (room: RoomRecord) => void;
  replaceRoomRecord: (room: RoomRecord) => void;
  markRoomReadById: (roomId: string) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  revokeWorkspaceAccess: (teamId: string, roomId: string) => void;
  setInviteLinkForRoom: (roomId: string, link: string) => void;
  setInviteMessageForRoom: (roomId: string, message: string | null) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setWorkspaceStatusError: (message: string | null) => void;
}

export function useWorkspaceRecordActions({
  hasSelectedRoom,
  selectedRoom,
  localUser,
  roomsRef,
  upsertTeamRecord,
  upsertRoomRecord,
  replaceRoomRecord,
  markRoomReadById,
  resetCodexApprovalForRoom,
  revokeWorkspaceAccess,
  setInviteLinkForRoom,
  setInviteMessageForRoom,
  setChatMessageForRoom,
  setHostMessageForRoom,
  setWorkspaceStatusError
}: UseWorkspaceRecordActionsOptions) {
  const ensureLocalTeamMemberForTeam = useAppStore((state) => state.ensureLocalTeamMemberForTeam);
  const clearInviteAdmissionForRoom = useAppStore((state) => state.clearInviteAdmissionForRoom);
  const clearPresenceForRoom = useAppStore((state) => state.clearPresenceForRoom);

  function upsertTeam(team: TeamRecord) {
    upsertTeamRecord(team);
    if (team.role) {
      ensureLocalTeamMemberForTeam(team.id, localUser.id, team.role);
    }
  }

  function upsertRoom(room: RoomRecord) {
    const nextRoom = ensureRoomDefaults(room);
    const previousRoom = roomsRef.current.find((existing) => existing.id === nextRoom.id);
    if (previousRoom && shouldResetCodexApprovalForRoomUpdate(ensureRoomDefaults(previousRoom), nextRoom)) {
      resetCodexApprovalForRoom(nextRoom.id);
    }
    upsertRoomRecord(nextRoom);
  }

  function replaceRoom(room: RoomRecord) {
    const nextRoom = ensureRoomDefaults(room);
    const previousRoom = roomsRef.current.find((existing) => existing.id === nextRoom.id);
    if (previousRoom && shouldResetCodexApprovalForRoomUpdate(ensureRoomDefaults(previousRoom), nextRoom)) {
      resetCodexApprovalForRoom(nextRoom.id);
    }
    replaceRoomRecord(nextRoom);
  }

  const markRoomRead = useCallback((roomId: string) => {
    markRoomReadById(roomId);
  }, [markRoomReadById]);

  function handleRelayError(message: string) {
    const membershipRemoved = isMembershipRemovedRelayError(message);
    console.warn(membershipRemoved ? "Relay membership was removed" : "Relay request failed");
    if (!membershipRemoved || !hasSelectedRoom) return;

    const room = selectedRoom;
    const userMessage = membershipRemovedRoomMessage(room.name);
    revokeWorkspaceAccess(room.teamId, room.id);
    clearInviteAdmissionForRoom(room.id);
    clearPresenceForRoom(room.id);
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
    markRoomRead,
    handleRelayError
  };
}
