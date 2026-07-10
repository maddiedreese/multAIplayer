import type { RoomRecord, TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import { formatTeamMemberName, formatTeamRole } from "./appFormatters";
import { buildDeviceFingerprintMarkdown } from "./deviceTrust";
import {
  removeTeamMember,
  transferTeamOwnership,
  updateTeamMemberRole
} from "./workspaceClient";
import { useAppStore } from "../store/appStore";
import type { RoomPresence } from "../types";
import { currentLocalIdentity } from "./selectedWorkspace";

interface MemberActionsOptions {
  setDeviceIdentityMessage: (message: string | null) => void;
  trustDeviceForRoom: (roomId: string, deviceId: string, fingerprint: string) => void;
  untrustDeviceForRoom: (roomId: string, deviceId: string) => void;
  updateTeamRoleForTeam: (teamId: string, role: TeamRecord["role"] | undefined) => void;
  updateTeamMemberCountForTeam: (teamId: string, members: number) => void;
  copyMarkdownWithFallback: (
    title: string,
    markdown: string,
    setStatus: (message: string | null) => void,
    roomId?: string
  ) => Promise<void>;
}

export function createMemberActions({
  setDeviceIdentityMessage,
  trustDeviceForRoom,
  untrustDeviceForRoom,
  updateTeamRoleForTeam,
  updateTeamMemberCountForTeam,
  copyMarkdownWithFallback
}: MemberActionsOptions) {
  const currentWorkspace = () => {
    const { selectedTeam, selectedRoomId, teams, rooms } = useAppStore.getState();
    return {
      selectedTeam,
      selectedTeamName: teams.find((team) => team.id === selectedTeam)?.name ?? "Selected team",
      selectedRoom: rooms.find((room) => room.id === selectedRoomId)
    };
  };

  function trustRoomMemberDevice(member: RoomPresence) {
    const { selectedRoom } = currentWorkspace();
    if (!selectedRoom) return;
    const fingerprint = member.publicKeyFingerprint;
    if (!fingerprint) {
      setDeviceIdentityMessage(`${member.displayName} has no registered device identity to trust.`);
      return;
    }
    trustDeviceForRoom(selectedRoom.id, member.deviceId, fingerprint);
    setDeviceIdentityMessage(`Trusted ${member.displayName}'s device identity for ${selectedRoom.name}.`);
  }

  function untrustRoomMemberDevice(member: RoomPresence) {
    const { selectedRoom } = currentWorkspace();
    if (!selectedRoom) return;
    untrustDeviceForRoom(selectedRoom.id, member.deviceId);
    setDeviceIdentityMessage(`Removed local trust for ${member.displayName}'s device identity in ${selectedRoom.name}.`);
  }

  async function copyRoomMemberDeviceFingerprint(member: RoomPresence, trusted: boolean) {
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
      trusted
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
      useAppStore.getState().setTeamMembersMessageForTeam(
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
      useAppStore.getState().setTeamMembersMessageForTeam(
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
    const { selectedTeam, selectedTeamName } = currentWorkspace();
    if (!selectedTeam || useAppStore.getState().teamRosterByTeam[selectedTeam]?.busy) return;
    useAppStore.getState().setTeamMembersBusyForTeam(selectedTeam, true);
    useAppStore.getState().setTeamMembersMessageForTeam(selectedTeam, null);
    try {
      const members = await removeTeamMember(selectedTeam, member.userId);
      useAppStore.getState().setTeamMembersForTeam(selectedTeam, members);
      updateTeamMemberCountForTeam(selectedTeam, members.length);
      useAppStore.getState().setTeamMembersMessageForTeam(
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
    trustRoomMemberDevice,
    untrustRoomMemberDevice,
    copyRoomMemberDeviceFingerprint,
    changeTeamMemberRole,
    transferOwnershipToTeamMember,
    removeMemberFromTeam
  };
}
