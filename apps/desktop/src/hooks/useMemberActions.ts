import type { Dispatch, SetStateAction } from "react";
import type { TeamMemberRecord, TeamRecord, RoomRecord } from "@multaiplayer/protocol";
import type { SignedInUser } from "../lib/authClient";
import {
  removeTeamMember,
  transferTeamOwnership,
  updateTeamMemberRole
} from "../lib/workspaceClient";
import { buildDeviceFingerprintMarkdown, trustDeviceKey, untrustDeviceKey, type TrustedDeviceKey } from "../lib/deviceTrust";
import { formatTeamMemberName, formatTeamRole } from "../lib/appFormatters";
import type { RoomPresence } from "../types";

interface LocalUser {
  id: string;
  name: string;
}

interface UseMemberActionsOptions {
  selectedTeam: string;
  selectedTeamName: string;
  selectedTeamMembersBusy: boolean;
  selectedRoom: RoomRecord;
  localUser: LocalUser;
  currentUser: SignedInUser | null;
  setDeviceIdentityMessage: (message: string | null) => void;
  setTrustedDeviceKeys: Dispatch<SetStateAction<TrustedDeviceKey[]>>;
  setTeamMembersBusyByTeam: Dispatch<SetStateAction<Record<string, boolean>>>;
  setTeamMembersMessageByTeam: Dispatch<SetStateAction<Record<string, string | null>>>;
  setTeamMembersByTeam: Dispatch<SetStateAction<Record<string, TeamMemberRecord[]>>>;
  setTeams: Dispatch<SetStateAction<TeamRecord[]>>;
  copyMarkdownWithFallback: (
    title: string,
    markdown: string,
    setStatus: (message: string | null) => void,
    roomId?: string
  ) => Promise<void>;
}

export function useMemberActions({
  selectedTeam,
  selectedTeamName,
  selectedTeamMembersBusy,
  selectedRoom,
  localUser,
  currentUser,
  setDeviceIdentityMessage,
  setTrustedDeviceKeys,
  setTeamMembersBusyByTeam,
  setTeamMembersMessageByTeam,
  setTeamMembersByTeam,
  setTeams,
  copyMarkdownWithFallback
}: UseMemberActionsOptions) {
  function trustRoomMemberDevice(member: RoomPresence) {
    const fingerprint = member.publicKeyFingerprint;
    if (!fingerprint) {
      setDeviceIdentityMessage(`${member.displayName} has no registered device identity to trust.`);
      return;
    }
    setTrustedDeviceKeys((current) =>
      trustDeviceKey(current, selectedRoom.id, member.deviceId, fingerprint)
    );
    setDeviceIdentityMessage(`Trusted ${member.displayName}'s device identity for ${selectedRoom.name}.`);
  }

  function untrustRoomMemberDevice(member: RoomPresence) {
    setTrustedDeviceKeys((current) => untrustDeviceKey(current, selectedRoom.id, member.deviceId));
    setDeviceIdentityMessage(`Removed local trust for ${member.displayName}'s device identity in ${selectedRoom.name}.`);
  }

  async function copyRoomMemberDeviceFingerprint(member: RoomPresence, trusted: boolean) {
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
    if (!selectedTeam || selectedTeamMembersBusy) return;
    setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: true }));
    setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: null }));
    try {
      const members = await updateTeamMemberRole(selectedTeam, member.userId, role);
      setTeamMembersByTeam((current) => ({ ...current, [selectedTeam]: members }));
      setTeamMembersMessageByTeam((current) => ({
        ...current,
        [selectedTeam]: `${formatTeamMemberName(member.userId, currentUser)} is now ${formatTeamRole(role)}.`
      }));
    } catch (error) {
      setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: String(error) }));
    } finally {
      setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: false }));
    }
  }

  async function transferOwnershipToTeamMember(member: TeamMemberRecord) {
    if (!selectedTeam || selectedTeamMembersBusy) return;
    setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: true }));
    setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: null }));
    try {
      const members = await transferTeamOwnership(selectedTeam, member.userId);
      setTeamMembersByTeam((current) => ({ ...current, [selectedTeam]: members }));
      const localMember = members.find((item) => item.userId === localUser.id);
      setTeams((current) => current.map((team) =>
        team.id === selectedTeam ? { ...team, role: localMember?.role ?? team.role } : team
      ));
      setTeamMembersMessageByTeam((current) => ({
        ...current,
        [selectedTeam]: `${formatTeamMemberName(member.userId, currentUser)} is now the team owner.`
      }));
    } catch (error) {
      setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: String(error) }));
    } finally {
      setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: false }));
    }
  }

  async function removeMemberFromTeam(member: TeamMemberRecord) {
    if (!selectedTeam || selectedTeamMembersBusy) return;
    setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: true }));
    setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: null }));
    try {
      const members = await removeTeamMember(selectedTeam, member.userId);
      setTeamMembersByTeam((current) => ({ ...current, [selectedTeam]: members }));
      setTeams((current) => current.map((team) => team.id === selectedTeam ? { ...team, members: members.length } : team));
      setTeamMembersMessageByTeam((current) => ({
        ...current,
        [selectedTeam]: `Removed ${formatTeamMemberName(member.userId, currentUser)} from ${selectedTeamName}.`
      }));
    } catch (error) {
      setTeamMembersMessageByTeam((current) => ({ ...current, [selectedTeam]: String(error) }));
    } finally {
      setTeamMembersBusyByTeam((current) => ({ ...current, [selectedTeam]: false }));
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
