import type { ClientRoomRecord, RelayServerMessage, TeamRecord } from "@multaiplayer/protocol";
import { useAppStore } from "../../store/appStore";
import { shouldResetCodexApprovalForRoomUpdate } from "../../lib/codex/codexApproval";
import { isMembershipRemovedRelayError, membershipRemovedRoomMessage } from "../../lib/relay/relayAccess";
import { currentLocalIdentity } from "./selectedWorkspace";
import { reportNonFatal } from "../../lib/core/nonFatalReporting";

interface CreateWorkspaceRecordActionsOptions {
  upsertTeamRecord: (team: TeamRecord) => void;
  upsertRoomRecord: (room: ClientRoomRecord) => void;
  replaceRoomRecord: (room: ClientRoomRecord) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  revokeWorkspaceAccess: (teamId: string, roomId: string) => void;
  forgetRevokedRoomLocalData: (roomId: string) => Promise<void>;
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
  forgetRevokedRoomLocalData,
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
    const previousRoom = useAppStore.getState().rooms.find((existing) => existing.id === room.id);
    if (previousRoom && shouldResetCodexApprovalForRoomUpdate(previousRoom, room)) {
      resetCodexApprovalForRoom(room.id);
    }
    upsertRoomRecord(room);
  }

  function replaceRoom(room: ClientRoomRecord) {
    const previousRoom = useAppStore.getState().rooms.find((existing) => existing.id === room.id);
    if (previousRoom && shouldResetCodexApprovalForRoomUpdate(previousRoom, room)) {
      resetCodexApprovalForRoom(room.id);
    }
    replaceRoomRecord(room);
  }

  function handleRelayError(error: Extract<RelayServerMessage, { type: "error" }>) {
    const membershipRemoved = isMembershipRemovedRelayError(error);
    reportNonFatal(
      membershipRemoved ? "handle removed relay membership" : "handle relay request failure",
      error.message
    );
    const store = useAppStore.getState();
    if (!membershipRemoved || !error.teamId) return;
    const affectedRooms = store.rooms.filter((room) => room.teamId === error.teamId);
    for (const room of affectedRooms) {
      const pendingMessage = `Access to ${room.name} was removed on the relay. This device is deleting its local encrypted room data before rejoin is allowed.`;
      revokeWorkspaceAccess(room.teamId, room.id);
      store.clearInviteAdmissionForRoom(room.id);
      store.clearPresenceForRoom(room.id);
      store.clearRoomScopedStateForRoom(room.id);
      setInviteLinkForRoom(room.id, "");
      setInviteMessageForRoom(room.id, pendingMessage);
      setChatMessageForRoom(room.id, pendingMessage);
      setHostMessageForRoom(room.id, pendingMessage);
      void forgetRevokedRoomLocalData(room.id).then(
        () => {
          const userMessage = membershipRemovedRoomMessage(room.name);
          setRoomRevocationMessages(room.id, userMessage);
          replaceOwnedWorkspaceStatus(room.id, pendingMessage, userMessage);
        },
        (cleanupError: unknown) => {
          reportNonFatal("forget local room data after removed relay membership", cleanupError);
          const failureMessage = `Access to ${room.name} was removed, but this device could not delete its local encrypted room data. Select the room and choose Forget room on this device to retry before rejoining.`;
          setRoomRevocationMessages(room.id, failureMessage);
          replacePendingWorkspaceStatus(failureMessage);
        }
      );
    }
    const selectedRoom = affectedRooms.find((room) => room.id === store.selectedRoomId);
    setWorkspaceStatusError(
      selectedRoom
        ? `Access to ${selectedRoom.name} was removed on the relay. This device is deleting its local encrypted room data before rejoin is allowed.`
        : "Your team membership was removed. Local data for that team's rooms is being deleted before rejoin is allowed."
    );

    function setRoomRevocationMessages(roomId: string, message: string) {
      setInviteMessageForRoom(roomId, message);
      setChatMessageForRoom(roomId, message);
      setHostMessageForRoom(roomId, message);
    }

    function replaceOwnedWorkspaceStatus(roomId: string, pendingMessage: string, nextMessage: string) {
      const current = useAppStore.getState();
      if (current.selectedRoomId === roomId && current.workspaceError === pendingMessage) {
        setWorkspaceStatusError(nextMessage);
      }
    }

    function replacePendingWorkspaceStatus(nextMessage: string) {
      const currentMessage = useAppStore.getState().workspaceError;
      const genericMessage =
        "Your team membership was removed. Local data for that team's rooms is being deleted before rejoin is allowed.";
      const ownsStatus =
        currentMessage === genericMessage ||
        affectedRooms.some(
          (affectedRoom) =>
            currentMessage ===
            `Access to ${affectedRoom.name} was removed on the relay. This device is deleting its local encrypted room data before rejoin is allowed.`
        );
      if (ownsStatus) setWorkspaceStatusError(nextMessage);
    }
  }

  return {
    upsertTeam,
    upsertRoom,
    replaceRoom,
    handleRelayError
  };
}

export type WorkspaceRecordActions = ReturnType<typeof createWorkspaceRecordActions>;
