import type { ClientRoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { useAppStore } from "../../store/appStore";
import { shouldResetCodexApprovalForRoomUpdate } from "../../lib/codex/codexApproval";
import { isMembershipRemovedRelayError, membershipRemovedRoomMessage } from "../../lib/relay/relayAccess";
import { ensureRoomDefaults } from "../../lib/room/roomDefaults";
import { currentLocalIdentity } from "./selectedWorkspace";
import { reportNonFatal } from "../../lib/core/nonFatalReporting";

interface CreateWorkspaceRecordActionsOptions {
  upsertTeamRecord: (team: TeamRecord) => void;
  upsertRoomRecord: (room: ClientRoomRecord) => void;
  replaceRoomRecord: (room: ClientRoomRecord) => void;
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

  function upsertRoom(room: ClientRoomRecord) {
    const nextRoom = ensureRoomDefaults(room);
    const previousRoom = useAppStore.getState().rooms.find((existing) => existing.id === nextRoom.id);
    if (previousRoom && shouldResetCodexApprovalForRoomUpdate(ensureRoomDefaults(previousRoom), nextRoom)) {
      resetCodexApprovalForRoom(nextRoom.id);
    }
    upsertRoomRecord(nextRoom);
  }

  function replaceRoom(room: ClientRoomRecord) {
    const nextRoom = ensureRoomDefaults(room);
    const previousRoom = useAppStore.getState().rooms.find((existing) => existing.id === nextRoom.id);
    if (previousRoom && shouldResetCodexApprovalForRoomUpdate(ensureRoomDefaults(previousRoom), nextRoom)) {
      resetCodexApprovalForRoom(nextRoom.id);
    }
    replaceRoomRecord(nextRoom);
  }

  function handleRelayError(message: string) {
    const membershipRemoved = isMembershipRemovedRelayError(message);
    reportNonFatal(membershipRemoved ? "handle removed relay membership" : "handle relay request failure", message);
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
