import type { ClientRoomRecord, TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import { formatTeamMemberName, formatTeamRole } from "../../lib/formatting/appFormatters";
import { buildDeviceFingerprintMarkdown } from "../../lib/identity/deviceFingerprintComparisons";
import { removeTeamMember, transferTeamOwnership, updateTeamMemberRole } from "../workspace/workspaceClient";
import { useAppStore } from "../../store/appStore";
import type { RoomPresence } from "../../types";
import { currentLocalIdentity } from "../workspace/selectedWorkspace";
import { isRelayHttpErrorCode } from "../../lib/core/httpResponse";

interface MemberActionsOptions {
  setDeviceIdentityMessage: (message: string | null) => void;
  recordDeviceFingerprintComparisonForRoom: (roomId: string, deviceId: string, fingerprint: string) => void;
  removeDeviceFingerprintComparisonForRoom: (roomId: string, deviceId: string) => void;
  updateTeamRoleForTeam: (teamId: string, role: TeamRecord["role"] | undefined) => void;
  updateTeamMemberCountForTeam: (teamId: string, members: number) => void;
  removeMembersFromMlsGroup: (
    room: ClientRoomRecord,
    actor: { id: string; name: string },
    deviceId: string,
    excludedUserIds?: ReadonlySet<string>
  ) => Promise<unknown>;
  copyMarkdownWithFallback: (
    title: string,
    markdown: string,
    setStatus: (message: string | null) => void,
    roomId?: string
  ) => Promise<void>;
}

export function createMemberActions({
  setDeviceIdentityMessage,
  recordDeviceFingerprintComparisonForRoom,
  removeDeviceFingerprintComparisonForRoom,
  updateTeamRoleForTeam,
  updateTeamMemberCountForTeam,
  removeMembersFromMlsGroup,
  copyMarkdownWithFallback
}: MemberActionsOptions) {
  const currentWorkspace = () => {
    const { selectedTeam, selectedRoomId, teams, rooms } = useAppStore.getState();
    return {
      selectedTeam,
      selectedTeamName: teams.find((team) => team.id === selectedTeam)?.name ?? "Selected team",
      selectedRoom: rooms.find((room) => room.id === selectedRoomId),
      rooms
    };
  };

  function markRoomMemberFingerprintCompared(member: RoomPresence) {
    const { selectedRoom } = currentWorkspace();
    if (!selectedRoom) return;
    const fingerprint = member.publicKeyFingerprint;
    if (!fingerprint) {
      setDeviceIdentityMessage(`${member.displayName} has no registered device fingerprint to compare.`);
      return;
    }
    recordDeviceFingerprintComparisonForRoom(selectedRoom.id, member.deviceId, fingerprint);
    setDeviceIdentityMessage(
      `Marked ${member.displayName}'s fingerprint as compared on this device for ${selectedRoom.name}. This advisory note grants no access or authority.`
    );
  }

  function clearRoomMemberFingerprintComparison(member: RoomPresence) {
    const { selectedRoom } = currentWorkspace();
    if (!selectedRoom) return;
    removeDeviceFingerprintComparisonForRoom(selectedRoom.id, member.deviceId);
    setDeviceIdentityMessage(
      `Cleared this device's fingerprint comparison note for ${member.displayName} in ${selectedRoom.name}.`
    );
  }

  async function copyRoomMemberDeviceFingerprint(member: RoomPresence, comparedLocally: boolean) {
    const { selectedRoom } = currentWorkspace();
    if (!selectedRoom) return;
    const fingerprint = member.publicKeyFingerprint;
    if (!fingerprint) {
      setDeviceIdentityMessage(`${member.displayName} has no registered device identity to copy.`);
      return;
    }
    const markdown = buildDeviceFingerprintMarkdown({
      roomName: selectedRoom.name,
      displayName: member.displayName,
      deviceId: member.deviceId,
      fingerprint,
      comparedLocally
    });
    await copyMarkdownWithFallback(
      `${member.displayName} device fingerprint`,
      markdown,
      setDeviceIdentityMessage,
      selectedRoom.id
    );
  }

  async function changeTeamMemberRole(member: TeamMemberRecord, role: "admin" | "member") {
    const { selectedTeam } = currentWorkspace();
    if (!selectedTeam || useAppStore.getState().teamRosterByTeam[selectedTeam]?.busy) return;
    useAppStore.getState().setTeamMembersBusyForTeam(selectedTeam, true);
    useAppStore.getState().setTeamMembersMessageForTeam(selectedTeam, null);
    try {
      const members = await updateTeamMemberRole(selectedTeam, member.userId, role);
      useAppStore.getState().setTeamMembersForTeam(selectedTeam, members);
      useAppStore
        .getState()
        .setTeamMembersMessageForTeam(
          selectedTeam,
          `${formatTeamMemberName(member.userId, useAppStore.getState().currentUser)} is now ${formatTeamRole(role)}.`
        );
    } catch (error) {
      useAppStore.getState().setTeamMembersMessageForTeam(selectedTeam, String(error));
    } finally {
      useAppStore.getState().setTeamMembersBusyForTeam(selectedTeam, false);
    }
  }

  async function transferOwnershipToTeamMember(member: TeamMemberRecord) {
    const { selectedTeam } = currentWorkspace();
    const { localUser } = currentLocalIdentity();
    if (!selectedTeam || useAppStore.getState().teamRosterByTeam[selectedTeam]?.busy) return;
    useAppStore.getState().setTeamMembersBusyForTeam(selectedTeam, true);
    useAppStore.getState().setTeamMembersMessageForTeam(selectedTeam, null);
    try {
      const members = await transferTeamOwnership(selectedTeam, member.userId);
      useAppStore.getState().setTeamMembersForTeam(selectedTeam, members);
      const localMember = members.find((item) => item.userId === localUser.id);
      updateTeamRoleForTeam(selectedTeam, localMember?.role);
      useAppStore
        .getState()
        .setTeamMembersMessageForTeam(
          selectedTeam,
          `${formatTeamMemberName(member.userId, useAppStore.getState().currentUser)} is now the team owner.`
        );
    } catch (error) {
      useAppStore.getState().setTeamMembersMessageForTeam(selectedTeam, String(error));
    } finally {
      useAppStore.getState().setTeamMembersBusyForTeam(selectedTeam, false);
    }
  }

  async function removeMemberFromTeam(member: TeamMemberRecord) {
    const { selectedTeam, selectedTeamName, rooms } = currentWorkspace();
    if (!selectedTeam || useAppStore.getState().teamRosterByTeam[selectedTeam]?.busy) return;
    useAppStore.getState().setTeamMembersBusyForTeam(selectedTeam, true);
    useAppStore.getState().setTeamMembersMessageForTeam(selectedTeam, null);
    try {
      const { localUser, deviceId } = currentLocalIdentity();
      const activeRooms = rooms.filter((room) => room.teamId === selectedTeam && !room.archivedAt && !room.deletedAt);
      const unavailableRooms = activeRooms.filter(
        (room) =>
          room.hostStatus !== "active" || room.hostUserId !== localUser.id || room.activeHostDeviceId !== deviceId
      );
      if (unavailableRooms.length > 0) {
        const names = unavailableRooms.map((room) => room.name).join(", ");
        throw new Error(
          `Removal was not started. Transfer active host authority for ${names} to this device, then retry.`
        );
      }
      let members: TeamMemberRecord[];
      try {
        members = await removeTeamMember(selectedTeam, member.userId);
      } catch (error) {
        if (!isRelayHttpErrorCode(error, "team_member_not_found")) throw error;
        members = (useAppStore.getState().teamRosterByTeam[selectedTeam]?.members ?? []).filter(
          (item) => item.userId !== member.userId
        );
      }
      const failures: Array<{ room: ClientRoomRecord; error: unknown }> = [];
      for (const room of activeRooms) {
        try {
          await removeMembersFromMlsGroup(room, localUser, deviceId, new Set([member.userId]));
        } catch (error) {
          failures.push({ room, error });
        }
      }
      if (failures.length > 0) {
        const details = failures.map(({ room, error }) => `${room.name}: ${String(error)}`).join("; ");
        throw new Error(
          `Member relay access was removed, but MLS Remove commits are incomplete. Retry removal to finish: ${details}`
        );
      }
      useAppStore.getState().setTeamMembersForTeam(selectedTeam, members);
      updateTeamMemberCountForTeam(selectedTeam, members.length);
      useAppStore
        .getState()
        .setTeamMembersMessageForTeam(
          selectedTeam,
          `Removed ${formatTeamMemberName(member.userId, useAppStore.getState().currentUser)} from ${selectedTeamName}.`
        );
    } catch (error) {
      useAppStore.getState().setTeamMembersMessageForTeam(selectedTeam, String(error));
    } finally {
      useAppStore.getState().setTeamMembersBusyForTeam(selectedTeam, false);
    }
  }

  return {
    markRoomMemberFingerprintCompared,
    clearRoomMemberFingerprintComparison,
    copyRoomMemberDeviceFingerprint,
    changeTeamMemberRole,
    transferOwnershipToTeamMember,
    removeMemberFromTeam
  };
}
