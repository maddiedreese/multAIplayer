import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { isMembershipRemovedRelayError, membershipRemovedRoomMessage } from "../lib/relayAccess";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import { shouldResetCodexApprovalForRoomUpdate } from "../lib/codexApproval";
import {
  markRoomRead as markRoomReadRecord,
  replaceRoomPreservingUnread,
  upsertRoomPreservingUnread
} from "../lib/roomUnread";
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
  setTeams: Dispatch<SetStateAction<TeamRecord[]>>;
  setRooms: Dispatch<SetStateAction<RoomRecord[]>>;
  resetCodexApprovalForRoom: (roomId: string) => void;
  revokeWorkspaceAccess: (teamId: string, roomId: string) => void;
  setInviteLinkForRoom: (roomId: string, link: string) => void;
  setInviteMessageForRoom: (roomId: string, message: string | null) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  setWorkspaceError: (message: string | null) => void;
}

export function useWorkspaceRecordActions({
  hasSelectedRoom,
  selectedRoom,
  localUser,
  roomsRef,
  setTeams,
  setRooms,
  resetCodexApprovalForRoom,
  revokeWorkspaceAccess,
  setInviteLinkForRoom,
  setInviteMessageForRoom,
  setChatMessageForRoom,
  setHostMessageForRoom,
  setWorkspaceError
}: UseWorkspaceRecordActionsOptions) {
  const ensureLocalTeamMemberForTeam = useAppStore((state) => state.ensureLocalTeamMemberForTeam);
  const clearInviteAdmissionForRoom = useAppStore((state) => state.clearInviteAdmissionForRoom);
  const clearPresenceForRoom = useAppStore((state) => state.clearPresenceForRoom);

  function upsertTeam(team: TeamRecord) {
    setTeams((current) => {
      if (current.some((item) => item.id === team.id)) {
        return current.map((item) => (item.id === team.id ? team : item));
      }
      return [...current, team];
    });
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
    setRooms((current) => upsertRoomPreservingUnread(current, nextRoom));
  }

  function replaceRoom(room: RoomRecord) {
    const nextRoom = ensureRoomDefaults(room);
    const previousRoom = roomsRef.current.find((existing) => existing.id === nextRoom.id);
    if (previousRoom && shouldResetCodexApprovalForRoomUpdate(ensureRoomDefaults(previousRoom), nextRoom)) {
      resetCodexApprovalForRoom(nextRoom.id);
    }
    setRooms((current) => replaceRoomPreservingUnread(current, nextRoom));
  }

  const markRoomRead = useCallback((roomId: string) => {
    setRooms((current) => markRoomReadRecord(current, roomId));
  }, [setRooms]);

  function handleRelayError(message: string) {
    console.warn("Relay error", message);
    if (!isMembershipRemovedRelayError(message) || !hasSelectedRoom) return;

    const room = selectedRoom;
    const userMessage = membershipRemovedRoomMessage(room.name);
    revokeWorkspaceAccess(room.teamId, room.id);
    clearInviteAdmissionForRoom(room.id);
    clearPresenceForRoom(room.id);
    setInviteLinkForRoom(room.id, "");
    setInviteMessageForRoom(room.id, userMessage);
    setChatMessageForRoom(room.id, userMessage);
    setHostMessageForRoom(room.id, userMessage);
    setWorkspaceError(userMessage);
  }

  return {
    upsertTeam,
    upsertRoom,
    replaceRoom,
    markRoomRead,
    handleRelayError
  };
}
