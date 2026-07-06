import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { RoomRecord, TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import { isMembershipRemovedRelayError, membershipRemovedRoomMessage } from "../lib/relayAccess";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import { shouldResetCodexApprovalForRoomUpdate } from "../lib/codexApproval";
import { upsertRoomPreservingUnread } from "../lib/roomUnread";
import { omitRecordKey } from "../lib/setUtils";
import type { RoomPresence } from "../types";

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
  setTeamMembersByTeam: Dispatch<SetStateAction<Record<string, TeamMemberRecord[]>>>;
  setRooms: Dispatch<SetStateAction<RoomRecord[]>>;
  resetCodexApprovalForRoom: (roomId: string) => void;
  setRevokedRoomIds: Dispatch<SetStateAction<Set<string>>>;
  setRevokedTeamIds: Dispatch<SetStateAction<Set<string>>>;
  setForgottenRoomIds: Dispatch<SetStateAction<Set<string>>>;
  setInviteAdmissionsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setPresenceByRoom: Dispatch<SetStateAction<Record<string, Record<string, RoomPresence>>>>;
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
  setTeamMembersByTeam,
  setRooms,
  resetCodexApprovalForRoom,
  setRevokedRoomIds,
  setRevokedTeamIds,
  setForgottenRoomIds,
  setInviteAdmissionsByRoom,
  setPresenceByRoom,
  setInviteLinkForRoom,
  setInviteMessageForRoom,
  setChatMessageForRoom,
  setHostMessageForRoom,
  setWorkspaceError
}: UseWorkspaceRecordActionsOptions) {
  function upsertTeam(team: TeamRecord) {
    setTeams((current) => {
      if (current.some((item) => item.id === team.id)) {
        return current.map((item) => (item.id === team.id ? team : item));
      }
      return [...current, team];
    });
    if (team.role) {
      setTeamMembersByTeam((current) => {
        if (current[team.id]?.some((member) => member.userId === localUser.id)) return current;
        return {
          ...current,
          [team.id]: [{
            teamId: team.id,
            userId: localUser.id,
            role: team.role ?? "member",
            joinedAt: new Date().toISOString()
          }]
        };
      });
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

  function handleRelayError(message: string) {
    console.warn("Relay error", message);
    if (!isMembershipRemovedRelayError(message) || !hasSelectedRoom) return;

    const room = selectedRoom;
    const userMessage = membershipRemovedRoomMessage(room.name);
    setRevokedRoomIds((current) => new Set(current).add(room.id));
    setRevokedTeamIds((current) => new Set(current).add(room.teamId));
    setForgottenRoomIds((current) => new Set(current).add(room.id));
    setInviteAdmissionsByRoom((current) => omitRecordKey(current, room.id));
    setPresenceByRoom((current) => omitRecordKey(current, room.id));
    setInviteLinkForRoom(room.id, "");
    setInviteMessageForRoom(room.id, userMessage);
    setChatMessageForRoom(room.id, userMessage);
    setHostMessageForRoom(room.id, userMessage);
    setWorkspaceError(userMessage);
  }

  return {
    upsertTeam,
    upsertRoom,
    handleRelayError
  };
}
